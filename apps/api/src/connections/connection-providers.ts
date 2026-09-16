import type {
  ConnectionCapability,
  ConnectionProvider,
} from "@unioffice/core";

import {
  DRIVE_SCOPES,
  DriveOAuth,
  GITHUB_SCOPES,
  GitHubOAuth,
  TokenCipher,
  type Fetch,
  type GitHubRepositoryAccess,
  type OAuthProvider,
} from "@unioffice/connect";

import type { ConnectConfig } from "../config.js";

/**
 * Which external systems this server can connect, and how to talk to each.
 *
 * Built once from configuration. A provider without its OAuth client, or a
 * server without the encryption key, is simply absent - the product shows it
 * as not set up rather than offering a button that cannot work.
 */

export interface ProviderInfo {
  provider: ConnectionProvider;
  name: string;
  description: string;
  capabilities: Array<{ capability: ConnectionCapability; label: string; access: "read" | "write" }>;
}

export const PROVIDER_INFO: Record<ConnectionProvider, ProviderInfo> = {
  github: {
    provider: "github",
    name: "GitHub",
    description: "Repositories, branches, issues, pull requests and commits.",
    capabilities: [
      { capability: "github.read", label: "Read repositories, issues, pull requests and commits", access: "read" },
      { capability: "github.write", label: "Open issues, create branches and open pull requests, each with a person's approval", access: "write" },
    ],
  },
  google_drive: {
    provider: "google_drive",
    name: "Google Drive",
    description: "Find and read documents. Read-only.",
    capabilities: [
      { capability: "drive.read", label: "List, search and read documents", access: "read" },
    ],
  },
};

export class ConnectionProviders {
  constructor(
    private readonly entries: ReadonlyMap<ConnectionProvider, OAuthProvider>,
    /** Absent when no encryption key is configured; nothing can be connected then. */
    readonly cipher?: TokenCipher,
  ) {}

  get(provider: ConnectionProvider): OAuthProvider | undefined {
    return this.cipher ? this.entries.get(provider) : undefined;
  }

  configured(provider: ConnectionProvider): boolean {
    return this.get(provider) !== undefined;
  }

  /** The scopes a new connection asks for. */
  scopesFor(provider: ConnectionProvider, repositoryAccess: GitHubRepositoryAccess = "public"): string[] {
    return provider === "github" ? [...GITHUB_SCOPES[repositoryAccess]] : [...DRIVE_SCOPES];
  }
}

export function createConnectionProviders(config: ConnectConfig, fetchImpl: Fetch = fetch): ConnectionProviders {
  const entries = new Map<ConnectionProvider, OAuthProvider>();

  if (config.github) {
    entries.set("github", new GitHubOAuth(config.github, fetchImpl));
  }

  if (config.googleDrive) {
    entries.set("google_drive", new DriveOAuth(config.googleDrive, fetchImpl));
  }

  // The key is validated here, at startup, so a malformed one stops the
  // process with a clear message instead of failing the first connection.
  const cipher = config.encryptionKey ? new TokenCipher(config.encryptionKey) : undefined;

  return new ConnectionProviders(entries, cipher);
}

/** Whether the scopes a provider granted can carry a capability at all. */
export function scopesAllow(provider: ConnectionProvider, scopes: string[], capability: ConnectionCapability): boolean {
  if (provider === "github") {
    // Reading public repositories needs no scope; both repository scopes can write.
    return capability === "github.read" || scopes.includes("repo") || scopes.includes("public_repo");
  }

  return capability === "drive.read" && scopes.includes(DRIVE_SCOPES[0]);
}
