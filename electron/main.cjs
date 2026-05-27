const { app, BrowserWindow, Menu, Tray, shell } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const DEFAULT_DASHBOARD_PORT = 5173;
const LOCAL_HOST = "127.0.0.1";

let tray = null;
let webServer = null;
let dashboardUrl = null;
let dashboardWindow = null;
let youtubeMusicWindow = null;
let youtubeMusicLoaded = false;
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

if (!singleInstanceLock) {
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
  forzaUdpForwardPort: "VITE_FORZA_UDP_FORWARD_PORT",
  forzaUdpForwardPort2: "VITE_FORZA_UDP_FORWARD_PORT_2",
  telemetryWsPort: "VITE_TELEMETRY_WS_PORT",
  weatherRegion: "VITE_WEATHER_REGION",
  backgroundColor: "VITE_BACKGROUND_COLOR",
  spotifyClientId: "VITE_SPOTIFY_CLIENT_ID",
};

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), "forzadash-settings.json");
}

function readSettingsFile() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsFilePath(), "utf8"));
  } catch {
    return null;
  }
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

function applySavedSettingsToEnv() {
  const settings = readSettingsFile() || readElectronLocalStorageSettings();
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
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
    }[ext] || "application/octet-stream"
  );
}

function sendFile(response, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(data);
  });
}

function readHardwareTemperature() {
  const script = `
$gpuSensors = @()
$cpuSensors = @()
foreach ($namespace in @("root/LibreHardwareMonitor", "root/OpenHardwareMonitor")) {
  try {
    $allSensors = Get-CimInstance -Namespace $namespace -ClassName Sensor -ErrorAction Stop |
      Where-Object { $_.SensorType -eq "Temperature" }
    $gpuSensors += $allSensors |
      Where-Object { $_.Name -match "GPU|Graphics|Hot Spot|Core" -or $_.Parent -match "GPU|Graphics|Radeon|NVIDIA|GeForce" } |
      Select-Object Name, Parent, Value
    $cpuSensors += $allSensors |
      Where-Object { $_.Name -match "CPU|Package|Core" -or $_.Parent -match "CPU" } |
      Select-Object Name, Parent, Value
  } catch {}
}

if ($gpuSensors.Count -gt 0) {
  $gpu0 = $gpuSensors | Where-Object { $_.Parent -match "0|Radeon|AMD" -or $_.Name -match "GPU Core|GPU Temperature|Core" } | Select-Object -First 1
  if (-not $gpu0) { $gpu0 = $gpuSensors | Select-Object -First 1 }
  [PSCustomObject]@{
    temperature = [Math]::Round([double]$gpu0.Value, 0)
    source = "gpu-wmi"
    name = $gpu0.Name
    parent = $gpu0.Parent
  } | ConvertTo-Json -Compress
  exit
}

if ($cpuSensors.Count -gt 0) {
  $cpu = $cpuSensors | Select-Object -First 1
  [PSCustomObject]@{
    temperature = [Math]::Round([double]$cpu.Value, 0)
    source = "cpu-wmi"
    name = $cpu.Name
    parent = $cpu.Parent
  } | ConvertTo-Json -Compress
  exit
}

try {
  $thermal = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop |
    Select-Object -First 1 -ExpandProperty CurrentTemperature
  if ($thermal) {
    [PSCustomObject]@{
      temperature = [Math]::Round(($thermal / 10) - 273.15, 0)
      source = "thermal-zone"
      name = "MSAcpi_ThermalZoneTemperature"
      parent = ""
    } | ConvertTo-Json -Compress
  }
} catch {}
`;

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 3000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve({ temperature: null, source: "unavailable" });
          return;
        }

        try {
          const data = JSON.parse(String(stdout).trim().split(/\r?\n/).pop() || "{}");
          const value = Number(data.temperature);
          const result = {
            temperature: Number.isFinite(value) && value > 0 ? value : null,
            source: data.source || "unavailable",
            name: data.name || "",
            parent: data.parent || "",
          };
          resolve(result);
        } catch (parseError) {
          resolve({ temperature: null, source: "parse-failed" });
        }
      },
    );
  });
}

function startDashboardServer() {
  const dashboardRoot = path.join(__dirname, "..", "dist", "app");
  const port = envPort("VITE_DASHBOARD_PORT", DEFAULT_DASHBOARD_PORT);

  webServer = http.createServer((request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);

    if (url.pathname === "/api/settings" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(readSettingsFile() || {}));
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
      getYouTubeMusicStatus()
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

    if (url.pathname === "/api/youtube-music/volume") {
      setYouTubeMusicVolume(url.searchParams)
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              ok: false,
              error: error?.message || "YouTube Music volume failed",
            }),
          );
        });
      return;
    }

    if (url.pathname === "/api/youtube-music/seek") {
      seekYouTubeMusic(url.searchParams)
        .then((result) => {
          response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          response.end(JSON.stringify(result));
        })
        .catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          response.end(
            JSON.stringify({
              ok: false,
              error: error?.message || "YouTube Music seek failed",
            }),
          );
        });
      return;
    }

    if (url.pathname === "/api/hardware-temp" || url.pathname === "/api/cpu-temp") {
      readHardwareTemperature().then((result) => {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(result));
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
    webServer.once("error", reject);
    webServer.listen(port, LOCAL_HOST, () => {
      webServer.off("error", reject);
      resolve(`http://127.0.0.1:${port}/`);
      console.log(`Dashboard listening on http://127.0.0.1:${port}/`);
    });
  });
}

