import { lazy, Suspense, useEffect, useState, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { Grain } from "./components/Grain";
import { Sidebar, type NavDef } from "./components/Sidebar";
import { Landing } from "./routes/Landing"; // eager — the landing page is the first paint
import { CommandPalette } from "./components/CommandPalette";
import { whoami, type User } from "./lib/api";
import { easeSoft } from "./lib/motion";
import "./styles.css";

// Apply the non-render-blocking font stylesheet (shipped as media="print"). Done
// here rather than an inline onload so the document CSP can be script-src 'self'.
document.querySelectorAll<HTMLLinkElement>('link[data-font]').forEach((l) => { l.media = "all"; });

// Route code is split out of the landing bundle — each loads only when visited.
const Dashboard = lazy(() => import("./routes/Dashboard").then((m) => ({ default: m.Dashboard })));
const Review = lazy(() => import("./routes/Review").then((m) => ({ default: m.Review })));
const Space = lazy(() => import("./routes/Space").then((m) => ({ default: m.Space })));
const Repos = lazy(() => import("./routes/Repos").then((m) => ({ default: m.Repos })));
const Settings = lazy(() => import("./routes/Settings").then((m) => ({ default: m.Settings })));
const Upload = lazy(() => import("./routes/Upload").then((m) => ({ default: m.Upload })));
const Docs = lazy(() => import("./routes/Docs").then((m) => ({ default: m.Docs })));
const Starred = lazy(() => import("./routes/Starred").then((m) => ({ default: m.Starred })));
const Org = lazy(() => import("./routes/Org").then((m) => ({ default: m.Org })));
const LoginPage = lazy(() => import("./routes/Login").then((m) => ({ default: m.LoginPage })));

function PageFallback() {
  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--paper)", color: "var(--ink3)", fontFamily: "'Source Serif 4', Georgia, serif" }}>Loading…</div>;
}
function RouteFallback() {
  return <div style={{ flex: 1, display: "grid", placeItems: "center", color: "var(--ink3)", fontSize: 13 }}>Loading…</div>;
}

type Route =
  | { name: "landing" }
  | { name: "login" }
  | { name: "dashboard" }
  | { name: "upload" }
  | { name: "starred" }
  | { name: "review"; versionId: string }
  | { name: "space"; space: string; slug: string }
  | { name: "repos" }
  | { name: "settings" }
  | { name: "docs" }
  | { name: "org" };

function parseRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (!h) return { name: "landing" };
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "app" || parts[0] === "dashboard") return { name: "dashboard" };
  if (parts[0] === "upload") return { name: "upload" };
  if (parts[0] === "starred") return { name: "starred" };
  if (parts[0] === "r" && parts[1]) return { name: "review", versionId: parts[1] };
  if (parts[0] === "d" && parts[1] && parts[2]) return { name: "space", space: parts[1], slug: parts[2] };
  if (parts[0] === "repos") return { name: "repos" };
  if (parts[0] === "settings") return { name: "settings" };
  if (parts[0] === "docs") return { name: "docs" };
  if (parts[0] === "org") return { name: "org" };
  if (parts[0] === "login") return { name: "login" };
  return { name: "landing" };
}

const nav: NavDef[] = [
  { key: "dashboard", label: "Overview", href: "#/app" },
  { key: "upload", label: "Upload", href: "#/upload" },
  { key: "starred", label: "★ Starred", href: "#/starred" },
  { key: "repos", label: "Repos", href: "#/repos" },
  { key: "org", label: "Organization", href: "#/org" },
  { key: "settings", label: "Settings", href: "#/settings" },
  { key: "docs", label: "Docs", href: "#/docs" },
];

function activeKey(r: Route): string {
  if (r.name === "dashboard") return "dashboard";
  if (r.name === "upload") return "upload";
  if (r.name === "starred") return "starred";
  if (r.name === "space" || r.name === "review") return "repos";
  if (r.name === "repos") return "repos";
  if (r.name === "org") return "org";
  if (r.name === "settings") return "settings";
  if (r.name === "docs") return "docs";
  return "";
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseRoute());
  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

function useUser(): User | null {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const fetchUser = () => whoami().then(setUser).catch(() => setUser(null));
    fetchUser();
    window.addEventListener("hashchange", fetchUser);
    return () => window.removeEventListener("hashchange", fetchUser);
  }, []);
  return user;
}

function routeKey(r: Route): string {
  let k = r.name;
  if (r.name === "review") k += r.versionId;
  if (r.name === "space") k += r.space + r.slug;
  return k;
}

function DashboardLayout({ route, user }: { route: Route; user: User | null }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    const onSearch = () => setPaletteOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("confer:open-search", onSearch);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("confer:open-search", onSearch);
    };
  }, []);
  const primaryOrg = user?.orgs[0];
  return (
    <div
      data-grain="soft"
      style={{
        minHeight: "100vh",
        height: "100vh",
        background: "var(--paper)",
        backgroundImage: "var(--bg-grad)",
        color: "var(--ink)",
        fontFamily: "'Source Serif 4', Georgia, serif",
        fontSize: 13.5,
        display: "flex",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <Grain />
      {/* Personal-only accounts (no org membership) don't see org-scoped nav or the org chip. */}
      <Sidebar
        nav={nav.filter((n) => n.key !== "org" || (user?.orgs.length ?? 0) > 0)}
        active={activeKey(route)}
        user={user}
        org={primaryOrg ? { name: primaryOrg.name, role: primaryOrg.role } : null}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={routeKey(route)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: easeSoft }}
            style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
          >
            <Suspense fallback={<RouteFallback />}>
              {route.name === "dashboard" && <Dashboard />}
              {route.name === "upload" && <Upload />}
              {route.name === "starred" && <Starred />}
              {route.name === "review" && <Review versionId={route.versionId} />}
              {route.name === "space" && <Space space={route.space} slug={route.slug} />}
              {route.name === "repos" && <Repos />}
              {route.name === "org" && <Org />}
              {route.name === "settings" && <Settings />}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function App() {
  const route = useHashRoute();
  const user = useUser();

  if (route.name === "landing") return <Landing />;
  if (route.name === "login") return <Suspense fallback={<PageFallback />}><LoginPage /></Suspense>;
  if (route.name === "docs") return <Suspense fallback={<PageFallback />}><Docs /></Suspense>; // standalone — its own chrome
  return <DashboardLayout route={route} user={user} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);