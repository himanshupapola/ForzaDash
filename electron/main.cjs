const { app, BrowserWindow, Menu, Tray } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const DEFAULT_DASHBOARD_PORT = 5173;

let tray = null;
let webServer = null;
let dashboardUrl = null;
let dashboardWindow = null;

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
  const settings = readElectronLocalStorageSettings();
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
    webServer.listen(port, "127.0.0.1", () => {
      webServer.off("error", reject);
      resolve(`http://127.0.0.1:${port}/`);
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
  dashboardWindow.once("ready-to-show", () => {
    dashboardWindow.show();
    dashboardWindow.focus();
  });
  dashboardWindow.on("closed", () => {
    dashboardWindow = null;
  });

  return dashboardWindow;
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
  webServer?.close();
});
