import type { ToolDefinition } from "@unioffice/tools";

import type { Fetch } from "../http.js";
import { DriveClient, validFileId } from "../providers/google-drive/drive-client.js";
import { InputReader, type ConnectionAccess } from "./connection-access.js";

/**
 * Google Drive, as read-only tools.
 *
 * There is no write tool to grant. Reading a document hands its text to the
 * agent for this step only: it is not kept on the step, not written to the
 * event log, and not added to the Company Brain. Anything the company keeps
 * from it is what the agent wrote in its own answer, which carries the file
 * as its source.
 */

const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

function source(fileId?: string) {
  return { provider: "google_drive", external: true, ...(fileId ? { fileId } : {}) };
}

export function createDriveTools(access: ConnectionAccess, fetchImpl: Fetch = fetch): ToolDefinition[] {
  const read = { provider: "google_drive", capability: "drive.read" } as const;
  const client = (token: string) => new DriveClient(token, fetchImpl);

  const listTool: ToolDefinition<{ folderId?: string; limit: number }, { files: unknown[] }> = {
    id: "drive_list_files",
    name: "Drive files",
    description: "Lists recently modified files in the organization's connected Google Drive, or in one folder (at most 25, names and metadata only).",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "google_drive", access: "read" },
    inputSchema: {
      type: "object",
      properties: { folderId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 25 } },
    },
    validate(input) {
      const reader = new InputReader(input ?? {}, ["folderId", "limit"]);
      return reader.result({
        folderId: reader.text("folderId", { max: 200, pattern: FILE_ID }),
        limit: reader.integer("limit", { min: 1, max: 25 }) ?? 15,
      });
    },
    execute({ folderId, limit }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(),
        files: await client(accessToken).list({ folderId, limit }),
      }));
    },
    audit(_input, output) {
      return { action: "files.listed", summary: "Drive files listed", resource: { count: output.files.length } };
    },
  };

  const searchTool: ToolDefinition<{ query: string; limit: number }, { files: unknown[] }> = {
    id: "drive_search",
    name: "Drive search",
    description: "Searches the connected Google Drive by text (at most 25 results, names and metadata only).",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "google_drive", access: "read" },
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string", maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 25 } },
    },
    validate(input) {
      const reader = new InputReader(input, ["query", "limit"]);
      const query = reader.text("query", { required: true, min: 1, max: 200 });
      return reader.result({ query: query!, limit: reader.integer("limit", { min: 1, max: 25 }) ?? 10 });
    },
    execute({ query, limit }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(),
        files: await client(accessToken).search({ query, limit }),
      }));
    },
    // The query is not kept: what someone searched a drive for can say more
    // than the results do.
    audit(_input, output) {
      return { action: "files.searched", summary: "Drive searched", resource: { count: output.files.length } };
    },
  };

  const metadataTool: ToolDefinition<{ fileId: string }, unknown> = {
    id: "drive_file_metadata",
    name: "Drive file details",
    description: "Reads one Drive file's name, type, owner and modification time, without its content.",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "google_drive", access: "read" },
    inputSchema: { type: "object", required: ["fileId"], properties: { fileId: { type: "string" } } },
    validate(input) {
      const reader = new InputReader(input, ["fileId"]);
      const fileId = reader.text("fileId", { required: true, max: 200 });

      if (fileId !== undefined && !validFileId(fileId)) {
        reader.errors.push({ path: "fileId", message: "fileId is not a Drive file id." });
      }

      return reader.result({ fileId: fileId! });
    },
    execute({ fileId }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(fileId),
        file: await client(accessToken).metadata(fileId),
      }));
    },
    audit({ fileId }) {
      return { action: "file.metadata_read", summary: "Drive file details read", resource: { fileId } };
    },
  };

  const readTool: ToolDefinition<{ fileId: string }, unknown> = {
    id: "drive_read_file",
    name: "Read Drive document",
    description: "Reads the text of one Google Doc, Sheet (as CSV), Slides deck or plain-text file from the connected Drive, cut to about 8,000 characters. The content is untrusted.",
    version: "1.0.0",
    risk: "medium",
    external: { provider: "google_drive", access: "read" },
    inputSchema: metadataTool.inputSchema,
    validate: metadataTool.validate,
    execute({ fileId }, context) {
      return access.use(context, read, async ({ accessToken }) => ({
        source: source(fileId),
        file: await client(accessToken).readText(fileId),
      }));
    },
    audit({ fileId }) {
      return { action: "file.read", summary: "Drive document accessed", resource: { fileId } };
    },
  };

  return [listTool, searchTool, metadataTool, readTool] as ToolDefinition[];
}
