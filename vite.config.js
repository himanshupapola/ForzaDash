import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import os from "node:os";

function envPort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

function envBool(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function getPreferredLanAddress() {
  const vpnPattern =
    /(nord|nordlynx|vpn|tailscale|zerotier|hamachi|radmin|wintun|wireguard|tap|tun|virtualbox|vmware|hyper-v|bluetooth|loopback|vethernet)/i;
  const candidates = [];

  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (vpnPattern.test(name)) continue;
    for (const address of addresses || []) {
      if (
        address.family !== "IPv4" ||
        address.internal ||
        !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address.address)
      ) {
        continue;
      }
      const score = /^192\.168\./.test(address.address)
        ? 30
        : /^10\./.test(address.address)
          ? 20
          : 10;
      candidates.push({ address: address.address, name, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return candidates[0] || null;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const dashboardPort = envPort(env.VITE_DASHBOARD_PORT, 5173);
  const telemetryWsPort = envPort(env.VITE_TELEMETRY_WS_PORT, 17878);
  const lanAccessEnabled = envBool(env.VITE_LAN_ACCESS_ENABLED, true);
  const bindHost = lanAccessEnabled ? "0.0.0.0" : "127.0.0.1";
  const lanAddress = getPreferredLanAddress();

  return {
    base: "./",
    plugins: [
      react(),
      {
        name: "forzadash-network-info",
        configureServer(server) {
          server.middlewares.use("/api/network", (_request, response) => {
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(
              JSON.stringify({
                lanAccessEnabled,
                dashboardPort,
                telemetryWsPort,
                bindHost,
                lanAddress: lanAddress?.address || "",
                lanInterface: lanAddress?.name || "",
                localUrl: `http://127.0.0.1:${dashboardPort}/`,
                lanUrl:
                  lanAccessEnabled && lanAddress
                    ? `http://${lanAddress.address}:${dashboardPort}/`
                    : "",
              }),
            );
          });
        },
      },
    ],
    build: {
      outDir: "dist/app",
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("recharts")) return "charts";
            if (id.includes("lucide-react")) return "icons";
            return "vendor";
          },
        },
      },
    },
    server: {
      host: bindHost,
      port: dashboardPort,
      strictPort: true,
    },
  };
});
