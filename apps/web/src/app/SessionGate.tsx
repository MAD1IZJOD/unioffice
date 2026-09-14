import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { AccessContext, accessFrom } from "../lib/access";
import { fetchMe, setActiveOrganization, type Me } from "../lib/api";
import { chosenOrganization, rememberOrganization } from "../lib/organizationChoice";
import { signOut, useSession } from "../lib/session";
import SignIn from "../pages/SignIn";

/**
 * Nothing renders until the person is signed in and the API has said where
 * they stand. The shell below it receives what their role allows, only to
 * decide which controls to show.
 */
export default function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.status === "signed_in" ? session.userId : null;

  const [loaded, setLoaded] = useState<{ userId: string; me?: Me; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;

    let active = true;

    async function load(): Promise<Me> {
      const chosen = chosenOrganization();
      const me = await fetchMe(chosen);

      // A remembered organization they no longer belong to is forgotten
      // rather than leaving them locked out of the ones they do.
      if (chosen && me.standing === "none" && me.memberships.some((member) => member.status === "active")) {
        rememberOrganization(undefined);
        return fetchMe();
      }

      return me;
    }

    load().then(
      (me) => {
        if (!active) return;
        setActiveOrganization(me.organization?.id);
        setLoaded({ userId, me });
      },
      (reason: unknown) => {
        if (!active) return;
        setLoaded({ userId, error: reason instanceof Error ? reason.message : "Could not reach the API." });
      },
    );

    return () => {
      active = false;
    };
  }, [userId, attempt]);

  const current = loaded && loaded.userId === userId ? loaded : null;
  const currentMe = current?.me;
  const access = useMemo(() => (currentMe ? accessFrom(currentMe) : null), [currentMe]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  if (session.status === "unconfigured") {
    return (
      <Notice title="Sign-in is not configured">
        Set SUPABASE_URL and SUPABASE_ANON_KEY in the repository&apos;s .env file and restart the web app.
      </Notice>
    );
  }

  if (session.status === "signed_out") return <SignIn />;

  if (session.status === "loading" || !current) {
    return <Notice title="Checking your access…" />;
  }

  if (current.error) {
    return (
      <Notice title="Could not load your access" email={session.status === "signed_in" ? session.email : undefined}>
        {current.error}
        <button type="button" className="button-primary session-action" onClick={retry}>Try again</button>
      </Notice>
    );
  }

  const me = current.me!;

  if (me.standing === "suspended") {
    return (
      <Notice title="Your access is suspended" email={me.user.email}>
        An owner or admin of the organization can restore it.
      </Notice>
    );
  }

  if (!me.organization || !access) {
    return (
      <Notice title="You are not a member of an organization yet" email={me.user.email}>
        Ask an owner or admin to add {me.user.email}. You will get in the next time you sign in.
      </Notice>
    );
  }

  return (
    <AccessContext.Provider value={access}>
      {children}
    </AccessContext.Provider>
  );
}

function Notice({ title, email, children }: { title: string; email?: string; children?: ReactNode }) {
  return (
    <div className="session-screen">
      <div className="session-card" role="status">
        <h1 className="session-title">{title}</h1>
        {children && <div className="session-detail">{children}</div>}
        {email && (
          <p className="session-detail">
            Signed in as {email}.{" "}
            <button type="button" className="session-link" onClick={() => void signOut()}>
              Sign out
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
