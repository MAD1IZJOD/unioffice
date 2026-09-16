import { ConnectorError } from "../../errors.js";
import { providerJson, type Fetch } from "../../http.js";
import { cleanExternalText, cleanLabel, cleanUrl } from "../../sanitize.js";
import { GITHUB_API, githubHeaders } from "./github-oauth.js";

/**
 * The parts of GitHub agents may reach.
 *
 * Every read is one request for one bounded page - never a paginated walk of
 * a repository - and every response is reduced to the fields named here, with
 * text cleaned and cut. Nothing is downloaded that the answer does not need:
 * no file trees, no diffs, no archives.
 */

export interface RepositoryRef {
  owner: string;
  repo: string;
}

const HOSTS = ["github.com"] as const;
const MAX_BODY_CHARS = 6_000;
const MAX_PAGE = 30;

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export function validRepository(owner: unknown, repo: unknown): RepositoryRef | null {
  return typeof owner === "string" && typeof repo === "string" &&
    OWNER.test(owner) && REPO.test(repo) && repo !== "." && repo !== ".."
    ? { owner, repo }
    : null;
}

/** Git's own ref rules, the ones a name from a model could plausibly break. */
export function validBranchName(name: unknown): name is string {
  return typeof name === "string" &&
    name.length > 0 && name.length <= 200 &&
    /^[A-Za-z0-9._/-]+$/.test(name) &&
    !name.startsWith("/") && !name.endsWith("/") && !name.startsWith("-") &&
    !name.endsWith(".") && !name.endsWith(".lock") &&
    !name.includes("..") && !name.includes("//") && !name.includes("@{");
}

export interface GitHubRepository {
  fullName: string;
  description: string;
  private: boolean;
  defaultBranch: string;
  openIssues: number;
  stars: number;
  language?: string;
  updatedAt?: string;
  url?: string;
}

export interface GitHubIssueSummary {
  number: number;
  title: string;
  state: string;
  author: string;
  labels: string[];
  comments: number;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  author: string;
  head: string;
  base: string;
  updatedAt?: string;
  url?: string;
}

interface Account { login?: unknown }
interface Label { name?: unknown }

export class GitHubClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async repository(ref: RepositoryRef): Promise<GitHubRepository> {
    const raw = await this.get<Record<string, unknown>>(`/repos/${path(ref)}`);

