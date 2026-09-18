import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  // One .env for the whole repository. Only the two values a browser is meant
  // to hold are handed to the web app - the project URL and the public anon
  // key, which can do nothing the database's row-level security does not
  // allow. The service-role key is never read here.
  const env = loadEnv(mode, repositoryRoot, "");

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? env.SUPABASE_URL ?? "",
      ),
      "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(
        process.env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? "",
      ),
      // Where the browser reaches the API. Locally this is the API on this
      // machine; in a deployment it is whatever host the API is served from,
      // and it has to be set there - a build that inherits the local default
      // would send every tester's browser to their own computer.
      "import.meta.env.VITE_API_URL": JSON.stringify(
        process.env.VITE_API_URL ?? env.VITE_API_URL ?? env.API_URL ?? "",
      ),
    },
  };
});
