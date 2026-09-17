import { AuthClient } from "@supabase/auth-js";

/** The client this app holds: sign-in, and the session behind it. */
export type SignIn = InstanceType<typeof AuthClient>;

let client: SignIn | null | undefined;

/**
 * Sign-in, and nothing else.
 *
 * This is the auth client rather than the whole Supabase client, because
 * signing in is all the browser does with Supabase: every read and write of
 * company data goes through the UNIOFFICE API with the signed-in user's
 * access token, where membership and permissions are checked. The browser
 * never talks to the database, so the parts of the SDK that would - tables,
 * storage, realtime, functions - have no reason to be shipped to it.
 *
 * It holds only the public anon key. Null when the project is not configured.
 */
export function supabaseAuth(): SignIn | null {
  if (client !== undefined) return client;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  client = url && anonKey
    ? new AuthClient({
        url: `${url.replace(/\/$/, "")}/auth/v1`,
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        storageKey: `sb-${projectRef(url)}-auth-token`,
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      })
    : null;

  return client;
}

/**
 * The project's reference, which is what the Supabase SDK names its stored
 * session after. Keeping the same key means a session from before this change
 * is still found, and a person is not signed out by an upgrade.
 */
function projectRef(url: string): string {
  return new URL(url).hostname.split(".")[0] ?? "default";
}
