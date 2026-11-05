import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // Same /api path as nginx in Docker, so the frontend code has one base URL.
    proxy: { "/api": { target: "http://localhost:5000", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  test: { environment: "jsdom" },
});
