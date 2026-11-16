import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3001,
    strictPort: true,
    watch: { usePolling: process.env.WATCH_USE_POLLING === "true" },
  },
});