function createTray(dashboardUrl) {
  tray = new Tray(path.join(__dirname, "..", "forza-logo.png"));
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
    },
  });

  dashboardWindow.loadURL(dashboardUrl);
  dashboardWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.alt && input.key === "Enter") {
      event.preventDefault();
      toggleDashboardFullscreen();
    }
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

function hideYouTubeMusicWindow() {
  if (youtubeMusicWindow && !youtubeMusicWindow.isDestroyed()) {
    youtubeMusicWindow.hide();
  }
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
  }
}

function hideYouTubeMusicOnly() {
  if (youtubeMusicWindow && !youtubeMusicWindow.isDestroyed()) {
    youtubeMusicWindow.hide();
  }
}

async function openYouTubeMusicWindow() {
  const window = createYouTubeMusicWindow();
  window.show();
  window.focus();
  if (!youtubeMusicLoaded) {
    await window.loadURL("https://music.youtube.com/");
    youtubeMusicLoaded = true;
  }
  return { ok: true, opened: true };
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

  return { ok: true, loggedOut: true };
}

function waitForWindowLoad(window) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 10000);
    window.webContents.once("did-finish-load", () => {
      clearTimeout(timeout);
      setTimeout(resolve, 1800);
    });
  });
}

async function playRandomYouTubeMusic() {
  const queries = [
    "Blinding Lights",
    "Starboy",
    "After Hours",
    "Levitating",
    "Heat Waves",
    "The Nights",
    "Midnight City",
  ];
  const query = queries[Math.floor(Math.random() * queries.length)];
  const window = createYouTubeMusicWindow();
  const shouldShowForLogin = !youtubeMusicLoaded;
  if (shouldShowForLogin) {
    window.show();
    window.focus();
  }
  await window.loadURL(
    `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
  );
  youtubeMusicLoaded = true;
  await waitForWindowLoad(window);

  const result = await window.webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const selectors = [
        "ytmusic-responsive-list-item-renderer a[href*='watch']",
        "ytmusic-shelf-renderer a[href*='watch']",
        "a[href*='watch']"
      ];
      let target = null;
      for (let attempt = 0; attempt < 12 && !target; attempt += 1) {
        for (const selector of selectors) {
          target = document.querySelector(selector);
          if (target) break;
        }
        if (!target) await sleep(500);
      }
      if (!target) return { ok: false, error: "No playable result found" };
      target.click();
      await sleep(1500);
      const playButton = document.querySelector(
        "ytmusic-player-bar #play-pause-button, ytmusic-player-bar .play-pause-button"
      );
      const label = playButton?.getAttribute("aria-label") || "";
      if (/play/i.test(label)) playButton.click();
      await sleep(700);
      const status = ${youtubeStatusScript};
      return {
        ...status,
        ok: true,
        query: ${JSON.stringify(query)}
      };
    })();
  `);

  if (result?.ok && shouldShowForLogin) {
    setTimeout(hideYouTubeMusicWindow, 1200);
  }

  return result;
}

