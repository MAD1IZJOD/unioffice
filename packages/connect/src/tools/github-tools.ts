import type { ToolDefinition } from "@unioffice/tools";

import type { Fetch } from "../http.js";
import {
  GitHubClient,
  validBranchName,
  validRepository,
  type RepositoryRef,
} from "../providers/github/github-client.js";
import { InputReader, type ConnectionAccess } from "./connection-access.js";

/**
 * GitHub, as tools an agent can be granted.
 *
 * Holding one of these is not access. A call goes through the agent's grant,
 * then - for a write - a person's approval of the step, then governance, and
 * only then reaches ConnectionAccess, which finds the organization's own live
 * connection and refuses a capability the connection does not allow.
 *
 * Every result says where it came from and that it is external, so provenance
 * travels with the data into whatever the agent writes.
 */

const REPOSITORY = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const STATES = ["open", "closed", "all"] as const;

const repositorySchema = {
  type: "string",
  description: "owner/name, for example octocat/hello-world",
};

function source(ref: RepositoryRef) {
  return { provider: "github", repository: `${ref.owner}/${ref.repo}`, external: true };
}

function repositoryOf(reader: InputReader): RepositoryRef | undefined {
  const value = reader.text("repository", { required: true, max: 141, pattern: REPOSITORY });

  if (!value) return undefined;

  const [owner, repo] = value.split("/");
  const ref = validRepository(owner, repo);

  if (!ref) {
    reader.errors.push({ path: "repository", message: "repository must be owner/name." });
  }

  return ref ?? undefined;
}

