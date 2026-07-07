import { useState } from "react";
import { login, type User } from "../lib/api";

export function LoginPage() {
  const [userId, setUserId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [me, setMe] = useState<User | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const u = await login(userId, name, email || undefined);
      setMe(u);
      // Bounce to the seeded doc page.
      window.location.hash = "#/d/backend/auth-flow";
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (me) {
    return (
      <div style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1.5rem" }}>
        <h1>Logged in as {me.name}</h1>
        <p><a href="#/d/backend/auth-flow">Continue</a></p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "4rem auto", padding: "0 1.5rem" }}>
      <h1>Log in</h1>
      <p className="muted small">
        Dev-only: enter any user_id, name, email. Real auth (magic-link / GitHub OAuth) lands in v1.
      </p>
      <form onSubmit={submit} style={{ display: "grid", gap: "0.75rem" }}>
        <label>User ID
          <input value={userId} onChange={(e) => setUserId(e.target.value)} required />
        </label>
        <label>Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>Email (optional)
          <input value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="submit" className="btn primary">Log in</button>
        {err && <div className="notice error">{err}</div>}
      </form>
    </div>
  );
}
