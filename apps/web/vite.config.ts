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
  const inheritedNodeEnv = process.env.VITE_USER_NODE_ENV;
  const env = loadEnv(mode, repositoryRoot, "");

  // That .env also sets NODE_ENV for the API and the worker, and loadEnv
  // passes any NODE_ENV it reads on to Vite as the web build's own. Left in
  // place, `vite build` shipped React's development build - several times the
  // size and much slower. The web app's mode comes from the command that runs
  // it, not from the servers' settings.
  if (inheritedNodeEnv === undefined) delete process.env.VITE_USER_NODE_ENV;

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
      // The origin this build is served from, used to decide where sign-in is
      // allowed to return to. Empty in development, where localhost is used.
      "import.meta.env.VITE_APP_ORIGIN": JSON.stringify(
        process.env.VITE_APP_ORIGIN ?? env.VITE_APP_ORIGIN ?? "",
      ),
    },
  };
});
