import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

/**
 * The browser's Supabase client, used for signing in and nothing else.
 *
 * It holds only the public anon key. Every read and write of company data goes
 * through the UNIOFFICE API with the signed-in user's access token, where
 * membership and permissions are checked; the browser never talks to the
 * database tables directly. Null when the project is not configured.
 */
export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  client = url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          flowType: "pkce",
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;

  return client;
}
