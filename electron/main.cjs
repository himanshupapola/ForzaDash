const electron = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, Menu, Tray, dialog, shell, powerSaveBlocker } = electron;

function writeStartupLog(message) {
  try {
    const basePath =
      app?.getPath?.("userData") || path.join(process.env.TEMP || process.cwd(), "ForzaDash");
    fs.mkdirSync(basePath, { recursive: true });
    fs.appendFileSync(
      path.join(basePath, "forzadash-startup.log"),
      `[${new Date().toISOString()}] ${message}\n`,
    );
  } catch {}
}

function writeRendererLog(message) {
  if (!isDeveloperModeEnabled()) return;
  try {
    const logPath =
      process.env.FORZADASH_DEBUG_LOG_PATH ||
      path.join(
        process.env.PORTABLE_EXECUTABLE_DIR ||
          process.env.FORZADASH_LOG_DIR ||
          process.cwd(),
        "forzadash-renderer.log",
      );
    fs.appendFileSync(
      logPath,
      `[${new Date().toISOString()}] CLIENT ${message}\n`,
    );
  } catch {}
}

function isTruthyEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function isDeveloperModeEnabled() {
  if (process.env.VITE_DEVELOPER_MODE != null) {
    return isTruthyEnv(process.env.VITE_DEVELOPER_MODE);
  }
  return false;
}

writeStartupLog(
  `main starting, electron api: ${app ? "ok" : `missing (${typeof electron})`}`,
);

if (!app) {
  throw new Error("Electron app API is unavailable during startup");
}

const DEFAULT_DASHBOARD_PORT = 5173;
const DEFAULT_GITHUB_REPO = "himanshupapola/ForzaDash";
const LOCAL_HOST = "127.0.0.1";

let tray = null;
let webServer = null;
let dashboardUrl = null;
let dashboardWindow = null;
let youtubeMusicWindow = null;
let youtubeMusicLoaded = false;
let youtubePreferredVolume = null;
let youtubePreferredMuted = null;
let isQuitting = false;

function isYouTubeMusicUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "music.youtube.com" ||
        parsed.hostname === "accounts.google.com")
    );
  } catch {
    return false;
  }
}

function isSpotifyAuthUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "accounts.spotify.com";
  } catch {
    return false;
  }
}

function isDashboardUrl(url, dashboardUrl) {
  try {
    const parsed = new URL(url);
    const dashboard = new URL(dashboardUrl);
    return parsed.origin === dashboard.origin;
  } catch {
    return url === dashboardUrl;
  }
}

function isControllableYouTubeMusicUrl(url) {
  try {
    return new URL(url).hostname === "music.youtube.com";
  } catch {
    return false;
  }
}

function youtubeMusicSession() {
  return youtubeMusicWindow && !youtubeMusicWindow.isDestroyed()
    ? youtubeMusicWindow.webContents.session
    : undefined;
}

const singleInstanceLock = app.requestSingleInstanceLock();
let mediaSuspendBlockerId = null;
writeStartupLog(`single instance lock: ${singleInstanceLock}`);

// Keep media playback stable when app windows lose focus (e.g. alt-tab to game).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-background-media-suspend");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

if (!singleInstanceLock) {
  writeStartupLog("quitting: single instance lock unavailable");
  app.quit();
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

function loadRuntimeEnv() {
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(path.dirname(process.execPath), ".env"),
    path.join(__dirname, "..", ".env"),
  ];

  for (const envPath of candidates) {
    loadEnvFile(envPath);
  }
}

function envPort(name, fallback) {
  const port = Number(process.env[name]);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

const SETTINGS_KEY = "forzadash_settings";
const SETTINGS_ENV_MAP = {
  dashboardPort: "VITE_DASHBOARD_PORT",
  forzaUdpPort: "VITE_FORZA_UDP_PORT",
  udpForwardingEnabled: "VITE_UDP_FORWARDING_ENABLED",
  forzaUdpForwardPort: "VITE_FORZA_UDP_FORWARD_PORT",
  forzaUdpForwardPort2: "VITE_FORZA_UDP_FORWARD_PORT_2",
  telemetryWsPort: "VITE_TELEMETRY_WS_PORT",
  lanAccessEnabled: "VITE_LAN_ACCESS_ENABLED",
  developerMode: "VITE_DEVELOPER_MODE",
  weatherRegion: "VITE_WEATHER_REGION",
  backgroundColor: "VITE_BACKGROUND_COLOR",
  spotifyClientId: "VITE_SPOTIFY_CLIENT_ID",
};
const DEFAULT_SAVED_SETTINGS = {
  weatherRegion: "Bageshwar",
  dashboardPort: "5173",
  forzaUdpPort: "1234",
  udpForwardingEnabled: false,
  forzaUdpForwardPort: "1235",
  forzaUdpForwardPort2: "1236",
  telemetryWsPort: "17878",
  lanAccessEnabled: true,
  developerMode: false,
  spotifyClientId: "",
  demoDriveMode: false,
  uiFpsLimit: "60",
  speedUnit: "kmh",
  mapQuality: "full",
  flashMode: false,
  backgroundColor: "#000204",
};

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), "forzadash-settings.json");
}

function getYouTubeStateFilePath() {
  return path.join(app.getPath("userData"), "forzadash-youtube-state.json");
}

function readSettingsFile() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsFilePath(), "utf8"));
  } catch {
    return null;
  }
}

