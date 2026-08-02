import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const remoteApi = process.env.VITE_DEV_PROXY_TARGET || "https://xensemble.dev";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3889,
    proxy: {
      "/api": { target: remoteApi, changeOrigin: true },
      "/ws": { target: remoteApi, changeOrigin: true, ws: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    include: ["monaco-editor"],
  },
});
