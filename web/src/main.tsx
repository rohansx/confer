import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReviewPage } from "./routes/review";
import { DocPage } from "./routes/doc";
import { LoginPage } from "./routes/login";
import "./styles.css";

type Route =
  | { name: "review"; versionId: string }
  | { name: "doc"; space: string; slug: string }
  | { name: "login" }
  | { name: "home" };

function parseRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (!h) return { name: "home" };
  const parts = h.split("/").filter(Boolean);
  if (parts[0] === "r" && parts[1]) return { name: "review", versionId: parts[1] };
  if (parts[0] === "d" && parts[1] && parts[2]) return { name: "doc", space: parts[1], slug: parts[2] };
  if (parts[0] === "login") return { name: "login" };
  return { name: "home" };
}

function App() {
  const [route, setRoute] = useState<Route>(parseRoute());
  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  switch (route.name) {
    case "review": return <ReviewPage versionId={route.versionId} />;
    case "doc":    return <DocPage space={route.space} slug={route.slug} />;
    case "login":  return <LoginPage />;
    case "home":   return <HomePage />;
  }
}

function HomePage() {
  return (
    <div style={{ maxWidth: 720, margin: "4rem auto", padding: "0 1.5rem", fontFamily: "system-ui" }}>
      <h1>Confer</h1>
      <p>GitHub PRs for docs. Open the <a href="#/d/backend/auth-flow">Auth Flow doc</a> or the <a href="#/login">login page</a>.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