function portValue(value) {
  const port = Number(String(value ?? "").trim());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function repairSavedSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {
      settings: { ...DEFAULT_SAVED_SETTINGS },
      repairs: ["settings file was not an object"],
    };
  }

  const repaired = { ...DEFAULT_SAVED_SETTINGS, ...settings };
  const repairs = [];
  const portKeys = [
    "dashboardPort",
    "forzaUdpPort",
    "telemetryWsPort",
    "forzaUdpForwardPort",
    "forzaUdpForwardPort2",
  ];

  for (const key of portKeys) {
    if (!portValue(repaired[key])) {
      repaired[key] = DEFAULT_SAVED_SETTINGS[key];
      repairs.push(`${key} reset to default`);
    } else {
      repaired[key] = String(repaired[key]).trim();
    }
  }

  let dashboardPort = portValue(repaired.dashboardPort);
  let udpPort = portValue(repaired.forzaUdpPort);
  let telemetryPort = portValue(repaired.telemetryWsPort);
  if (
    dashboardPort === udpPort ||
    dashboardPort === telemetryPort ||
    telemetryPort === udpPort
  ) {
    repaired.dashboardPort = DEFAULT_SAVED_SETTINGS.dashboardPort;
    repaired.forzaUdpPort = DEFAULT_SAVED_SETTINGS.forzaUdpPort;
    repaired.telemetryWsPort = DEFAULT_SAVED_SETTINGS.telemetryWsPort;
    repairs.push("conflicting dashboard/telemetry/Forza UDP ports reset to defaults");
  }

  dashboardPort = portValue(repaired.dashboardPort);
  udpPort = portValue(repaired.forzaUdpPort);
  telemetryPort = portValue(repaired.telemetryWsPort);
  let forwardPort1 = portValue(repaired.forzaUdpForwardPort);
  let forwardPort2 = portValue(repaired.forzaUdpForwardPort2);
  if (repaired.udpForwardingEnabled) {
    if (
      forwardPort1 === forwardPort2 ||
      forwardPort1 === udpPort ||
      forwardPort2 === udpPort ||
      forwardPort1 === dashboardPort ||
      forwardPort2 === dashboardPort ||
      forwardPort1 === telemetryPort ||
      forwardPort2 === telemetryPort
    ) {
      repaired.forzaUdpForwardPort = DEFAULT_SAVED_SETTINGS.forzaUdpForwardPort;
      repaired.forzaUdpForwardPort2 = DEFAULT_SAVED_SETTINGS.forzaUdpForwardPort2;
      repairs.push("conflicting UDP forwarding ports reset to defaults");
    }
  }

  if (!["30", "60", "120"].includes(String(repaired.uiFpsLimit))) {
    repaired.uiFpsLimit = DEFAULT_SAVED_SETTINGS.uiFpsLimit;
    repairs.push("uiFpsLimit reset to default");
  }

  if (!["kmh", "mph"].includes(String(repaired.speedUnit))) {
    repaired.speedUnit = DEFAULT_SAVED_SETTINGS.speedUnit;
    repairs.push("speedUnit reset to default");
  }

  if (!["optimized", "full"].includes(String(repaired.mapQuality))) {
    repaired.mapQuality = DEFAULT_SAVED_SETTINGS.mapQuality;
    repairs.push("mapQuality reset to default");
  }

  return { settings: repaired, repairs };
}

function saveRepairedSettings(settings, repairs) {
  const settingsPath = getSettingsFilePath();
  const backupPath = path.join(
    path.dirname(settingsPath),
    `forzadash-settings.bad-${Date.now()}.json`,
  );

  try {
    if (fs.existsSync(settingsPath)) {
      fs.copyFileSync(settingsPath, backupPath);
      writeStartupLog(`invalid settings copied to ${backupPath}: ${repairs.join("; ")}`);
    }
  } catch (error) {
    writeStartupLog(`could not backup invalid settings: ${error?.message || error}`);
  }

  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    writeStartupLog(`settings repaired: ${repairs.join("; ")}`);
  } catch (error) {
    writeStartupLog(`could not save repaired settings: ${error?.message || error}`);
  }

  return settings;
}

function readValidatedSettingsFile() {
  const settings = readSettingsFile();
  if (!settings) return null;
  const result = repairSavedSettings(settings);
  return result.repairs.length
    ? saveRepairedSettings(result.settings, result.repairs)
    : result.settings;
}

function isDemoDriveModeEnabled() {
  return Boolean(readValidatedSettingsFile()?.demoDriveMode);
}

function readElectronLocalStorageSettings() {
  const userDataPath = app.getPath("userData");
  const candidates = [
    path.join(userDataPath, "Local Storage", "leveldb"),
    path.join(userDataPath, "Default", "Local Storage", "leveldb"),
  ];

  for (const storagePath of candidates) {
    if (!fs.existsSync(storagePath)) continue;

    const files = fs
      .readdirSync(storagePath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ldb|log)$/i.test(entry.name))
      .map((entry) => path.join(storagePath, entry.name));

    for (const filePath of files) {
      try {
        const contents = fs.readFileSync(filePath, "utf16le");
        const keyIndex = contents.lastIndexOf(SETTINGS_KEY);
        if (keyIndex === -1) continue;

        const jsonStart = contents.indexOf("{", keyIndex);
        const nextSettingsKey = contents.indexOf(SETTINGS_KEY, keyIndex + 1);
        const searchEnd =
          nextSettingsKey === -1 ? contents.length : nextSettingsKey;
        const jsonEnd = contents.lastIndexOf("}", searchEnd);
        if (jsonStart === -1 || jsonEnd === -1) continue;

        return JSON.parse(contents.slice(jsonStart, jsonEnd + 1));
      } catch {}
    }
  }

  return null;
}

function readValidatedElectronLocalStorageSettings() {
  const settings = readElectronLocalStorageSettings();
  if (!settings) return null;
  const result = repairSavedSettings(settings);
  return result.repairs.length
    ? saveRepairedSettings(result.settings, result.repairs)
    : result.settings;
}

function applySavedSettingsToEnv() {
  const settings =
    readValidatedSettingsFile() || readValidatedElectronLocalStorageSettings();
  if (!settings) return;

  for (const [settingKey, envKey] of Object.entries(SETTINGS_ENV_MAP)) {
    const value = String(settings[settingKey] ?? "").trim();
    if (value) process.env[envKey] = value;
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".ico": "image/x-icon",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    }[ext] || "application/octet-stream"
  );
}

