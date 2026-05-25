import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function envPort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const dashboardPort = envPort(env.VITE_DASHBOARD_PORT, 5173);

  return {
    base: "./",
    plugins: [react()],
    build: {
      outDir: "dist/app",
    },
    server: {
      host: "127.0.0.1",
      port: dashboardPort,
      strictPort: true,
    },
  };
});
