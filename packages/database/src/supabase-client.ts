import { createClient } from "@supabase/supabase-js";

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    );
  }

  return value;
}

export function createSupabaseAdminClient(fetchImpl: typeof fetch = fetch) {
  return createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      global: { fetch: fetchImpl },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
