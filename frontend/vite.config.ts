import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = process.env.JOULEFLOW_BACKEND ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": { target: backend, ws: true },
    },
  },
  build: {
    // ECharts is the bulk of the bundle; the app is served gzipped from the local network.
    chunkSizeWarningLimit: 1200,
  },
});
