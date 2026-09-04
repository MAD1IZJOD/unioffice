import dotenv from "dotenv";
import {
  fileURLToPath,
} from "node:url";

dotenv.config({
  path:
    process.env.UNIOFFICE_ENV_FILE ??
    fileURLToPath(
      new URL("../../.env", import.meta.url),
    ),
});

export interface ApiConfig {
  port: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  seedDevelopmentWorkforce: boolean;
  corsOrigins: string[];
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
    seedDevelopmentWorkforce:
      env.SEED_DEVELOPMENT_WORKFORCE === "true",
    corsOrigins: parseCorsOrigins(env.API_CORS_ORIGINS),
  };
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
