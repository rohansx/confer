import { useEffect, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { TopBar } from "../components/TopBar";
import {
  listOrgs, listMembers, inviteMember, removeMember, listInvites, revokeInvite,
  type OrgMembership, type OrgMember, type OrgInvite,
} from "../lib/api";
import { fadeUp, tapDown, easeSoft } from "../lib/motion";
import { ago } from "../lib/format";

export function Org() {
  const [orgs, setOrgs] = useState<OrgMembership[] | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [invites, setInvites] = useState<OrgInvite[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    listOrgs().then((o) => {
      setOrgs(o);
      if (o.length > 0) setActiveOrgId(o[0]!.id);
    }).catch(() => setOrgs([]));
  }, []);

  const refresh = (orgId: string) => {
    setMembers(null); setInvites(null); setErr(null); setMsg(null);
    listMembers(orgId).then(setMembers).catch((e) => setErr(emsg(e)));
    listInvites(orgId).then(setInvites).catch((e) => setErr(emsg(e)));
  };

  useEffect(() => {
    if (activeOrgId) refresh(activeOrgId);
  }, [activeOrgId]);

  const invite = async () => {
    if (!activeOrgId || !email.trim()) return;
    setErr(null); setMsg(null);
    try {
      await inviteMember(activeOrgId, email.trim(), role);
      setEmail("");
      setMsg(`Invitation sent to ${email.trim()} — they'll join when they sign in with that email.`);
      refresh(activeOrgId);
    } catch (e) { setErr(emsg(e)); }
  };

  const remove = async (userId: string) => {
    if (!activeOrgId) return;
    if (!confirm("Remove this member from the org?")) return;
    try { await removeMember(activeOrgId, userId); refresh(activeOrgId); } catch (e) { setErr(emsg(e)); }
  };

  const revoke = async (em: string) => {
    if (!activeOrgId) return;
    try { await revokeInvite(activeOrgId, em); refresh(activeOrgId); } catch (e) { setErr(emsg(e)); }
  };

  if (orgs === null) return <TopBar crumb="Organization" />;

  if (orgs.length === 0) {
    return (
      <>
        <TopBar crumb="Organization" />
        <div style={pageStyle}>
          <div style={card}>
            <h2 style={{ margin: "0 0 8px" }}>You're not in any organization</h2>
            <p style={{ color: "var(--ink2)", margin: 0, lineHeight: 1.6 }}>
              Ask an admin to invite your email, or create a new org to start reviewing docs.
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar crumb={orgs.find((o) => o.id === activeOrgId)?.name ?? "Organization"} />
      <div style={pageStyle}>
        <div style={card}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
            {orgs.map((o) => (
              <button
                key={o.id}
                onClick={() => setActiveOrgId(o.id)}
                style={{
                  padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600,
                  border: "1px solid var(--line)", background: o.id === activeOrgId ? "var(--green)" : "var(--paper)",
                  color: o.id === activeOrgId ? "#f6f3e9" : "var(--ink)",
                }}
              >{o.name} · {o.role}</button>
            ))}
          </div>

          <h3 style={{ marginTop: 0 }}>Invite a member</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <input
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@org.test"
              style={input}
            />
            <select value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")} style={{ ...input, flex: "0 0 auto" }}>
              <option value="member">member</option>
              <option value="admin">admin</option>
            </select>
            <motion.button whileTap={tapDown} onClick={invite} style={btn}>Invite</motion.button>
          </div>
          <p style={{ fontSize: 12, color: "var(--ink3)", margin: "4px 0 0", lineHeight: 1.5 }}>
            If they already have an account, they're added immediately. Otherwise an invitation is recorded and they auto-join the first time they sign in with that email.
          </p>
          {msg && <div style={{ color: "var(--green)", fontSize: 13, marginTop: 8 }}>{msg}</div>}
          {err && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{err}</div>}
        </div>

        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Members</h3>
          {members === null ? <Skeleton /> : members.length === 0 ? <Empty text="No members." /> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={cell}><b>{m.name}</b>{m.email && <span style={{ color: "var(--ink2)", marginLeft: 8 }}>{m.email}</span>}</td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      <span style={{ padding: "2px 8px", borderRadius: 6, background: m.role === "admin" ? "var(--green)" : "var(--paper)", color: m.role === "admin" ? "#f6f3e9" : "var(--ink2)", fontSize: 11.5, fontWeight: 600 }}>{m.role}</span>
                      <button onClick={() => remove(m.user_id)} style={linkBtn}>remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Pending invitations</h3>
          {invites === null ? <Skeleton /> : invites.filter((i) => i.accepted_at === null).length === 0 ? <Empty text="No pending invitations." /> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {invites.filter((i) => i.accepted_at === null).map((i) => (
                  <tr key={i.email} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={cell}>{i.email}</td>
                    <td style={{ ...cell, textAlign: "right" }}>
                      <span style={{ color: "var(--ink3)", fontSize: 12 }}>invited {ago(i.created_at)}</span>
                      <button onClick={() => revoke(i.email)} style={linkBtn}>revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

const emsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const pageStyle: CSSProperties = { padding: "0 28px 40px", maxWidth: 760, overflowY: "auto" };
const card: CSSProperties = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 14, padding: 22, boxShadow: "var(--sh-raise-sm)", marginBottom: 18 };
const input: CSSProperties = { flex: 1, minWidth: 200, padding: "11px 14px", borderRadius: 10, border: "1px solid var(--line)", boxShadow: "var(--sh-inset)", background: "var(--paper)", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "var(--ink)", outline: "none" };
const btn: CSSProperties = { padding: "11px 18px", borderRadius: 10, background: "var(--green)", border: "none", color: "#f6f3e9", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const cell: CSSProperties = { padding: "12px 4px", verticalAlign: "middle" };
const linkBtn: CSSProperties = { background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontSize: 12.5, marginLeft: 12, textDecoration: "underline" };

const Skeleton = () => <div style={{ color: "var(--ink3)", fontSize: 13 }}>loading…</div>;
const Empty = ({ text }: { text: string }) => <div style={{ color: "var(--ink3)", fontSize: 13 }}>{text}</div>;