function envBool(name, fallback = false) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function devDashboardUrl() {
  const url = String(process.env.FORZADASH_DASHBOARD_URL || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function getPreferredLanAddress() {
  const vpnPattern =
    /(nord|nordlynx|vpn|tailscale|zerotier|hamachi|radmin|wintun|wireguard|tap|tun|virtualbox|vmware|hyper-v|bluetooth|loopback|vethernet)/i;
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (vpnPattern.test(name)) continue;
    for (const address of addresses || []) {
      if (
        address.family !== "IPv4" ||
        address.internal ||
        !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address.address)
      ) {
        continue;
      }
      const score =
        /^192\.168\./.test(address.address) ? 30 :
        /^10\./.test(address.address) ? 20 :
        10;
      candidates.push({ address: address.address, name, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return candidates[0] || null;
}

function cacheHeaders(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const isBuiltAsset = normalized.includes("/dist/app/assets/");
  return {
    "Content-Type": contentType(filePath),
    "Cache-Control": isBuiltAsset
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  };
}

function sendFile(response, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, cacheHeaders(filePath));
    response.end(data);
  });
}

function startDashboardServer() {
  const devUrl = devDashboardUrl();
  const dashboardRoot = path.join(__dirname, "..", "dist", "app");
  const preferredPort = devUrl
    ? envPort("FORZADASH_DEV_API_PORT", DEFAULT_DASHBOARD_PORT + 1)
    : envPort("VITE_DASHBOARD_PORT", DEFAULT_DASHBOARD_PORT);
  const lanAccessEnabled = envBool("VITE_LAN_ACCESS_ENABLED", true);
  const bindHost = lanAccessEnabled ? "0.0.0.0" : LOCAL_HOST;
  const lanAddress = getPreferredLanAddress();
  const dashboardDisplayUrl = devUrl || `http://127.0.0.1:${preferredPort}/`;

  webServer = http.createServer((request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${preferredPort}`);

    if (url.pathname === "/api/settings" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(readValidatedSettingsFile() || {}));
      return;
    }

    if (url.pathname === "/api/settings" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 10000) request.destroy();
      });
      request.on("end", () => {
        try {
          const settings = JSON.parse(body || "{}");
          fs.writeFileSync(getSettingsFilePath(), JSON.stringify(settings, null, 2));
          response.writeHead(204);
          response.end();
        } catch {
          response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ error: "Invalid settings" }));
        }
      });
      return;
    }

    if (url.pathname === "/api/network" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          lanAccessEnabled,
          developerMode: isDeveloperModeEnabled(),
          dashboardPort: preferredPort,
          telemetryWsPort: envPort("VITE_TELEMETRY_WS_PORT", 17878),
          bindHost,
          lanAddress: lanAddress?.address || "",
          lanInterface: lanAddress?.name || "",
          localUrl: dashboardDisplayUrl,
          lanUrl:
            !devUrl && lanAccessEnabled && lanAddress
              ? `http://${lanAddress.address}:${preferredPort}/`
              : "",
        }),
      );
      return;
    }

    if (url.pathname === "/api/renderer-log" && request.method === "POST") {
      if (!isDeveloperModeEnabled()) {
        response.writeHead(204);
        response.end();
        return;
      }
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4000) request.destroy();
      });
      request.on("end", () => {
        writeRendererLog(body.replace(/[\r\n]+/g, " ").slice(0, 4000));
        response.writeHead(204);
        response.end();
      });
      return;
    }

    if (url.pathname === "/api/window/toggle-fullscreen") {
      toggleDashboardFullscreen();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(
        JSON.stringify({
          ok: true,
          fullscreen: Boolean(
            dashboardWindow && !dashboardWindow.isDestroyed()
              ? dashboardWindow.isFullScreen()
              : false,
          ),
        }),
      );
      return;
    }

    if (url.pathname === "/api/youtube-music/play-random") {
      playRandomYouTubeMusic()
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              ok: false,
              error: error?.message || "YouTube Music test failed",
            }),
          );
        });
      return;
    }

    if (url.pathname === "/api/youtube-music/open") {
      openYouTubeMusicWindow()
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              ok: false,
              error: error?.message || "Could not open YouTube Music",
            }),
          );
        });
      return;
    }

    if (url.pathname === "/api/youtube-music/hide") {
      hideYouTubeMusicOnly();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, visible: false }));
      return;
    }

    if (url.pathname === "/api/youtube-music/logout") {
      logoutYouTubeMusic()
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              ok: false,
              error: error?.message || "Could not logout YouTube Music",
            }),
          );
        });
      return;
    }

    if (url.pathname === "/api/youtube-music/stop") {
      stopYouTubeMusic()
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              ok: false,
              error: error?.message || "Could not stop YouTube Music",
            }),
          );
        });
      return;
    }

    if (url.pathname === "/api/youtube-music/status") {
      getYouTubeMusicStatus({
        analyze: url.searchParams.get("analyze") === "1",
      })
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              ok: false,
              error: error?.message || "Could not read YouTube Music",
            }),
          );
        });
      return;
    }

    if (url.pathname === "/api/youtube-music/control") {
      controlYouTubeMusic(url.searchParams.get("command"))
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              ok: false,
              error: error?.message || "YouTube Music control failed",
            }),
          );
        });
      return;
    }

    if (url.pathname === "/api/update-check" && request.method === "GET") {
      checkForGithubUpdate()
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ ok: false, error: error?.message || "Update check failed" }));
        });
      return;
    }
    if (url.pathname === "/api/youtube-music/volume") {
      setYouTubeMusicVolume(url.searchParams)
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify({ ok: false, error: error?.message || "YouTube Music volume failed" }));
        });
      return;
    }

    if (url.pathname === "/api/youtube-music/jump") {
      jumpYouTubeMusic(url.searchParams)
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              ok: false,
              error: error?.message || "YouTube Music jump failed",
            }),
          );
        });
      return;
    }

    const decodedPath = decodeURIComponent(url.pathname);
    const normalizedPath = path
      .normalize(decodedPath)
      .replace(/^(\.\.[/\\])+/, "");
    const requestedPath = path.join(
      dashboardRoot,
      normalizedPath === path.sep ? "index.html" : normalizedPath,
    );

    if (!requestedPath.startsWith(dashboardRoot)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    fs.stat(requestedPath, (error, stat) => {
      if (!error && stat.isFile()) {
        sendFile(response, requestedPath);
        return;
      }

      sendFile(response, path.join(dashboardRoot, "index.html"));
    });
  });

  return new Promise((resolve, reject) => {
    webServer.once("error", onError);
    webServer.listen(preferredPort, bindHost, () => {
      webServer.off("error", onError);
      resolve(dashboardDisplayUrl);
      console.log(
        devUrl
          ? `Dashboard dev API listening on http://127.0.0.1:${preferredPort}/`
          : `Dashboard listening on http://127.0.0.1:${preferredPort}/`,
      );
      if (!devUrl && lanAccessEnabled && lanAddress) {
        console.log(`Dashboard LAN URL http://${lanAddress.address}:${preferredPort}/`);
      }
    });

    function onError(error) {
      webServer.off("error", onError);
      if (error?.code === "EADDRINUSE") {
        reject(
          new Error(
            `Dashboard port ${preferredPort} is already in use. Close the other app or change the Dashboard port in Settings.`,
          ),
        );
        return;
      }
      reject(error);
    }
  });
}

function getServerEntryPath() {
  return path.join(app.getAppPath(), "server.cjs");
}

function createTray(dashboardUrl) {
  tray = new Tray(path.join(__dirname, "..", "src", "assets", "forza-logo.png"));
  tray.setToolTip("ForzaDash");
  tray.on("click", () => {
    if (!dashboardWindow) {
      createDashboardWindow(dashboardUrl);
      return;
    }
    dashboardWindow.show();
    dashboardWindow.focus();
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Quit ForzaDash",
        click: () => app.quit(),
      },
    ]),
  );
}

function createDashboardWindow(dashboardUrl) {
  dashboardWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#000204",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  dashboardWindow.loadURL(dashboardUrl);
  dashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isDashboardUrl(url, dashboardUrl) || isSpotifyAuthUrl(url)) {
      return { action: "allow" };
    }
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  dashboardWindow.webContents.on("will-navigate", (event, url) => {
    if (isDashboardUrl(url, dashboardUrl) || isSpotifyAuthUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });
  dashboardWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.alt && input.key === "Enter") {
      event.preventDefault();
      toggleDashboardFullscreen();
    }
  });
  dashboardWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Dashboard renderer stopped", details);
    writeRendererLog(`RENDERER_GONE ${JSON.stringify(details)}`);
  });
  dashboardWindow.once("ready-to-show", () => {
    dashboardWindow.show();
    dashboardWindow.focus();
  });
  dashboardWindow.on("closed", () => {
    dashboardWindow = null;
    app.quit();
  });

  return dashboardWindow;
}

function toggleDashboardFullscreen() {
  if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
  dashboardWindow.setFullScreen(!dashboardWindow.isFullScreen());
}

