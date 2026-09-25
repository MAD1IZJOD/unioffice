import { Mail } from "lucide-react";

import { useState, type FormEvent } from "react";

import { sendSignInLink, signInWithGoogle } from "../lib/session";
import { BrandMark } from "../components/BrandMark";

/**
 * Signing in.
 *
 * Google, or a one-time link by email. Neither sets or asks for a password,
 * and neither decides what anyone may do: that comes from their membership,
 * which an owner or admin gives them.
 */
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function withGoogle() {
    setBusy("google");
    setError(null);

    try {
      await signInWithGoogle();
    } catch (reason) {
      setError(messageOf(reason));
      setBusy(null);
    }
  }

  async function withEmail(event: FormEvent) {
    event.preventDefault();

    const address = email.trim();
    if (!address) return;

    setBusy("email");
    setError(null);

    try {
      await sendSignInLink(address);
      setSentTo(address);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="session-screen">
      <div className="session-card">
        <div className="session-brand">
          <BrandMark size={30} />
          <span>
            <span className="brand-name block">UNIOFFICE</span>
            <span className="brand-subtitle block">OPERATING SYSTEM</span>
          </span>
        </div>

        <h1 className="session-title">Sign in</h1>
        <p className="session-detail">
          What you can see and do depends on your role in the organization.
        </p>

        <button
          type="button"
          className="button-primary session-action"
          onClick={() => void withGoogle()}
          disabled={busy !== null}
        >
          {busy === "google" ? "Opening Google…" : "Continue with Google"}
        </button>

        <div className="session-divider">or</div>

        {sentTo ? (
          <p className="session-detail" role="status">
            Check {sentTo} for a sign-in link. It works once.
          </p>
        ) : (
          <form onSubmit={(event) => void withEmail(event)} className="session-form">
            <label className="session-label" htmlFor="sign-in-email">Work email</label>
            <input
              id="sign-in-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="session-input"
              placeholder="you@company.com"
            />
            <button type="submit" className="button-ghost session-action" disabled={busy !== null}>
              <Mail size={13} />
              {busy === "email" ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
        )}

        {error && <p className="session-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

function messageOf(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : "";

  if (/provider is not enabled/i.test(message)) {
    return "Google sign-in is not switched on for this project yet.";
  }

  return message || "Sign-in did not go through. Try again.";
}
