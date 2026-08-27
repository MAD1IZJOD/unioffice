import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

function getRequiredEnv(
  name: string,
): string {
  const value =
    process.env[name];

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}`,
    );
  }

  return value;
}

export function createSupabaseClient(): SupabaseClient {
  const url =
    getRequiredEnv(
      "SUPABASE_URL",
    );

  const serviceRoleKey =
    getRequiredEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
    );

  return createClient(
    url,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