function createYouTubeMusicWindow() {
  if (youtubeMusicWindow && !youtubeMusicWindow.isDestroyed()) {
    return youtubeMusicWindow;
  }

  youtubeMusicWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    title: "YouTube Music",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  youtubeMusicWindow.webContents.on("dom-ready", () => {
    if (youtubeMusicWindow && !youtubeMusicWindow.isDestroyed()) {
      youtubeMusicWindow.webContents.executeJavaScript(`
        (() => {
          if (window.forzaDashPrunerInjected) return;
          window.forzaDashPrunerInjected = true;

          const prune = (obj) => {
            if (!obj || typeof obj !== "object") return obj;
            try {
              delete obj.playerAds;
              delete obj.adPlacements;
              delete obj.adSlots;
              if (obj.playerResponse) {
                delete obj.playerResponse.playerAds;
                delete obj.playerResponse.adPlacements;
                delete obj.playerResponse.adSlots;
              }
              if (obj.ytInitialPlayerResponse) {
                delete obj.ytInitialPlayerResponse.playerAds;
                delete obj.ytInitialPlayerResponse.adPlacements;
                delete obj.ytInitialPlayerResponse.adSlots;
              }
            } catch {}
            return obj;
          };

          try {
            if (window.ytInitialPlayerResponse) prune(window.ytInitialPlayerResponse);
            let rawInitial = window.ytInitialPlayerResponse;
            Object.defineProperty(window, "ytInitialPlayerResponse", {
              get() { return rawInitial; },
              set(val) { rawInitial = prune(val); },
              configurable: true,
              enumerable: true
            });
          } catch {}

          const originalParse = JSON.parse;
          JSON.parse = function (...args) {
            const result = originalParse.apply(this, args);
            return prune(result);
          };
        })();
      `).catch(() => {});
    }
  });



  youtubeMusicWindow.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    youtubeMusicWindow.hide();
  });
  youtubeMusicWindow.on("closed", () => {
    youtubeMusicWindow = null;
    youtubeMusicLoaded = false;
  });
  youtubeMusicWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isYouTubeMusicUrl(url)) {
      return { action: "allow" };
    }
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  youtubeMusicWindow.webContents.on("will-navigate", (event, url) => {
    if (isYouTubeMusicUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });
  return youtubeMusicWindow;
}

function hideYouTubeMusicWindow(focusDashboard = false) {
  if (youtubeMusicWindow && !youtubeMusicWindow.isDestroyed()) {
    youtubeMusicWindow.hide();
  }
  if (focusDashboard && dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
  }
}

function hideYouTubeMusicOnly() {
  hideYouTubeMusicWindow(false);
}

function waitForWindowLoad(window) {
  return new Promise((resolve) => {
    if (!window || window.isDestroyed()) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, 12000);
    window.webContents.once("did-finish-load", () => {
      clearTimeout(timeout);
      setTimeout(resolve, 800);
    });
  });
}

async function ensureYouTubeMusicLoaded({ visible = false } = {}) {
  const window = createYouTubeMusicWindow();
  if (window.isMinimized()) window.restore();
  if (visible) {
    window.show();
    window.focus();
  }

  if (!youtubeMusicLoaded || !isControllableYouTubeMusicUrl(window.webContents.getURL())) {
    await window.loadURL("https://music.youtube.com/");
    youtubeMusicLoaded = true;
    await waitForWindowLoad(window);
  }

  await installYouTubePlayerEventBridge(window);
  await installYouTubeAudioMode(window);
  await installYouTubeActivityKeepAlive(window);
  await applyYouTubeVolume(window);
  return window;
}

async function openYouTubeMusicWindow() {
  const window = await ensureYouTubeMusicLoaded({ visible: true });
  // If user closed/hid while initial load was in progress, do not re-show.
  if (window && !window.isDestroyed() && window.isVisible()) {
    window.show();
    window.focus();
  }
  return { ok: true, opened: true, visible: true };
}

async function installYouTubePlayerEventBridge(window) {
  if (!window || window.isDestroyed()) return;
  await window.webContents.executeJavaScript(`
    (() => {
      if (window.forzaDashPlayerEventBridgeInstalled) return true;
      window.forzaDashPlayerEventBridgeInstalled = true;

      const readState = (api) => {
        const playerApi = api || document.querySelector("#movie_player");
        const media = document.querySelector("video, audio");
        const response =
          typeof playerApi?.getPlayerResponse === "function"
            ? playerApi.getPlayerResponse()
            : null;
        const details = response?.videoDetails || {};
        const thumbnail = Array.isArray(details.thumbnail?.thumbnails)
          ? details.thumbnail.thumbnails[details.thumbnail.thumbnails.length - 1]?.url || ""
          : "";
        window.forzaDashPlayerState = {
          title: details.title || "",
          artist: details.author || "",
          duration: Number(details.lengthSeconds) || 0,
          progress:
            typeof playerApi?.getCurrentTime === "function"
              ? Number(playerApi.getCurrentTime()) || 0
              : Number(media?.currentTime) || 0,
          image: thumbnail ? thumbnail.split("?")[0] : "",
          isPlaying: media ? !media.paused : undefined,
          at: Date.now(),
        };
        return window.forzaDashPlayerState;
      };

      document.addEventListener("apiLoaded", (event) => {
        const api = event.detail;
        readState(api);
        api?.addEventListener?.("videodatachange", (name) => {
          if (name === "dataloaded" || name === "dataupdated") readState(api);
        });
      }, { once: true, passive: true });

      for (const eventName of ["playing", "pause", "timeupdate", "loadedmetadata"]) {
        document.addEventListener(eventName, () => readState(), true);
      }

      readState();
      return true;
    })();
  `).catch(() => {});
}

async function installYouTubeActivityKeepAlive(window) {
  if (!window || window.isDestroyed()) return;
  await window.webContents.executeJavaScript(`
    (() => {
      if (window.forzaDashActivityKeepAliveInstalled) return true;
      window.forzaDashActivityKeepAliveInstalled = true;
      const markActive = () => {
        window._lact = Date.now();
      };
      markActive();
      setInterval(markActive, 900000);
      return true;
    })();
  `).catch(() => {});
}

async function installYouTubeAudioMode(window) {
  if (!window || window.isDestroyed()) return;
  await window.webContents.executeJavaScript(`
    (() => {
      const $ = (selector) => document.querySelector(selector);
      const changeDisplay = (showVideo) => {
        const player = $("ytmusic-player");
        const songVideo = $("#song-video.ytmusic-player");
        const songImage = $("#song-image");
        if (!player || !songVideo || !songImage) return false;

        player.style.margin = showVideo ? "" : "auto 0px";
        player.setAttribute("playback-mode", showVideo ? "OMV_PREFERRED" : "ATV_PREFERRED");
        songVideo.style.display = showVideo ? "block" : "none";
        songImage.style.display = showVideo ? "none" : "block";
        return true;
      };

      const forcePlaybackMode = () => {
        const player = $("ytmusic-player");
        if (!player || window.forzaDashAudioModeObserverInstalled) return;
        window.forzaDashAudioModeObserverInstalled = true;
        const playbackModeObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            if (mutation.target.getAttribute("playback-mode") !== "ATV_PREFERRED") {
              playbackModeObserver.disconnect();
              window.forzaDashAudioModeObserverInstalled = false;
              mutation.target.setAttribute("playback-mode", "ATV_PREFERRED");
              changeDisplay(false);
              forcePlaybackMode();
              break;
            }
          }
        });
        playbackModeObserver.observe(player, { attributeFilter: ["playback-mode"] });
      };

      const apply = () => {
        if (changeDisplay(false)) forcePlaybackMode();
      };

      apply();
      setTimeout(apply, 500);
      setTimeout(apply, 1500);
      return true;
    })();
  `).catch(() => {});
}

