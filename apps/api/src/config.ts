import dotenv from "dotenv";
import {
  fileURLToPath,
} from "node:url";

dotenv.config({
  path:
    process.env.UNIOFFICE_ENV_FILE ??
    fileURLToPath(
      new URL("../../../.env", import.meta.url),
    ),
});

export interface OAuthClientSettings {
  clientId: string;
  clientSecret: string;
}

/**
 * External systems. Each provider is on only when its OAuth client and the
 * encryption key are both present; a half-configured provider is refused at
 * startup rather than failing on someone's first click.
 */
export interface ConnectConfig {
  /** 32 random bytes, base64. Seals every stored provider credential. */
  encryptionKey?: string;
  github?: OAuthClientSettings;
  googleDrive?: OAuthClientSettings;
  /** Where the browser reaches the API. Provider callbacks come back here. */
  publicApiUrl: string;
  /** Where people are sent back to once a provider round trip ends. */
  webUrl: string;
}

export interface ApiConfig {
  port: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  /**
   * The local model company knowledge is embedded with. Empty disables
   * semantic retrieval; keyword, importance and recency ranking still work.
   * Embeddings stay on this machine - knowledge is never sent to a third party
   * to be indexed.
   */
  embeddingModel?: string;
  seedDevelopmentWorkforce: boolean;
  corsOrigins: string[];
  /**
   * How long a mid-run work item must sit untouched before startup treats it
   * as abandoned by a dead process. Well past the longest real run, so a
   * second live instance's work is never reclaimed out from under it.
   */
  staleRunAfterMs: number;

  /** How long the worker waits after finding nothing to do. */
  workerPollIntervalMs: number;

  /**
   * How long a worker's claim on a job is good for. Must outlast a real
   * objective, which takes minutes, or a healthy worker would lose its own
   * job to recovery mid-run.
   */
  workerLeaseMs: number;

  /** How many jobs one worker executes at once. */
  workerConcurrency: number;

  /**
   * How often the API reads the event log forward on behalf of everyone
   * watching. One read per organization per interval, and none when nobody is
   * connected - so this is the whole cost of the product feeling live.
   */
  streamTailIntervalMs: number;

  connect: ConnectConfig;
}

export function loadApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const port = Number(env.API_PORT ?? 4000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be a valid TCP port.");
  }

  return {
    port,
    supabaseUrl: requiredUrl(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: required(
      env,
      "SUPABASE_SERVICE_ROLE_KEY",
    ),
    ollamaBaseUrl: optionalUrl(
      env.OLLAMA_BASE_URL,
      "http://127.0.0.1:11434",
      "OLLAMA_BASE_URL",
    ),
    ollamaModel: env.OLLAMA_MODEL ?? "qwen3:8b",
    embeddingModel:
      env.OLLAMA_EMBEDDING_MODEL === undefined
        ? "nomic-embed-text"
        : env.OLLAMA_EMBEDDING_MODEL.trim() || undefined,
    seedDevelopmentWorkforce:
      env.SEED_DEVELOPMENT_WORKFORCE === "true",
    corsOrigins: parseCorsOrigins(env.API_CORS_ORIGINS),
    staleRunAfterMs: parseStaleRunMinutes(
      env.EXECUTION_STALE_AFTER_MINUTES,
    ) * 60_000,
    workerPollIntervalMs: positiveInteger(
      env.WORKER_POLL_INTERVAL_MS,
      2_000,
      "WORKER_POLL_INTERVAL_MS",
    ),
    // Ten minutes: comfortably longer than a real objective, so recovery only
    // fires for a worker that has genuinely stopped.
    workerLeaseMs: positiveInteger(
      env.WORKER_LEASE_MS,
      600_000,
      "WORKER_LEASE_MS",
    ),
    workerConcurrency: positiveInteger(
      env.WORKER_CONCURRENCY,
      2,
      "WORKER_CONCURRENCY",
    ),
    streamTailIntervalMs: positiveInteger(
      env.STREAM_TAIL_INTERVAL_MS,
      1_000,
      "STREAM_TAIL_INTERVAL_MS",
    ),
    connect: loadConnectConfig(env, port),
  };
}

function loadConnectConfig(env: NodeJS.ProcessEnv, port: number): ConnectConfig {
  const encryptionKey = env.CONNECT_ENCRYPTION_KEY?.trim() || undefined;
  const github = oauthClient(env, "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET");
  const googleDrive = oauthClient(env, "GOOGLE_DRIVE_CLIENT_ID", "GOOGLE_DRIVE_CLIENT_SECRET");

  if ((github || googleDrive) && !encryptionKey) {
    throw new Error(
      "CONNECT_ENCRYPTION_KEY is required when a connection provider is configured.",
    );
  }

  return {
    encryptionKey,
    github,
    googleDrive,
    publicApiUrl: optionalUrl(env.API_URL, `http://127.0.0.1:${port}`, "API_URL"),
    webUrl: optionalUrl(env.WEB_URL, "http://localhost:5173", "WEB_URL"),
  };
}

function oauthClient(
  env: NodeJS.ProcessEnv,
  idName: string,
  secretName: string,
): OAuthClientSettings | undefined {
  const clientId = env[idName]?.trim();
  const clientSecret = env[secretName]?.trim();

  if (!clientId && !clientSecret) {
    return undefined;
  }

  if (!clientId || !clientSecret) {
    throw new Error(`${idName} and ${secretName} must be set together.`);
  }

  return { clientId, clientSecret };
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function parseStaleRunMinutes(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 15;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      "EXECUTION_STALE_AFTER_MINUTES must be a positive number of minutes.",
    );
  }

  return parsed;
}

function parseCorsOrigins(value: string | undefined): string[] {
  const configuredOrigins = value?.split(",").map(
    (origin) => origin.trim(),
  ).filter(Boolean) ?? [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];

  return [...new Set(configuredOrigins.map((origin) => {
    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("API_CORS_ORIGINS must contain valid origins.");
    }

    if (
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        "API_CORS_ORIGINS entries must be origins without paths.",
      );
    }

    return parsed.origin;
  }))];
}

function required(
  env: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    );
  }

  return value;
}

function requiredUrl(
  env: NodeJS.ProcessEnv,
  name: string,
): string {
  return optionalUrl(required(env, name), "", name);
}

function optionalUrl(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  const resolved = value?.trim() || fallback;

  try {
    return new URL(resolved).toString().replace(/\/$/, "");
  } catch {
    throw new Error(
      `${name} must be a valid URL.`,
    );
  }
}
