import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_PUBLIC_PASSWORD = "9837";

function envPort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

function isPrivateHostname(hostname) {
  const host = String(hostname || "")
    .split(":")[0]
    .replace(/^\[|\]$/g, "")
    .toLowerCase();

  if (!host || host === "localhost" || host === "::1") return true;
  if (host.startsWith("127.")) return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;

  const match = host.match(/^172\.(\d+)\./);
  if (match) {
    const secondOctet = Number(match[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  return false;
}

function hasPublicDashboardAccess(request, password) {
  const authorization = request.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Basic" || !token) return false;

  try {
    const credentials = Buffer.from(token, "base64").toString("utf8");
    const separator = credentials.indexOf(":");
    const suppliedPassword =
      separator === -1 ? credentials : credentials.slice(separator + 1);
    return suppliedPassword === password;
  } catch {
    return false;
  }
}

function publicDashboardAuthPlugin(password) {
  return {
    name: "forzadash-public-dashboard-auth",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const hostname = String(request.headers.host || "").split(":")[0];
        if (isPrivateHostname(hostname) || hasPublicDashboardAccess(request, password)) {
          next();
          return;
        }

        response.writeHead(401, {
          "Content-Type": "text/plain; charset=utf-8",
          "WWW-Authenticate": 'Basic realm="ForzaDash"',
        });
        response.end("ForzaDash public access requires a password.");
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const dashboardPort = envPort(env.VITE_DASHBOARD_PORT, 5173);
  const publicDashboardPassword =
    env.VITE_PUBLIC_DASHBOARD_PASSWORD || DEFAULT_PUBLIC_PASSWORD;

  return {
    base: "./",
    plugins: [publicDashboardAuthPlugin(publicDashboardPassword), react()],
    build: {
      outDir: "dist/app",
    },
    server: {
      host: "0.0.0.0",
      port: dashboardPort,
      strictPort: true,
    },
  };
});