async function installYouTubeBeatAnalyzer(window, enabled = false) {
  if (!window || window.isDestroyed()) return;
  if (!enabled || !isDemoDriveModeEnabled()) {
    await window.webContents.executeJavaScript(`
      (() => {
        if (window.forzaDashBeatAnalyzer?.timer) {
          clearInterval(window.forzaDashBeatAnalyzer.timer);
        }
        window.forzaDashBeatAnalyzer = {
          supported: true,
          energy: 0,
          intensity: 0,
          bass: 0,
          mid: 0,
          treble: 0,
          beat: 0,
          drop: 0,
          beatAt: 0,
          dropAt: 0,
          at: Date.now(),
          confidence: 0,
        };
        return true;
      })();
    `).catch(() => {});
    return;
  }
  await window.webContents.executeJavaScript(`
    (() => {
      const media = document.querySelector("video, audio");
      if (!media) return false;
      if (window.forzaDashBeatAnalyzer?.media === media && window.forzaDashBeatAnalyzer?.version === 2) {
        window.forzaDashAudioContext?.resume?.().catch?.(() => {});
        return true;
      }

      if (window.forzaDashBeatAnalyzer?.timer) {
        clearInterval(window.forzaDashBeatAnalyzer.timer);
      }

      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return false;
        const context = window.forzaDashAudioContext || new AudioContext();
        window.forzaDashAudioContext = context;

        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.54;

        let source = window.forzaDashMediaSource;
        if (!source || window.forzaDashBeatAnalyzer?.media !== media) {
          source = context.createMediaElementSource(media);
          window.forzaDashMediaSource = source;
        }

        try { source.disconnect(); } catch {}
        source.connect(analyser);
        analyser.connect(context.destination);

        const bins = new Uint8Array(analyser.frequencyBinCount);
        const timeBins = new Uint8Array(analyser.fftSize);
        const previousBins = new Uint8Array(analyser.frequencyBinCount);
        const range = {
          rms: { floor: 0.004, peak: 0.14, seen: false },
          bass: { floor: 0.004, peak: 0.16, seen: false },
          mid: { floor: 0.004, peak: 0.13, seen: false },
          treble: { floor: 0.004, peak: 0.1, seen: false },
          flux: { floor: 0.002, peak: 0.08, seen: false },
        };
        const state = {
          version: 2,
          media,
          context,
          analyser,
          bins,
          timeBins,
          range,
          fastEnergy: 0,
          slowEnergy: 0,
          fastBass: 0,
          slowBass: 0,
          quietScore: 0,
          lastBeatPerf: 0,
          energy: 0,
          intensity: 0,
          bass: 0,
          mid: 0,
          treble: 0,
          beat: 0,
          drop: 0,
          beatAt: 0,
          dropAt: 0,
          confidence: 0,
          supported: true,
        };
        window.forzaDashBeatAnalyzer = state;

        const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
        const lerp = (from, to, amount) => from + (to - from) * amount;
        const binForHz = (hz) =>
          clamp(Math.round(hz / (context.sampleRate / analyser.fftSize)), 0, bins.length - 1);
        const readBand = (startHz, endHz) => {
          const start = binForHz(startHz);
          const end = binForHz(endHz);
          let total = 0;
          let count = 0;
          for (let index = start; index <= end && index < bins.length; index += 1) {
            total += bins[index] / 255;
            count += 1;
          }
          return count ? total / count : 0;
        };
        const normalize = (name, rawValue) => {
          const raw = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
          const item = range[name];
          if (!item.seen) {
            item.floor = Math.max(0, raw * 0.55);
            item.peak = Math.max(raw + 0.035, raw * 1.35, item.peak);
            item.seen = true;
          }

          item.floor =
            raw < item.floor
              ? lerp(item.floor, raw, 0.34)
              : lerp(item.floor, raw, 0.0025);
          item.peak =
            raw > item.peak
              ? lerp(item.peak, raw, 0.44)
              : lerp(item.peak, raw, 0.006);

          if (item.peak < item.floor + 0.035) item.peak = item.floor + 0.035;
          return clamp((raw - item.floor) / (item.peak - item.floor), 0, 1);
        };

        const tick = () => {
          if (window.forzaDashBeatAnalyzer !== state) return;
          analyser.getByteFrequencyData(bins);
          analyser.getByteTimeDomainData(timeBins);

          let timeTotal = 0;
          for (let index = 0; index < timeBins.length; index += 1) {
            const centered = (timeBins[index] - 128) / 128;
            timeTotal += centered * centered;
          }
          const rmsRaw = Math.sqrt(timeTotal / timeBins.length);
          const bassRaw = readBand(45, 160);
          const midRaw = readBand(170, 2100);
          const trebleRaw = readBand(2200, 9000);

          let fluxRaw = 0;
          let fluxCount = 0;
          const fluxStart = binForHz(45);
          const fluxEnd = binForHz(3600);
          for (let index = fluxStart; index <= fluxEnd && index < bins.length; index += 1) {
            fluxRaw += Math.max(0, (bins[index] - previousBins[index]) / 255);
            previousBins[index] = bins[index];
            fluxCount += 1;
          }
          fluxRaw = fluxCount ? fluxRaw / fluxCount : 0;

          const rms = normalize("rms", rmsRaw);
          const bass = normalize("bass", bassRaw);
          const mid = normalize("mid", midRaw);
          const treble = normalize("treble", trebleRaw);
          const flux = normalize("flux", fluxRaw);
          const now = performance.now();

          state.fastEnergy = lerp(state.fastEnergy, rms, 0.28);
          state.slowEnergy = lerp(state.slowEnergy, rms, 0.035);
          state.fastBass = lerp(state.fastBass, bass, 0.36);
          state.slowBass = lerp(state.slowBass, bass, 0.045);
          state.quietScore = clamp(
            state.quietScore + (state.slowEnergy < 0.33 ? 0.018 : -0.012),
            0,
            1,
          );

          const bassTransient = clamp((state.fastBass - state.slowBass) * 3.2, 0, 1);
          const energyTransient = clamp((state.fastEnergy - state.slowEnergy) * 2.4, 0, 1);
          const beatCandidate = clamp(
            bassTransient * 0.58 + flux * 0.36 + bass * 0.2 + energyTransient * 0.26,
            0,
            1,
          );
          const canTrigger = now - state.lastBeatPerf > 165;
          state.beat = Math.max(0, state.beat * 0.72);
          if (beatCandidate > 0.42 && canTrigger) {
            state.beat = beatCandidate;
            state.beatAt = Date.now();
            state.lastBeatPerf = now;
          }

          const dropCandidate = clamp(
            (beatCandidate * 0.56 + energyTransient * 0.5 + bass * 0.22) *
              (0.42 + state.quietScore * 0.78),
            0,
            1,
          );
          state.drop = Math.max(state.drop * 0.82, dropCandidate > 0.44 ? dropCandidate : 0);
          if (state.drop > 0.5) state.dropAt = Date.now();

          const confidence = clamp(rmsRaw * 14 + bassRaw * 5 + midRaw * 3, 0, 1);
          state.confidence = confidence;
          state.energy = rms;
          state.intensity = clamp(
            state.slowEnergy * 0.42 +
              state.fastEnergy * 0.28 +
              bass * 0.14 +
              mid * 0.1 +
              state.beat * 0.08,
            0,
            1,
          );
          state.bass = bass;
          state.mid = mid;
          state.treble = treble;
          state.at = Date.now();

          if (media.paused || media.muted || media.volume <= 0) {
            state.beat = 0;
            state.drop = 0;
            state.intensity = 0;
          }
        };

        context.resume?.().catch?.(() => {});
        tick();
        state.timer = setInterval(tick, 45);
        return true;
      } catch (error) {
        window.forzaDashBeatAnalyzer = {
          version: 2,
          media,
          supported: false,
          error: error?.message || String(error),
          at: Date.now(),
        };
        return false;
      }
    })();
  `).catch(() => {});
}

