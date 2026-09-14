import { useEffect, useState } from "react";

import type { Session } from "@supabase/supabase-js";

import { supabase } from "./supabase";

export type SessionState =
  | { status: "unconfigured" }
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; userId: string; email: string };

/**
 * The signed-in user's current access token, refreshed by the client when it
 * is close to expiring. Null when nobody is signed in.
 */
export async function accessToken(): Promise<string | null> {
  const client = supabase();
  if (!client) return null;

  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Hands the browser to Google, which returns it here signed in. */
export async function signInWithGoogle(): Promise<void> {
  const client = supabase();
  if (!client) throw new Error("Sign-in is not configured for this environment.");

  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });

  if (error) throw error;
}

/** Emails a one-time sign-in link. No password is ever set or asked for. */
export async function sendSignInLink(email: string): Promise<void> {
  const client = supabase();
  if (!client) throw new Error("Sign-in is not configured for this environment.");

  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
  });

  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase()?.auth.signOut();
}

const UNAUTHORIZED = "unioffice:unauthorized";

/** The API refused the session; whoever is showing the session re-checks it. */
export function reportUnauthorized(): void {
  window.dispatchEvent(new Event(UNAUTHORIZED));
}

export function onUnauthorized(listener: () => void): () => void {
  window.addEventListener(UNAUTHORIZED, listener);
  return () => window.removeEventListener(UNAUTHORIZED, listener);
}

function stateOf(session: Session | null): SessionState {
  return session?.user
    ? { status: "signed_in", userId: session.user.id, email: session.user.email ?? "" }
    : { status: "signed_out" };
}

/** Who is signed in, kept current as they sign in, out, or their token refreshes. */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(() =>
    supabase() ? { status: "loading" } : { status: "unconfigured" });

  useEffect(() => {
    const client = supabase();
    if (!client) return;

    let active = true;

    void client.auth.getSession().then(({ data }) => {
      if (active) setState(stateOf(data.session));
    });

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (active) setState(stateOf(session));
    });

    const stopListening = onUnauthorized(() => {
      // A token the API will not take is either expired past refreshing or
      // revoked. Asking the client again settles which.
      void client.auth.getSession().then(({ data: current }) => {
        if (active) setState(stateOf(current.session));
      });
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
      stopListening();
    };
  }, []);

  return state;
}
