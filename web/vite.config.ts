import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: SPA on :3000, /api proxied to the app-origin node server (:5173).
// The review iframe loads content directly from the view origin (:5174),
// which is a genuinely different browser origin — the two-origin model holds
// in local dev without editing /etc/hosts.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4321,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:5173", changeOrigin: true },
    },
  },
  preview: {
    port: 4321,
    strictPort: true,
    proxy: {
      "/api": { target: "http://localhost:5173", changeOrigin: true },
    },
  },
});