async function applyYouTubeVolume(window) {
  if (!window || window.isDestroyed()) return;
  await window.webContents.executeJavaScript(`
    (() => {
      const preferredVolume = ${JSON.stringify(youtubePreferredVolume)};
      const preferredMuted = ${JSON.stringify(youtubePreferredMuted)};
      const medias = Array.from(document.querySelectorAll("video, audio"));
      const playerApi = document.querySelector("#movie_player");
      for (const media of medias) {
        if (typeof preferredVolume === "number") media.volume = Math.min(1, Math.max(0, preferredVolume / 100));
        if (typeof preferredMuted === "boolean") media.muted = preferredMuted;
      }
      if (playerApi && typeof preferredVolume === "number" && typeof playerApi.setVolume === "function") {
        playerApi.setVolume(Math.min(100, Math.max(0, Math.round(preferredVolume))));
      }
      if (playerApi && typeof playerApi.mute === "function" && typeof playerApi.unMute === "function") {
        if (preferredMuted === true) playerApi.mute();
        if (preferredMuted === false) playerApi.unMute();
      }
      return true;
    })();
  `).catch(() => {});
}

function sendYouTubeKey(window, keyCode, modifiers = []) {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}

function normalizeVersionTag(tag) {
  return String(tag || "").trim().replace(/^v/i, "");
}

function compareVersions(a, b) {
  const pa = normalizeVersionTag(a).split(".").map((x) => Number(x) || 0);
  const pb = normalizeVersionTag(b).split(".").map((x) => Number(x) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function httpsGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "ForzaDash", Accept: "application/vnd.github+json", ...headers } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body || "{}"));
          } catch {
            reject(new Error("Invalid JSON"));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => req.destroy(new Error("Timeout")));
  });
}

async function checkForGithubUpdate() {
  const repo = String(
    process.env.VITE_GITHUB_REPO ||
      process.env.GITHUB_REPO ||
      DEFAULT_GITHUB_REPO,
  ).trim();
  const currentVersion = app.getVersion();
  const forceUpdate = String(process.env.VITE_FORCE_UPDATE_AVAILABLE || "").trim() === "true";
  if (!repo) {
    return { ok: true, configured: false, currentVersion, updateAvailable: forceUpdate };
  }

  const latest = await httpsGetJson(`https://api.github.com/repos/${repo}/releases/latest`);
  const latestVersion = normalizeVersionTag(latest.tag_name || latest.name || "");
  const updateAvailable =
    forceUpdate ||
    (Boolean(latestVersion) && compareVersions(latestVersion, currentVersion) > 0);
  return {
    ok: true,
    configured: true,
    repo,
    currentVersion,
    latestVersion,
    updateAvailable,
    releaseUrl: latest.html_url || "",
  };
}

async function logoutYouTubeMusic() {
  const session = youtubeMusicSession();

  if (youtubeMusicWindow && !youtubeMusicWindow.isDestroyed()) {
    youtubeMusicWindow.destroy();
  }
  youtubeMusicWindow = null;
  youtubeMusicLoaded = false;

  if (session) {
    await session.clearStorageData({
      storages: [
        "cookies",
        "filesystem",
        "indexdb",
        "localstorage",
        "shadercache",
        "websql",
        "serviceworkers",
        "cachestorage",
      ],
      quotas: ["temporary", "persistent", "syncable"],
    });
    await session.clearCache();
  }
  try {
    fs.unlinkSync(getYouTubeStateFilePath());
  } catch {}

  return { ok: true, loggedOut: true };
}

async function playRandomYouTubeMusic(options = {}) {
  const keepWindowOpen = Boolean(options.keepWindowOpen);
  const wasLoaded = youtubeMusicLoaded;
  const window = await ensureYouTubeMusicLoaded({ visible: keepWindowOpen || !wasLoaded });

  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const playButton = document.querySelector(
        "ytmusic-player-bar #play-pause-button, ytmusic-player-bar .play-pause-button"
      );
      const label = playButton?.getAttribute("aria-label") || "";
      if (/play/i.test(label)) playButton.click();
      const media = document.querySelector("video, audio");
      if (media?.paused) media.play?.().catch?.(() => {});
      await sleep(500);
      const status = ${youtubeStatusScript};
      return { ...status, ok: true };
    })();
  `);

  await applyYouTubeVolume(window);

  if (result?.ok && !keepWindowOpen) {
    setTimeout(() => hideYouTubeMusicWindow(true), 1000);
  }

  return result;
}

async function stopYouTubeMusic() {
  if (!youtubeMusicWindow || youtubeMusicWindow.isDestroyed()) {
    return { ok: true, stopped: false };
  }

  const window = youtubeMusicWindow;
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector(
        "ytmusic-player-bar #play-pause-button, ytmusic-player-bar .play-pause-button"
      );
      const label = button?.getAttribute("aria-label") || "";
      if (/pause/i.test(label)) button.click();
      const video = document.querySelector("video, audio");
      if (video) video.pause();
      return true;
    })();
  `);
  hideYouTubeMusicWindow(true);
  const status = await getYouTubeMusicStatus();
  return { ...status, stopped: true };
}

