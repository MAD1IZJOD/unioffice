import type { UserId } from "@unioffice/core";

import type { UserDirectory } from "./owner-claim.js";

const PAGE_SIZE = 200;
const MAX_PAGES = 100;

interface AdminUserLister {
  auth: {
    admin: {
      listUsers(params: { page: number; perPage: number }): Promise<{
        data: { users: Array<{ id: string; email?: string | null; email_confirmed_at?: string | null }> };
        error: unknown;
      }>;
    };
  };
}

/**
 * Looks a person up on the auth server by email. Server-side only: it needs
 * the service-role client, which never leaves the API process.
 */
export class SupabaseUserDirectory implements UserDirectory {
  constructor(private readonly client: AdminUserLister) {}

  async findByEmail(email: string): Promise<{ id: UserId; emailConfirmed: boolean } | null> {
    const wanted = email.trim().toLowerCase();

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, error } = await this.client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });

      if (error) throw new Error("Could not read users from the auth server.");

      const match = data.users.find((user) => user.email?.toLowerCase() === wanted);

      if (match) {
        return { id: match.id as UserId, emailConfirmed: Boolean(match.email_confirmed_at) };
      }

      if (data.users.length < PAGE_SIZE) return null;
    }

    return null;
  }
}