    return {
      fullName: cleanLabel(raw.full_name, 200),
      description: cleanLabel(raw.description, 500),
      private: raw.private === true,
      defaultBranch: cleanLabel(raw.default_branch, 200),
      openIssues: count(raw.open_issues_count),
      stars: count(raw.stargazers_count),
      language: cleanLabel(raw.language, 60) || undefined,
      updatedAt: date(raw.pushed_at ?? raw.updated_at),
      url: cleanUrl(raw.html_url, HOSTS),
    };
  }

  async branches(ref: RepositoryRef, limit: number): Promise<Array<{ name: string; protected: boolean; sha: string }>> {
    const raw = await this.get<unknown[]>(`/repos/${path(ref)}/branches?per_page=${page(limit)}`);

    return list(raw).map((entry) => ({
      name: cleanLabel(entry.name, 200),
      protected: entry.protected === true,
      sha: shortSha((entry.commit as Record<string, unknown> | undefined)?.sha),
    }));
  }

  async issues(ref: RepositoryRef, state: "open" | "closed" | "all", limit: number): Promise<GitHubIssueSummary[]> {
    const raw = await this.get<unknown[]>(
      `/repos/${path(ref)}/issues?state=${state}&per_page=${page(limit)}&sort=updated&direction=desc`,
    );

    // The issues endpoint returns pull requests too; they are read separately.
    return list(raw).filter((entry) => entry.pull_request === undefined).map(issueSummary);
  }

  async issue(ref: RepositoryRef, number: number): Promise<GitHubIssueSummary & { body: string; bodyTruncated: boolean }> {
    const raw = await this.get<Record<string, unknown>>(`/repos/${path(ref)}/issues/${number}`);

    if (raw.pull_request !== undefined) {
      throw new ConnectorError("not_found", { message: "That number is a pull request, not an issue." });
    }

    const body = cleanExternalText(raw.body, MAX_BODY_CHARS);
    return { ...issueSummary(raw), body: body.text, bodyTruncated: body.truncated };
  }

  async pullRequests(ref: RepositoryRef, state: "open" | "closed" | "all", limit: number): Promise<GitHubPullRequestSummary[]> {
    const raw = await this.get<unknown[]>(
      `/repos/${path(ref)}/pulls?state=${state}&per_page=${page(limit)}&sort=updated&direction=desc`,
    );

    return list(raw).map(pullSummary);
  }

  async pullRequest(ref: RepositoryRef, number: number): Promise<GitHubPullRequestSummary & {
    body: string;
    bodyTruncated: boolean;
    merged: boolean;
    additions: number;
    deletions: number;
    changedFiles: number;
  }> {
    const raw = await this.get<Record<string, unknown>>(`/repos/${path(ref)}/pulls/${number}`);
    const body = cleanExternalText(raw.body, MAX_BODY_CHARS);

    return {
      ...pullSummary(raw),
      body: body.text,
      bodyTruncated: body.truncated,
      merged: raw.merged === true,
      additions: count(raw.additions),
      deletions: count(raw.deletions),
      changedFiles: count(raw.changed_files),
    };
  }

  async commits(ref: RepositoryRef, branch: string | undefined, limit: number): Promise<Array<{
    sha: string;
    message: string;
    author: string;
    date?: string;
    url?: string;
  }>> {
    const on = branch ? `&sha=${encodeURIComponent(branch)}` : "";
    const raw = await this.get<unknown[]>(`/repos/${path(ref)}/commits?per_page=${page(limit)}${on}`);

    return list(raw).map((entry) => {
      const commit = (entry.commit ?? {}) as Record<string, unknown>;
      const author = (commit.author ?? {}) as Record<string, unknown>;
      const message = typeof commit.message === "string" ? commit.message.split("\n")[0] : "";

      return {
        sha: shortSha(entry.sha),
        message: cleanLabel(message, 200),
        author: cleanLabel((entry.author as Account | null)?.login ?? author.name, 100),
        date: date(author.date),
        url: cleanUrl(entry.html_url, HOSTS),
      };
    });
  }

  async createIssue(ref: RepositoryRef, input: { title: string; body: string }): Promise<{ number: number; url?: string }> {
    const raw = await this.send<Record<string, unknown>>("POST", `/repos/${path(ref)}/issues`, {
      title: input.title,
      body: input.body,
    });

    return { number: count(raw.number), url: cleanUrl(raw.html_url, HOSTS) };
  }

  async createBranch(ref: RepositoryRef, input: { name: string; from?: string }): Promise<{ name: string; sha: string }> {
    const from = input.from ?? (await this.repository(ref)).defaultBranch;

    if (!validBranchName(from)) {
      throw new ConnectorError("input_invalid", { message: "The branch to start from is not a valid branch name." });
    }

    const base = await this.get<{ object?: { sha?: unknown } }>(
      `/repos/${path(ref)}/git/ref/heads/${from.split("/").map(encodeURIComponent).join("/")}`,
    );
    const sha = typeof base.object?.sha === "string" && /^[0-9a-f]{40}$/.test(base.object.sha) ? base.object.sha : null;

    if (!sha) {
      throw new ConnectorError("malformed_response");
    }

    await this.send("POST", `/repos/${path(ref)}/git/refs`, { ref: `refs/heads/${input.name}`, sha });
    return { name: input.name, sha: sha.slice(0, 12) };
  }

  async createPullRequest(ref: RepositoryRef, input: {
    title: string;
    body: string;
    head: string;
    base?: string;
    draft: boolean;
  }): Promise<{ number: number; url?: string }> {
    const base = input.base ?? (await this.repository(ref)).defaultBranch;

    const raw = await this.send<Record<string, unknown>>("POST", `/repos/${path(ref)}/pulls`, {
      title: input.title,
      body: input.body,
      head: input.head,
      base,
      draft: input.draft,
    });

    return { number: count(raw.number), url: cleanUrl(raw.html_url, HOSTS) };
  }

  private async get<T>(route: string): Promise<T> {
    const value = await providerJson<T>(this.fetchImpl, `${GITHUB_API}${route}`, {
      headers: githubHeaders(this.accessToken),
    });

    if (value === undefined || value === null || typeof value !== "object") {
      throw new ConnectorError("malformed_response");
    }

    return value;
  }

  private async send<T = unknown>(method: "POST", route: string, body: unknown): Promise<T> {
    const value = await providerJson<T>(this.fetchImpl, `${GITHUB_API}${route}`, {
      method,
      headers: { ...githubHeaders(this.accessToken), "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (value === undefined || value === null || typeof value !== "object") {
      throw new ConnectorError("malformed_response");
    }

    return value;
  }
}

function path(ref: RepositoryRef): string {
  return `${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
}

function page(limit: number): number {
  return Math.max(1, Math.min(MAX_PAGE, Math.floor(limit)));
}

function list(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new ConnectorError("malformed_response");
  }

  return value
    .slice(0, MAX_PAGE)
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function date(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function shortSha(value: unknown): string {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/.test(value) ? value.slice(0, 12) : "";
}

function issueSummary(raw: Record<string, unknown>): GitHubIssueSummary {
  return {
    number: count(raw.number),
    title: cleanLabel(raw.title, 300),
    state: cleanLabel(raw.state, 20),
    author: cleanLabel((raw.user as Account | null)?.login, 100),
    labels: Array.isArray(raw.labels)
      ? (raw.labels as Label[]).slice(0, 10).map((label) => cleanLabel(label?.name, 60)).filter(Boolean)
      : [],
    comments: count(raw.comments),
    createdAt: date(raw.created_at),
    updatedAt: date(raw.updated_at),
    url: cleanUrl(raw.html_url, HOSTS),
  };
}

function pullSummary(raw: Record<string, unknown>): GitHubPullRequestSummary {
  return {
    number: count(raw.number),
    title: cleanLabel(raw.title, 300),
    state: cleanLabel(raw.state, 20),
    draft: raw.draft === true,
    author: cleanLabel((raw.user as Account | null)?.login, 100),
    head: cleanLabel((raw.head as { ref?: unknown } | undefined)?.ref, 200),
    base: cleanLabel((raw.base as { ref?: unknown } | undefined)?.ref, 200),
    updatedAt: date(raw.updated_at),
    url: cleanUrl(raw.html_url, HOSTS),
  };
}