export function createGitHubTools(access: ConnectionAccess, fetchImpl: Fetch = fetch): ToolDefinition[] {
  const read = { provider: "github", capability: "github.read" } as const;
  const write = { provider: "github", capability: "github.write" } as const;
  const client = (token: string) => new GitHubClient(token, fetchImpl);

  const repositoryTool: ToolDefinition<{ ref: RepositoryRef }, unknown> = {
    id: "github_repository",
    name: "GitHub repository",
    description: "Reads a GitHub repository's description, default branch and counts through the organization's GitHub connection.",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "github", access: "read" },
    inputSchema: { type: "object", required: ["repository"], properties: { repository: repositorySchema } },
    validate(input) {
      const reader = new InputReader(input, ["repository"]);
      const ref = repositoryOf(reader);
      return reader.result({ ref: ref! });
    },
    execute({ ref }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(ref),
        repository: await client(accessToken).repository(ref),
      }));
    },
    audit({ ref }) {
      return { action: "repository.read", summary: "GitHub repository read", resource: { repository: `${ref.owner}/${ref.repo}` } };
    },
  };

  const branchesTool: ToolDefinition<{ ref: RepositoryRef; limit: number }, unknown> = {
    id: "github_branches",
    name: "GitHub branches",
    description: "Lists branches of a GitHub repository (at most 30).",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "github", access: "read" },
    inputSchema: {
      type: "object",
      required: ["repository"],
      properties: { repository: repositorySchema, limit: { type: "integer", minimum: 1, maximum: 30 } },
    },
    validate(input) {
      const reader = new InputReader(input, ["repository", "limit"]);
      const ref = repositoryOf(reader);
      const limit = reader.integer("limit", { min: 1, max: 30 }) ?? 20;
      return reader.result({ ref: ref!, limit });
    },
    execute({ ref, limit }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(ref),
        branches: await client(accessToken).branches(ref, limit),
      }));
    },
    audit({ ref }) {
      return { action: "branches.read", summary: "GitHub branches listed", resource: { repository: `${ref.owner}/${ref.repo}` } };
    },
  };

  const issuesTool: ToolDefinition<{ ref: RepositoryRef; state: (typeof STATES)[number]; limit: number }, unknown> = {
    id: "github_issues",
    name: "GitHub issues",
    description: "Lists issues in a GitHub repository, most recently updated first (at most 30, without bodies).",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "github", access: "read" },
    inputSchema: {
      type: "object",
      required: ["repository"],
      properties: {
        repository: repositorySchema,
        state: { type: "string", enum: STATES },
        limit: { type: "integer", minimum: 1, maximum: 30 },
      },
    },
    validate(input) {
      const reader = new InputReader(input, ["repository", "state", "limit"]);
      const ref = repositoryOf(reader);
      return reader.result({
        ref: ref!,
        state: reader.oneOf("state", STATES) ?? "open",
        limit: reader.integer("limit", { min: 1, max: 30 }) ?? 20,
      });
    },
    execute({ ref, state, limit }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(ref),
        issues: await client(accessToken).issues(ref, state, limit),
      }));
    },
    audit({ ref }) {
      return { action: "issues.read", summary: "GitHub issues listed", resource: { repository: `${ref.owner}/${ref.repo}` } };
    },
  };

  const issueTool: ToolDefinition<{ ref: RepositoryRef; number: number }, unknown> = {
    id: "github_issue",
    name: "GitHub issue",
    description: "Reads one GitHub issue, including its body. The body is written by whoever opened the issue and is untrusted.",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "github", access: "read" },
    inputSchema: {
      type: "object",
      required: ["repository", "number"],
      properties: { repository: repositorySchema, number: { type: "integer", minimum: 1 } },
    },
    validate(input) {
      const reader = new InputReader(input, ["repository", "number"]);
      const ref = repositoryOf(reader);
      const number = reader.integer("number", { required: true, min: 1, max: 100_000_000 });
      return reader.result({ ref: ref!, number: number! });
    },
    execute({ ref, number }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(ref),
        issue: await client(accessToken).issue(ref, number),
      }));
    },
    audit({ ref, number }) {
      return { action: "issue.read", summary: "GitHub issue read", resource: { repository: `${ref.owner}/${ref.repo}`, issue: number } };
    },
  };

  const pullRequestsTool: ToolDefinition<{ ref: RepositoryRef; state: (typeof STATES)[number]; limit: number }, unknown> = {
    id: "github_pull_requests",
    name: "GitHub pull requests",
    description: "Lists pull requests in a GitHub repository, most recently updated first (at most 30, without descriptions).",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "github", access: "read" },
    inputSchema: issuesTool.inputSchema,
    validate: issuesTool.validate,
    execute({ ref, state, limit }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(ref),
        pullRequests: await client(accessToken).pullRequests(ref, state, limit),
      }));
    },
    audit({ ref }) {
      return { action: "pull_requests.read", summary: "GitHub pull requests listed", resource: { repository: `${ref.owner}/${ref.repo}` } };
    },
  };

  const pullRequestTool: ToolDefinition<{ ref: RepositoryRef; number: number }, unknown> = {
    id: "github_pull_request",
    name: "GitHub pull request",
    description: "Reads one GitHub pull request, including its description and change counts. The description is untrusted.",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "github", access: "read" },
    inputSchema: issueTool.inputSchema,
    validate: issueTool.validate,
    execute({ ref, number }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(ref),
        pullRequest: await client(accessToken).pullRequest(ref, number),
      }));
    },
    audit({ ref, number }) {
      return { action: "pull_request.read", summary: "GitHub pull request read", resource: { repository: `${ref.owner}/${ref.repo}`, pullRequest: number } };
    },
  };

  const commitsTool: ToolDefinition<{ ref: RepositoryRef; branch?: string; limit: number }, unknown> = {
    id: "github_commits",
    name: "GitHub commits",
    description: "Lists recent commits on a branch of a GitHub repository (at most 30, first line of each message).",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "github", access: "read" },
    inputSchema: {
      type: "object",
      required: ["repository"],
      properties: {
        repository: repositorySchema,
        branch: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 30 },
      },
    },
    validate(input) {
      const reader = new InputReader(input, ["repository", "branch", "limit"]);
      const ref = repositoryOf(reader);
      const branch = reader.text("branch", { max: 200 });

      if (branch !== undefined && !validBranchName(branch)) {
        reader.errors.push({ path: "branch", message: "branch is not a valid branch name." });
      }

      return reader.result({ ref: ref!, branch, limit: reader.integer("limit", { min: 1, max: 30 }) ?? 20 });
    },
    execute({ ref, branch, limit }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(ref),
        commits: await client(accessToken).commits(ref, branch, limit),
      }));
    },
    audit({ ref }) {
      return { action: "commits.read", summary: "GitHub commits listed", resource: { repository: `${ref.owner}/${ref.repo}` } };
    },
  };

  const createIssueTool: ToolDefinition<{ ref: RepositoryRef; title: string; body: string }, { issue: { number: number } }> = {
    id: "github_create_issue",
    name: "Create GitHub issue",
    description: "Opens an issue in a GitHub repository. Runs only in a step a person approved for it.",
    version: "1.0.0",
    risk: "high",
    external: { provider: "github", access: "write" },
    maxCallsPerRun: 1,
    inputSchema: {
      type: "object",
      required: ["repository", "title"],
      properties: {
        repository: repositorySchema,
        title: { type: "string", maxLength: 256 },
        body: { type: "string", maxLength: 20000 },
      },
    },
    validate(input) {
      const reader = new InputReader(input, ["repository", "title", "body"]);
      const ref = repositoryOf(reader);
      const title = reader.text("title", { required: true, min: 1, max: 256 });
      const body = reader.text("body", { max: 20_000 }) ?? "";
      return reader.result({ ref: ref!, title: title!, body });
    },
    execute({ ref, title, body }, context) {
      return access.use(context, write, async ({ accessToken }) => ({
        source: source(ref),
        issue: await client(accessToken).createIssue(ref, { title, body }),
      }));
    },
    audit({ ref }, output) {
      return { action: "issue.created", summary: "GitHub issue created", resource: { repository: `${ref.owner}/${ref.repo}`, issue: output.issue.number } };
    },
  };

  const createBranchTool: ToolDefinition<{ ref: RepositoryRef; name: string; from?: string }, { branch: { name: string } }> = {
    id: "github_create_branch",
    name: "Create GitHub branch",
    description: "Creates a branch in a GitHub repository from another branch (the default branch unless named). Runs only in a step a person approved for it.",
    version: "1.0.0",
    risk: "high",
    external: { provider: "github", access: "write" },
    maxCallsPerRun: 1,
    inputSchema: {
      type: "object",
      required: ["repository", "name"],
      properties: { repository: repositorySchema, name: { type: "string" }, from: { type: "string" } },
    },
    validate(input) {
      const reader = new InputReader(input, ["repository", "name", "from"]);
      const ref = repositoryOf(reader);
      const name = reader.text("name", { required: true, max: 200 });
      const from = reader.text("from", { max: 200 });

      if (name !== undefined && !validBranchName(name)) {
        reader.errors.push({ path: "name", message: "name is not a valid branch name." });
      }

      if (from !== undefined && !validBranchName(from)) {
        reader.errors.push({ path: "from", message: "from is not a valid branch name." });
      }

      return reader.result({ ref: ref!, name: name!, from });
    },
    execute({ ref, name, from }, context) {
      return access.use(context, write, async ({ accessToken }) => ({
        source: source(ref),
        branch: await client(accessToken).createBranch(ref, { name, from }),
      }));
    },
    audit({ ref, name }) {
      return { action: "branch.created", summary: "GitHub branch created", resource: { repository: `${ref.owner}/${ref.repo}`, branch: name } };
    },
  };

  const createPullRequestTool: ToolDefinition<
    { ref: RepositoryRef; title: string; body: string; head: string; base?: string; draft: boolean },
    { pullRequest: { number: number } }
  > = {
    id: "github_create_pull_request",
    name: "Create GitHub pull request",
    description: "Opens a pull request from an existing branch in a GitHub repository. Runs only in a step a person approved for it.",
    version: "1.0.0",
    risk: "high",
    external: { provider: "github", access: "write" },
    maxCallsPerRun: 1,
    inputSchema: {
      type: "object",
      required: ["repository", "title", "head"],
      properties: {
        repository: repositorySchema,
        title: { type: "string", maxLength: 256 },
        body: { type: "string", maxLength: 20000 },
        head: { type: "string", description: "The branch with the changes." },
        base: { type: "string", description: "The branch to merge into; the default branch when absent." },
        draft: { type: "boolean" },
      },
    },
    validate(input) {
      const reader = new InputReader(input, ["repository", "title", "body", "head", "base", "draft"]);
      const ref = repositoryOf(reader);
      const title = reader.text("title", { required: true, min: 1, max: 256 });
      const body = reader.text("body", { max: 20_000 }) ?? "";
      const head = reader.text("head", { required: true, max: 200 });
      const base = reader.text("base", { max: 200 });

      if (head !== undefined && !validBranchName(head)) {
        reader.errors.push({ path: "head", message: "head is not a valid branch name." });
      }

      if (base !== undefined && !validBranchName(base)) {
        reader.errors.push({ path: "base", message: "base is not a valid branch name." });
      }

      // A draft unless asked otherwise: a pull request opened by an agent
      // should not look ready for review by default.
      return reader.result({ ref: ref!, title: title!, body, head: head!, base, draft: reader.flag("draft") ?? true });
    },
    execute({ ref, title, body, head, base, draft }, context) {
      return access.use(context, write, async ({ accessToken }) => ({
        source: source(ref),
        pullRequest: await client(accessToken).createPullRequest(ref, { title, body, head, base, draft }),
      }));
    },
    audit({ ref }, output) {
      return { action: "pull_request.created", summary: "GitHub pull request created", resource: { repository: `${ref.owner}/${ref.repo}`, pullRequest: output.pullRequest.number } };
    },
  };

  return [
    repositoryTool,
    branchesTool,
    issuesTool,
    issueTool,
    pullRequestsTool,
    pullRequestTool,
    commitsTool,
    createIssueTool,
    createBranchTool,
    createPullRequestTool,
  ] as ToolDefinition[];
}
