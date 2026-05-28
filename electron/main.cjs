const { app, BrowserWindow, Menu, Tray, shell, powerSaveBlocker } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const DEFAULT_DASHBOARD_PORT = 5173;
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

// Keep media playback stable when app windows lose focus (e.g. alt-tab to game).
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-background-media-suspend");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

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
  dashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  dashboardWindow.webContents.on("will-navigate", (event, url) => {
    if (url === dashboardUrl) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => {});
  });
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
  const repo = String(process.env.VITE_GITHUB_REPO || process.env.GITHUB_REPO || "").trim();
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
    };
  }
  await installYouTubePlayerEventBridge(youtubeMusicWindow);
  await installYouTubeAudioMode(youtubeMusicWindow);
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
  if (command === "toggle") sendYouTubeKey(window, ";");
  if (command === "next") sendYouTubeKey(window, "j");
  if (command === "previous") sendYouTubeKey(window, "k");
  if (command === "shuffle") sendYouTubeKey(window, "s");
  if (command === "repeat") sendYouTubeKey(window, "r");

  if (command === "play" || command === "pause") {
    await window.webContents.executeJavaScript(`
      (() => {
        const shouldPlay = ${JSON.stringify(command === "play")};
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
    app.setAppUserModelId("com.forzadash.app");
    if (!powerSaveBlocker.isStarted(mediaSuspendBlockerId ?? -1)) {
      mediaSuspendBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
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