const youtubeStatusScript = `(() => {
  try {
    const text = (selector) =>
      document.querySelector(selector)?.textContent?.trim() || "";
    const asSeconds = (value) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= 0 ? n : NaN;
    };
    const timeToSeconds = (value) => {
      const parts = String(value || "")
        .trim()
        .split(":")
        .map((part) => Number(part));
      if (!parts.length || parts.some((part) => !Number.isFinite(part))) return NaN;
      return parts.reduce((total, part) => total * 60 + part, 0);
    };
    const playerApi = document.querySelector("#movie_player");
    const playerResponse =
      typeof playerApi?.getPlayerResponse === "function"
        ? playerApi.getPlayerResponse()
        : null;
    const eventState = window.forzaDashPlayerState || {};
    const image =
      eventState.image ||
      document.querySelector("ytmusic-player-bar img.image")?.src ||
      document.querySelector("ytmusic-player-bar img")?.src ||
      "";
    const medias = Array.from(document.querySelectorAll("video, audio"));
    const media =
      medias.find((item) => !item.paused && !item.ended) ||
      medias.find(
        (item) =>
          !item.ended &&
          Number.isFinite(item.duration) &&
          item.duration > 0 &&
          item.readyState >= 1,
      ) ||
      medias[0];
    const playButton = document.querySelector(
      "ytmusic-player-bar #play-pause-button, ytmusic-player-bar .play-pause-button"
    );
    const label = playButton?.getAttribute("aria-label") || "";
    const apiDurationSeconds =
      typeof playerApi?.getDuration === "function"
        ? Number(playerApi.getDuration())
        : NaN;
    const apiProgressSeconds =
      typeof playerApi?.getCurrentTime === "function"
        ? Number(playerApi.getCurrentTime())
        : NaN;
    const progressBar = document.querySelector("#progress-bar");
    const progressBarSeconds = asSeconds(
      progressBar?.getAttribute("value") ||
      progressBar?.getAttribute("aria-valuenow")
    );
    const progressMaxSeconds = asSeconds(
      progressBar?.getAttribute("max") ||
      progressBar?.getAttribute("aria-valuemax")
    );
    const timeInfo = Array.from(document.querySelectorAll("ytmusic-player-bar, ytmusic-player"))
      .map((node) => node.textContent || "")
      .join(" ");
    const timeMatch = timeInfo.match(/(\\d{1,2}:\\d{2})(?:\\s*\\/\\s*|\\s+)(\\d{1,2}:\\d{2})/);
    const visibleProgressSeconds = timeMatch ? timeToSeconds(timeMatch[1]) : NaN;
    const visibleDurationSeconds = timeMatch ? timeToSeconds(timeMatch[2]) : NaN;
    const responseDurationSeconds = asSeconds(playerResponse?.videoDetails?.lengthSeconds);
    const responseProgressSeconds = asSeconds(playerResponse?.videoDetails?.elapsedSeconds);
    const eventDurationSeconds = asSeconds(eventState.duration);
    const eventProgressSeconds = asSeconds(eventState.progress);
    const duration =
      Number.isFinite(eventDurationSeconds) && eventDurationSeconds > 0
        ? eventDurationSeconds * 1000
        : Number.isFinite(responseDurationSeconds) && responseDurationSeconds > 0
        ? responseDurationSeconds * 1000
        : Number.isFinite(visibleDurationSeconds) && visibleDurationSeconds > 0
          ? visibleDurationSeconds * 1000
          : Number.isFinite(progressMaxSeconds) && progressMaxSeconds > 0
            ? progressMaxSeconds * 1000
            : Number.isFinite(apiDurationSeconds) && apiDurationSeconds > 0
        ? apiDurationSeconds * 1000
        : Number.isFinite(media?.duration)
          ? media.duration * 1000
          : 0;
    const rawProgress =
      Number.isFinite(eventProgressSeconds) && eventProgressSeconds >= 0
        ? eventProgressSeconds * 1000
        : Number.isFinite(responseProgressSeconds) && responseProgressSeconds >= 0
        ? responseProgressSeconds * 1000
        : Number.isFinite(visibleProgressSeconds) && visibleProgressSeconds >= 0
          ? visibleProgressSeconds * 1000
          : Number.isFinite(progressBarSeconds) && progressBarSeconds >= 0
            ? progressBarSeconds * 1000
            : Number.isFinite(apiProgressSeconds) && apiProgressSeconds >= 0
        ? apiProgressSeconds * 1000
        : Number.isFinite(media?.currentTime)
          ? media.currentTime * 1000
          : 0;
    const progress = duration > 0 ? Math.min(duration, Math.max(0, rawProgress)) : 0;
    const volume = Number.isFinite(media?.volume) ? Math.round(media.volume * 100) : 100;
    const muted = Boolean(media?.muted);
    const analyzer = window.forzaDashBeatAnalyzer || {};
    return {
      ok: true,
      available: true,
      visible: document.visibilityState === "visible",
      title: eventState.title || text("ytmusic-player-bar .title") || "YouTube Music",
      artist: eventState.artist || text("ytmusic-player-bar .byline") || "Ready to play",
      album: text("ytmusic-player-bar .subtitle") || "YouTube Music",
      image,
      duration,
      progress,
      volume,
      muted,
      audio: {
        supported: analyzer.supported !== false,
        energy: Number(analyzer.energy) || 0,
        intensity: Number(analyzer.intensity) || 0,
        bass: Number(analyzer.bass) || 0,
        mid: Number(analyzer.mid) || 0,
        treble: Number(analyzer.treble) || 0,
        beat: Number(analyzer.beat) || 0,
        drop: Number(analyzer.drop) || 0,
        beatAt: Number(analyzer.beatAt) || 0,
        dropAt: Number(analyzer.dropAt) || 0,
        at: Number(analyzer.at) || 0,
        confidence: Number(analyzer.confidence) || 0,
        error: analyzer.error || ""
      },
      isPlaying:
        typeof eventState.isPlaying === "boolean"
          ? eventState.isPlaying
          : /pause/i.test(label) || Boolean(media && !media.paused)
    };
  } catch (error) {
    return {
      ok: true,
      available: true,
      title: "YouTube Music",
      artist: "Loading",
      album: "YouTube Music",
      image: "",
      duration: 0,
      progress: 0,
      volume: 100,
      muted: false,
      isPlaying: false
    };
  }
})()`;

async function getYouTubeMusicStatus(options = {}) {
  if (!youtubeMusicWindow || youtubeMusicWindow.isDestroyed()) {
    return { ok: true, available: false, visible: false, isPlaying: false };
  }
  if (!isControllableYouTubeMusicUrl(youtubeMusicWindow.webContents.getURL())) {
    return {
      ok: true,
      available: false,
      visible: youtubeMusicWindow.isVisible(),
      isPlaying: false,
      title: "YouTube Music",
      artist: "Open YouTube Music to control playback",
      album: "YouTube Music",
      image: "",
      duration: 0,
      progress: 0,
    };
  }
  await installYouTubePlayerEventBridge(youtubeMusicWindow);
  await installYouTubeAudioMode(youtubeMusicWindow);
  await installYouTubeBeatAnalyzer(youtubeMusicWindow, Boolean(options.analyze));
  await applyYouTubeVolume(youtubeMusicWindow);
  const status = await youtubeMusicWindow.webContents.executeJavaScript(youtubeStatusScript);
  return {
    ...status,
    available: true,
    visible: youtubeMusicWindow.isVisible(),
  };
}

