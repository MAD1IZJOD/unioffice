import { ConnectorError } from "../../errors.js";
import { providerJson, providerRequest, type Fetch } from "../../http.js";
import { cleanExternalText, cleanLabel, cleanUrl } from "../../sanitize.js";
import { DRIVE_API } from "./drive-oauth.js";

/**
 * Read-only Drive access.
 *
 * There is no method here that creates, changes, moves, shares or deletes
 * anything, and the scope the connection holds could not do so anyway. Lists
 * are one bounded page. Content is read only for text a person could read -
 * Google Docs, Sheets and Slides exported as plain text, and files that are
 * already text - and is cut in the stream, so a large file is never pulled
 * down whole to be trimmed afterwards.
 */

const HOSTS = ["docs.google.com", "drive.google.com"] as const;
const MAX_PAGE = 25;
const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_CONTENT_CHARS = 8_000;
const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;

const FILE_FIELDS = "id,name,mimeType,modifiedTime,size,webViewLink,owners(displayName),trashed";

/** Google's own formats, and what each is exported as. */
const EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

const TEXT_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "text/csv",
]);

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedAt?: string;
  sizeBytes?: number;
  owner?: string;
  url?: string;
}

export function validFileId(value: unknown): value is string {
  return typeof value === "string" && FILE_ID.test(value);
}

export class DriveClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async list(input: { folderId?: string; limit: number }): Promise<DriveFile[]> {
    const terms = ["trashed = false"];

    if (input.folderId) {
      if (!validFileId(input.folderId)) {
        throw new ConnectorError("input_invalid", { message: "That is not a Drive folder id." });
      }

      terms.push(`'${input.folderId}' in parents`);
    }

    return this.files(terms.join(" and "), input.limit, "modifiedTime desc");
  }

  async search(input: { query: string; limit: number }): Promise<DriveFile[]> {
    const text = escapeQuery(input.query);
    // Full-text search already matches names; ordering is not allowed with it.
    return this.files(`fullText contains '${text}' and trashed = false`, input.limit);
  }

  async metadata(fileId: string): Promise<DriveFile> {
    const raw = await this.json<Record<string, unknown>>(
      `/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`,
    );

    if (raw.trashed === true) {
      throw new ConnectorError("not_found");
    }

    return file(raw);
  }

  async readText(fileId: string): Promise<DriveFile & { content: string; truncated: boolean; format: string }> {
    const meta = await this.metadata(fileId);
    const exportAs = EXPORTS[meta.mimeType];

    let url: string;

    if (exportAs) {
      url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportAs)}`;
    } else if (meta.mimeType.startsWith("text/") || TEXT_TYPES.has(meta.mimeType)) {
      url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    } else {
      // PDFs, images, archives, office binaries: not read, rather than read badly.
      throw new ConnectorError("unsupported_content");
    }

    const response = await providerRequest(this.fetchImpl, url, {
      headers: this.headers(),
      maxBytes: MAX_CONTENT_BYTES,
      timeoutMs: 20_000,
    });

    const content = cleanExternalText(response.text, MAX_CONTENT_CHARS);

    return {
      ...meta,
      content: content.text,
      truncated: response.truncated || content.truncated,
      format: exportAs ?? meta.mimeType,
    };
  }

  private async files(query: string, limit: number, orderBy?: string): Promise<DriveFile[]> {
    const params = new URLSearchParams({
      q: query,
      pageSize: String(Math.max(1, Math.min(MAX_PAGE, Math.floor(limit)))),
      fields: `files(${FILE_FIELDS})`,
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      spaces: "drive",
    });

    if (orderBy) {
      params.set("orderBy", orderBy);
    }

    const raw = await this.json<{ files?: unknown }>(`/files?${params.toString()}`);

    if (!Array.isArray(raw.files)) {
      throw new ConnectorError("malformed_response");
    }

    return raw.files
      .slice(0, MAX_PAGE)
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .filter((entry) => entry.trashed !== true)
      .map(file);
  }

  private async json<T>(route: string): Promise<T> {
    const value = await providerJson<T>(this.fetchImpl, `${DRIVE_API}${route}`, { headers: this.headers() });

    if (value === undefined || value === null || typeof value !== "object") {
      throw new ConnectorError("malformed_response");
    }

    return value;
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.accessToken}` };
  }
}

/** Drive's query language quotes with single quotes and escapes with backslashes. */
export function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function file(raw: Record<string, unknown>): DriveFile {
  const id = validFileId(raw.id) ? raw.id : "";

  if (!id) {
    throw new ConnectorError("malformed_response");
  }

  const size = Number(raw.size);
  const owners = Array.isArray(raw.owners) ? (raw.owners as Array<{ displayName?: unknown }>) : [];
  const modified = typeof raw.modifiedTime === "string" ? new Date(raw.modifiedTime) : undefined;

  return {
    id,
    name: cleanLabel(raw.name, 300),
    mimeType: cleanLabel(raw.mimeType, 120),
    modifiedAt: modified && !Number.isNaN(modified.getTime()) ? modified.toISOString() : undefined,
    sizeBytes: Number.isFinite(size) && size >= 0 ? size : undefined,
    owner: cleanLabel(owners[0]?.displayName, 120) || undefined,
    url: cleanUrl(raw.webViewLink, HOSTS),
  };
}