async function stopYouTubeMusic() {
  if (!youtubeMusicWindow || youtubeMusicWindow.isDestroyed()) {
    return { ok: true, stopped: false };
  }

  await youtubeMusicWindow.webContents.executeJavaScript(`
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
  youtubeMusicWindow.hide();
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
  }
  return { ok: true, stopped: true };
}

const youtubeStatusScript = `(() => {
  try {
    const text = (selector) =>
      document.querySelector(selector)?.textContent?.trim() || "";
    const image =
      document.querySelector("ytmusic-player-bar img.image")?.src ||
      document.querySelector("ytmusic-player-bar img")?.src ||
      "";
    const media = document.querySelector("video, audio");
    const playButton = document.querySelector(
      "ytmusic-player-bar #play-pause-button, ytmusic-player-bar .play-pause-button"
    );
    const label = playButton?.getAttribute("aria-label") || "";
    const duration = Number.isFinite(media?.duration) ? media.duration * 1000 : 0;
    const progress = Number.isFinite(media?.currentTime) ? media.currentTime * 1000 : 0;
    const volume = Number.isFinite(media?.volume) ? Math.round(media.volume * 100) : 100;
    return {
      ok: true,
      available: true,
      visible: Boolean(
        window.forzaDashYouTubeVisible ||
        document.visibilityState === "visible"
      ),
      title: text("ytmusic-player-bar .title") || "YouTube Music",
      artist: text("ytmusic-player-bar .byline") || "Ready to play",
      album: text("ytmusic-player-bar .subtitle") || "YouTube Music",
      image,
      duration,
      progress,
      volume,
      muted: Boolean(media?.muted),
      isPlaying: /pause/i.test(label) || Boolean(media && !media.paused)
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

async function getYouTubeMusicStatus() {
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
      volume: 100,
      muted: false,
    };
  }

  const status = await youtubeMusicWindow.webContents.executeJavaScript(
    youtubeStatusScript,
  );
  return {
    ...status,
    available: true,
    visible: youtubeMusicWindow.isVisible(),
  };
}

async function controlYouTubeMusic(command) {
  if (!youtubeMusicWindow || youtubeMusicWindow.isDestroyed()) {
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

  return youtubeMusicWindow.webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const findButton = (selectors) => {
        for (const selector of selectors) {
          const button = document.querySelector(selector);
          if (button) return button;
        }
        return null;
      };
      const playButton = () => findButton([
        "ytmusic-player-bar #play-pause-button",
        "ytmusic-player-bar .play-pause-button",
        "#play-pause-button",
      ]);
      const nextButton = () => findButton([
        "ytmusic-player-bar .next-button",
        "ytmusic-player-bar tp-yt-paper-icon-button.next-button",
        ".next-button",
      ]);
      const previousButton = () => findButton([
        "ytmusic-player-bar .previous-button",
        "ytmusic-player-bar tp-yt-paper-icon-button.previous-button",
        ".previous-button",
      ]);
      const shuffleButton = () => findButton([
        "ytmusic-player-bar #right-controls .shuffle",
        "ytmusic-player-bar .shuffle",
        "#right-controls .shuffle",
      ]);
      const repeatButton = () => findButton([
        "ytmusic-player-bar #right-controls .repeat",
        "ytmusic-player-bar .repeat",
        "#right-controls .repeat",
      ]);
      const label = () => playButton()?.getAttribute("aria-label") || "";
      const command = ${JSON.stringify(command)};

      if (command === "toggle") playButton()?.click();
      if (command === "play" && /play/i.test(label())) playButton()?.click();
      if (command === "pause" && /pause/i.test(label())) playButton()?.click();
      if (command === "next") nextButton()?.click();
      if (command === "previous") previousButton()?.click();
      if (command === "shuffle") shuffleButton()?.click();
      if (command === "repeat") repeatButton()?.click();

      await sleep(650);
      return ${youtubeStatusScript};
    })();
  `);
}

async function setYouTubeMusicVolume(searchParams) {
  if (!youtubeMusicWindow || youtubeMusicWindow.isDestroyed()) {
    return { ok: false, error: "YouTube Music is not open" };
  }
  if (!isControllableYouTubeMusicUrl(youtubeMusicWindow.webContents.getURL())) {
    return { ok: false, error: "Open YouTube Music to control volume" };
  }

  const rawVolume = searchParams.get("value");
  const rawMuted = searchParams.get("muted");
  const volume = Number(rawVolume);
  const hasVolume = Number.isFinite(volume);
  const muted =
    rawMuted === "true" ? true : rawMuted === "false" ? false : null;

  return youtubeMusicWindow.webContents.executeJavaScript(`
    (() => {
      const media = document.querySelector("video, audio");
      if (!media) return { ok: false, error: "No YouTube Music media found" };
      if (${JSON.stringify(hasVolume)}) {
        media.volume = Math.min(1, Math.max(0, ${JSON.stringify(volume)} / 100));
      }
      if (${JSON.stringify(muted)} !== null) {
        media.muted = ${JSON.stringify(muted)};
      }
      return ${youtubeStatusScript};
    })();
  `);
}

async function seekYouTubeMusic(searchParams) {
  if (!youtubeMusicWindow || youtubeMusicWindow.isDestroyed()) {
    return { ok: false, error: "YouTube Music is not open" };
  }
  if (!isControllableYouTubeMusicUrl(youtubeMusicWindow.webContents.getURL())) {
    return { ok: false, error: "Open YouTube Music to seek" };
  }

  const positionMs = Number(searchParams.get("position"));
  if (!Number.isFinite(positionMs)) {
    return { ok: false, error: "Invalid seek position" };
  }

  return youtubeMusicWindow.webContents.executeJavaScript(`
    (() => {
      const media = document.querySelector("video, audio");
      if (!media) return { ok: false, error: "No YouTube Music media found" };
      media.currentTime = Math.max(0, ${JSON.stringify(positionMs)} / 1000);
      return ${youtubeStatusScript};
    })();
  `);
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
    app.setAppUserModelId("com.forzadash.app");
    loadRuntimeEnv();
    applySavedSettingsToEnv();
    require(path.join(__dirname, "..", "server.cjs"));
    dashboardUrl = await startDashboardServer();
    createTray(dashboardUrl);
    createDashboardWindow(dashboardUrl);
  });
}

app.on("before-quit", () => {
  isQuitting = true;
  if (youtubeMusicWindow && !youtubeMusicWindow.isDestroyed()) {
    youtubeMusicWindow.destroy();
    youtubeMusicWindow = null;
    youtubeMusicLoaded = false;
  }
  webServer?.close();
});
