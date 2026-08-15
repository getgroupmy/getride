import { useState } from "react";

import { signIn, useAdminSession } from "./auth";
import Dashboard from "./pages/Dashboard";
import Entities from "./pages/Entities";
import Settings from "./pages/Settings";
import { isConfigured } from "./supabase";
import type { EntityKind } from "./types";

type Route = "dashboard" | EntityKind | "settings";

const NAV: { key: Route; label: string }[] = [
  { key: "dashboard", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "partners", label: "Partners" },
  { key: "vehicles", label: "Vehicles" },
  { key: "settings", label: "Settings" },
];

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await signIn(email, password));
    setBusy(false);
  };

  return (
    <main className="centered">
      <form className="panel" onSubmit={submit}>
        <h1>GET.ride back office</h1>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function App() {
  const { session, signOut, idleTimeoutMs } = useAdminSession();
  const [route, setRoute] = useState<Route>("dashboard");

  if (!isConfigured) {
    return (
      <main className="centered">
        <div className="panel">
          <h1>Not configured</h1>
          <p>
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in{" "}
            <code>admin/.env</code>, then restart the dev server.
          </p>
        </div>
      </main>
    );
  }

  if (session.loading) {
    return (
      <main className="centered">
        <p>Loading…</p>
      </main>
    );
  }

  if (!session.userId) return <SignIn />;

  // A failed access check is reported as a failed check, not as a denial —
  // otherwise a broken query looks identical to "you are not staff".
  if (session.checkError) {
    return (
      <main className="centered">
        <div className="panel">
          <h1>Couldn&apos;t check your access</h1>
          <p className="error">{session.checkError}</p>
          <button onClick={signOut}>Sign out</button>
        </div>
      </main>
    );
  }

  if (!session.isAdmin) {
    return (
      <main className="centered">
        <div className="panel">
          <h1>No access</h1>
          <p>
            {session.email} is signed in, but has no admin access. Ask an existing admin to
            add you.
          </p>
          <button onClick={signOut}>Sign out</button>
        </div>
      </main>
    );
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">GET.ride</div>
        {NAV.map((n) => (
          <button
            key={n.key}
            className={route === n.key ? "nav active" : "nav"}
            aria-current={route === n.key ? "page" : undefined}
            onClick={() => setRoute(n.key)}
          >
            {n.label}
          </button>
        ))}
        <div className="spacer" />
        <div className="who">{session.email}</div>
        {/* Said out loud, so an unexplained sign-out is never a mystery. */}
        <div className="who">
          Signs out after {Math.round(idleTimeoutMs / 60000)} min idle
        </div>
        <button className="nav" onClick={signOut}>
          Sign out
        </button>
      </nav>

      <main className="content">
        {route === "dashboard" ? <Dashboard /> : null}
        {route === "settings" ? <Settings /> : null}
        {route === "users" || route === "partners" || route === "vehicles" ? (
          <Entities key={route} kind={route} />
        ) : null}
      </main>
    </div>
  );
}