async function controlYouTubeMusic(command) {
  if (!youtubeMusicWindow || youtubeMusicWindow.isDestroyed()) {
    if (command === "toggle" || command === "play") {
      return playRandomYouTubeMusic();
    }
    return { ok: false, error: "YouTube Music is not open" };
  }
  if (!isControllableYouTubeMusicUrl(youtubeMusicWindow.webContents.getURL())) {
    return { ok: false, error: "Open YouTube Music to control playback" };
  }

  const allowedCommands = new Set([
    "toggle",
    "play",
    "pause",
    "next",
    "previous",
    "shuffle",
    "repeat",
  ]);
  if (!allowedCommands.has(command)) {
    return { ok: false, error: "Unsupported YouTube Music command" };
  }

  const window = youtubeMusicWindow;
  await installYouTubePlayerEventBridge(window);
  await installYouTubeAudioMode(window);
  if (command === "toggle") {
    await window.webContents.executeJavaScript(`
      (() => {
        try {
          const playerApi = document.querySelector("#movie_player");
          if (playerApi && typeof playerApi.playVideo === "function" && typeof playerApi.getPlayerState === "function") {
            const state = playerApi.getPlayerState();
            if (state === 1) playerApi.pauseVideo();
            else playerApi.playVideo();
            return true;
          }
          const button = document.querySelector(
            "ytmusic-player-bar #play-pause-button, ytmusic-player-bar .play-pause-button, #play-pause-button, .play-pause-button"
          );
          if (button && typeof button.click === "function") {
            button.click();
            return true;
          }
          const media = document.querySelector("video, audio");
          if (media) {
            if (media.paused) media.play().catch(() => {});
            else media.pause();
          }
        } catch {}
        return true;
      })();
    `).catch(() => {});
  }
  if (command === "next") sendYouTubeKey(window, "j");
  if (command === "previous") sendYouTubeKey(window, "k");
  if (command === "shuffle") sendYouTubeKey(window, "s");
  if (command === "repeat") sendYouTubeKey(window, "r");

  if (command === "play" || command === "pause") {
    await window.webContents.executeJavaScript(`
      (() => {
        const shouldPlay = ${JSON.stringify(command === "play")};
        const playerApi = document.querySelector("#movie_player");
        if (playerApi && typeof playerApi.playVideo === "function" && typeof playerApi.pauseVideo === "function") {
          if (shouldPlay) playerApi.playVideo();
          else playerApi.pauseVideo();
          return true;
        }
        const button = document.querySelector(
          "ytmusic-player-bar #play-pause-button, ytmusic-player-bar .play-pause-button, #play-pause-button"
        );
        const label = button?.getAttribute("aria-label") || "";
        if (shouldPlay && /play/i.test(label)) button?.click();
        if (!shouldPlay && /pause/i.test(label)) button?.click();
        const media = document.querySelector("video, audio");
        if (shouldPlay && media?.paused) media.play?.().catch?.(() => {});
        if (!shouldPlay && media && !media.paused) media.pause();
        return true;
      })();
    `);
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  await applyYouTubeVolume(window);
  return getYouTubeMusicStatus();
}

async function jumpYouTubeMusic(searchParams) {
  if (!youtubeMusicWindow || youtubeMusicWindow.isDestroyed()) {
    return { ok: false, error: "YouTube Music is not open" };
  }
  if (!isControllableYouTubeMusicUrl(youtubeMusicWindow.webContents.getURL())) {
    return { ok: false, error: "Open YouTube Music to jump" };
  }

  const deltaMs = Number(searchParams.get("delta"));
  const forward = !Number.isFinite(deltaMs) || deltaMs >= 0;
  sendYouTubeKey(youtubeMusicWindow, forward ? "l" : "h");
  await new Promise((resolve) => setTimeout(resolve, 120));
  return getYouTubeMusicStatus();
}

async function setYouTubeMusicVolume(searchParams) {
  if (!youtubeMusicWindow || youtubeMusicWindow.isDestroyed()) {
    return { ok: false, error: "YouTube Music is not open" };
  }
  if (!isControllableYouTubeMusicUrl(youtubeMusicWindow.webContents.getURL())) {
    return { ok: false, error: "Open YouTube Music to control volume" };
  }
  const volume = Number(searchParams.get("value"));
  const rawMuted = searchParams.get("muted");
  const hasVolume = Number.isFinite(volume);
  const muted = rawMuted === "true" ? true : rawMuted === "false" ? false : null;
  if (hasVolume) youtubePreferredVolume = Math.min(100, Math.max(0, volume));
  if (hasVolume && youtubePreferredVolume === 0 && muted === null) {
    youtubePreferredMuted = true;
  }
  if (muted !== null) youtubePreferredMuted = muted;
  await applyYouTubeVolume(youtubeMusicWindow);
  return getYouTubeMusicStatus();
}

if (singleInstanceLock) {
  app.on("second-instance", () => {
    if (dashboardUrl) {
      if (!dashboardWindow) {
        createDashboardWindow(dashboardUrl);
      } else {
        dashboardWindow.show();
        dashboardWindow.focus();
      }
    }
  });

  app.whenReady().then(async () => {
    writeStartupLog("app ready");
    app.setAppUserModelId("com.forzadash.app");
    if (!powerSaveBlocker.isStarted(mediaSuspendBlockerId ?? -1)) {
      mediaSuspendBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
    loadRuntimeEnv();
    applySavedSettingsToEnv();
    const serverEntryPath = getServerEntryPath();
    writeStartupLog(`loading server: ${serverEntryPath}`);
    require(serverEntryPath);
    dashboardUrl = await startDashboardServer();
    writeStartupLog(`dashboard url: ${dashboardUrl}`);
    createTray(dashboardUrl);
    createDashboardWindow(dashboardUrl);
    writeStartupLog("dashboard window created");
  }).catch((error) => {
    writeStartupLog(`startup failed: ${error?.stack || error?.message || error}`);
    console.error(error);
    dialog.showErrorBox(
      "ForzaDash startup failed",
      error?.message || "ForzaDash could not start.",
    );
    app.quit();
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  if (
    mediaSuspendBlockerId !== null &&
    powerSaveBlocker.isStarted(mediaSuspendBlockerId)
  ) {
    powerSaveBlocker.stop(mediaSuspendBlockerId);
    mediaSuspendBlockerId = null;
  }
  if (youtubeMusicWindow && !youtubeMusicWindow.isDestroyed()) {
    youtubeMusicWindow.destroy();
    youtubeMusicWindow = null;
    youtubeMusicLoaded = false;
  }
  webServer?.close();
});
