/**
 * Where sign-in is allowed to come back to.
 *
 * Supabase holds the authoritative allow list - a redirect it has not been
 * given is refused there, and nothing in the browser can change that. This is
 * the same rule kept on this side as well, so the app never asks to be
 * returned to an origin it does not recognise: a page served from somewhere
 * unexpected sends people back to the real application rather than wherever
 * it happens to be running.
 *
 * `VITE_APP_ORIGIN` is set where the site is built, so a deployment declares
 * its own origin rather than trusting the address bar.
 */

/** The application's own origin in production. */
const PRODUCTION_ORIGIN = "https://unioffice.pro";

/** Development, where the app is served by Vite. */
const DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function configuredOrigin(): string | null {
  const value = (import.meta.env.VITE_APP_ORIGIN as string | undefined)?.trim();

  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Every origin this build may be returned to, most specific first. */
export function allowedOrigins(): string[] {
  const configured = configuredOrigin();

  return [...new Set([
    ...(configured ? [configured] : []),
    PRODUCTION_ORIGIN,
    `https://www.${PRODUCTION_ORIGIN.replace(/^https:\/\//, "")}`,
    ...DEVELOPMENT_ORIGINS,
  ])];
}

/**
 * The origin to hand to Supabase for this sign-in.
 *
 * The page's own origin when it is one this build knows about, and otherwise
 * the origin this build was made for. Never an arbitrary address.
 */
export function redirectOrigin(): string {
  const allowed = allowedOrigins();
  const here = typeof window === "undefined" ? undefined : window.location.origin;

  if (here && allowed.includes(here)) return here;

  return configuredOrigin() ?? PRODUCTION_ORIGIN;
}

/**
 * Where to return someone after signing in. A path only, resolved against an
 * origin this build allows, so a redirect can never be pointed elsewhere.
 */
export function redirectTo(path = "/"): string {
  const safe = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return `${redirectOrigin()}${safe}`;
}
