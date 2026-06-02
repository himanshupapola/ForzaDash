const dgram = require("node:dgram");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { WebSocketServer } = require("ws");
const ForzaServer = require("forza-horizon").default;

let HID = null;
try {
  HID = require("node-hid");
} catch {
  HID = null;
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, ".env");
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

function envPort(name, fallback) {
  const port = Number(process.env[name]);
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

function envBool(name, fallback = false) {
  const value = String(process.env[name] ?? "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

loadLocalEnv();

const LOCAL_HOST = "127.0.0.1";
const LAN_ACCESS_ENABLED = envBool("VITE_LAN_ACCESS_ENABLED", true);
const SERVER_HOST = LAN_ACCESS_ENABLED ? "0.0.0.0" : LOCAL_HOST;
// Forza sends raw UDP telemetry packets here
const UDP_PORT = envPort("VITE_FORZA_UDP_PORT", 1234);
// Forward the raw packets to another local port for tools like SimHub
const UDP_FORWARDING_ENABLED = envBool("VITE_UDP_FORWARDING_ENABLED", false);
const UDP_FORWARD_PORT = envPort("VITE_FORZA_UDP_FORWARD_PORT", 1235);
const UDP_FORWARD_PORT_2 = envPort("VITE_FORZA_UDP_FORWARD_PORT_2", 1236);
const UDP_FORWARD_PORTS = UDP_FORWARDING_ENABLED
  ? [UDP_FORWARD_PORT, UDP_FORWARD_PORT_2]
  : [];
// The dashboard app connects to this WebSocket for parsed telemetry
const WS_PORT = envPort("VITE_TELEMETRY_WS_PORT", 17878);
const DASHBOARD_PORT = envPort("VITE_DASHBOARD_PORT", 5173);
const DEVELOPER_MODE = envBool("VITE_DEVELOPER_MODE", false);
const DIAGNOSTICS_ENABLED = envBool(
  "VITE_TELEMETRY_DIAGNOSTICS",
  DEVELOPER_MODE,
);
const DIAGNOSTICS_INTERVAL_MS = 1000;

function getDiagnosticsPath() {
  const basePath =
    process.env.PORTABLE_EXECUTABLE_DIR ||
    process.env.FORZADASH_LOG_DIR ||
    process.cwd();
  const logsDir = path.join(basePath, "logs");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, `forzadash-debug-${timestamp}.log`);
}

const diagnosticsPath = getDiagnosticsPath();
process.env.FORZADASH_DEBUG_LOG_PATH = diagnosticsPath;

function appendDiagnostic(message) {
  if (!DIAGNOSTICS_ENABLED) return;
  try {
    fs.appendFileSync(
      diagnosticsPath,
      `[${new Date().toISOString()}] ${message}\n`,
      "utf8",
    );
  } catch {}
}

function diagnosticJson(label, payload) {
  appendDiagnostic(`${label} ${JSON.stringify(payload)}`);
}

function describePortUse(name, port) {
  return `${name} ${SERVER_HOST}:${port}`;
}

function exitWithPortError(message) {
  const fullMessage = `ForzaDash port error: ${message}\nUpdate the port in Settings, then restart ForzaDash.`;
  console.error(`\n${fullMessage}\n`);
  if (process.versions.electron) {
    throw new Error(fullMessage);
  }
  process.exit(1);
}

function validatePortSettings() {
  if (DASHBOARD_PORT === WS_PORT) {
    exitWithPortError(
      `Dashboard port and Telemetry WebSocket port both use ${DASHBOARD_PORT}.`,
    );
  }

  if (DASHBOARD_PORT === UDP_PORT) {
    exitWithPortError(
      `Dashboard port and Forza UDP input port both use ${DASHBOARD_PORT}.`,
    );
  }

  if (WS_PORT === UDP_PORT) {
    exitWithPortError(
      `Telemetry WebSocket port and Forza UDP input port both use ${WS_PORT}.`,
    );
  }

  if (!UDP_FORWARDING_ENABLED) return;

  const uniqueForwardPorts = new Set(UDP_FORWARD_PORTS);
  if (uniqueForwardPorts.size !== UDP_FORWARD_PORTS.length) {
    exitWithPortError(
      `UDP forward ports must be different. Both are set to ${UDP_FORWARD_PORT}.`,
    );
  }

  for (const forwardPort of UDP_FORWARD_PORTS) {
    if (forwardPort === UDP_PORT) {
      exitWithPortError(
        `UDP forward port ${forwardPort} matches the Forza UDP input port. This would forward packets back into ForzaDash.`,
      );
    }

    if (forwardPort === DASHBOARD_PORT) {
      exitWithPortError(
        `UDP forward port ${forwardPort} matches the Dashboard port.`,
      );
    }

    if (forwardPort === WS_PORT) {
      exitWithPortError(
        `UDP forward port ${forwardPort} matches the Telemetry WebSocket port.`,
      );
    }
  }
}

validatePortSettings();

let rawCount = 0;
let parsedCount = 0;
let lastSender = "-";
let latestTelemetry = null;
let lastFuelTelemetry = null;
let smoothedFuelRate = null;
let smoothedFuelRange = null;
const ASSUMED_FUEL_TANK_LITERS = 60;
const G29_LEDS_ENABLED = process.env.VITE_G29_LEDS_ENABLED !== "false";
const G29_CONNECT_BLINK_ENABLED =
  process.env.VITE_G29_CONNECT_BLINK_ENABLED !== "false";
const G29_VENDOR_ID = 1133;
const G29_PRODUCT_ID = 49743;
const G29_ALL_LEDS = 31;
const G29_NO_LEDS = 0;
let g29Device = null;
let g29LastLedSetting = null;
let g29LastWriteAt = 0;
let g29UnavailableLogged = false;
let g29ConnectBlinkActive = false;
let g29NextConnectAttemptAt = 0;
const G29_RECONNECT_INTERVAL_MS = 5000;
const TELEMETRY_BROADCAST_INTERVAL_MS = 33;
let telemetryBroadcastTimer = null;
let diagnosticsLastRawCount = 0;
let diagnosticsLastParsedCount = 0;
let diagnosticsBroadcastCount = 0;
let diagnosticsSkippedClientCount = 0;
let diagnosticsHidScanCount = 0;
let diagnosticsHidScanMaxMs = 0;
let diagnosticsPacketProcessMaxMs = 0;
let diagnosticsExpectedTickAt = Date.now() + DIAGNOSTICS_INTERVAL_MS;
let diagnosticsLastCpuUsage = process.cpuUsage();
let diagnosticsLastCpuAt = Date.now();

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function findG29Path() {
  if (!HID) return "";

  const startedAt = Date.now();
  const devices = HID.devices();
  const elapsedMs = Date.now() - startedAt;
  diagnosticsHidScanCount += 1;
  diagnosticsHidScanMaxMs = Math.max(diagnosticsHidScanMaxMs, elapsedMs);
  const wheel = devices.find(
    (device) =>
      device.vendorId === G29_VENDOR_ID &&
      (device.productId === G29_PRODUCT_ID ||
        device.product === "G29 Driving Force Racing Wheel") &&
      (device.interface === 0 || device.usagePage === 1),
  );

  return wheel?.path || "";
}

function connectG29Leds() {
  if (!G29_LEDS_ENABLED || !HID || g29Device) return g29Device;

  const now = Date.now();
  if (now < g29NextConnectAttemptAt) return null;
  g29NextConnectAttemptAt = now + G29_RECONNECT_INTERVAL_MS;

  const devicePath = findG29Path();
  if (!devicePath) {
    if (!g29UnavailableLogged) {
      console.warn("Logitech G29 LEDs unavailable: wheel not found");
      g29UnavailableLogged = true;
    }
    return null;
  }

  try {
    g29Device = new HID.HID(devicePath);
    g29NextConnectAttemptAt = 0;
    g29UnavailableLogged = false;
    console.log("Logitech G29 LED output connected");
    if (G29_CONNECT_BLINK_ENABLED) {
      startG29ConnectBlink();
    }
  } catch (error) {
    if (!g29UnavailableLogged) {
      console.warn("Logitech G29 LEDs unavailable:", error.message);
      g29UnavailableLogged = true;
    }
    g29Device = null;
  }

  return g29Device;
}

function writeG29Leds(setting) {
  if (!g29Device) return;
  g29Device.write([0x00, 0xf8, 0x12, setting, 0x00, 0x00, 0x00, 0x01]);
  g29LastLedSetting = setting;
  g29LastWriteAt = Date.now();
}

function startG29ConnectBlink() {
  g29ConnectBlinkActive = true;
  let step = 0;
  const maxSteps = 6;
  let timer = null;

  const runStep = () => {
    try {
      writeG29Leds(step % 2 === 0 ? G29_ALL_LEDS : G29_NO_LEDS);
    } catch (error) {
      console.warn("Logitech G29 connect blink failed:", error.message);
      if (timer) clearInterval(timer);
      g29ConnectBlinkActive = false;
      return;
    }

    step += 1;
    if (step >= maxSteps) {
      if (timer) clearInterval(timer);
      g29ConnectBlinkActive = false;
    }
  };

  setTimeout(() => {
    runStep();
    timer = setInterval(runStep, 1000);
  }, 2000);
}

function setG29Leds(setting) {
  if (!G29_LEDS_ENABLED || !HID) return;
  if (g29ConnectBlinkActive) return;

  const now = Date.now();
  if (setting === g29LastLedSetting && now - g29LastWriteAt < 100) return;
  if (now - g29LastWriteAt < 30) return;

  const device = connectG29Leds();
  if (!device) return;

  try {
    writeG29Leds(setting);
  } catch (error) {
    console.warn("Logitech G29 LED write failed:", error.message);
    try {
      g29Device?.close();
    } catch {}
    g29Device = null;
    g29LastLedSetting = null;
    g29ConnectBlinkActive = false;
  }
}

function ledSettingFromRpmRatio(ratio) {
  if (ratio >= 0.88) return 31;
  if (ratio >= 0.72) return 15;
  if (ratio >= 0.54) return 7;
  if (ratio >= 0.36) return 3;
  if (ratio >= 0.18) return 1;
  return 0;
}

function updateG29Leds(telemetry) {
  const rpm = Number(telemetry.rpm) || 0;
  const maxRpm = Math.max(Number(telemetry.maxRpm) || 0, 1);
  const rpmRatio = clamp(rpm / maxRpm, 0, 1);

  setG29Leds(ledSettingFromRpmRatio(rpmRatio));
}

function deriveFuelMetrics(telemetry) {
  const fuel =
    typeof telemetry.fuel === "number" && Number.isFinite(telemetry.fuel)
      ? telemetry.fuel
      : null;
  const distance =
    typeof telemetry.distanceTraveled === "number" &&
    Number.isFinite(telemetry.distanceTraveled)
      ? telemetry.distanceTraveled
      : null;

  if (fuel == null || distance == null) {
    return telemetry;
  }

  const hasDirectFuelRate = telemetry.fuelRate != null;
  const hasDirectFuelRange = telemetry.fuelRange != null;
  let derived = { ...telemetry };
  if (
    lastFuelTelemetry &&
    typeof lastFuelTelemetry.fuel === "number" &&
    typeof lastFuelTelemetry.distance === "number"
  ) {
    const deltaFuel = lastFuelTelemetry.fuel - fuel;
    const deltaDistanceKm = (distance - lastFuelTelemetry.distance) / 1000;
    if (deltaFuel > 0 && deltaDistanceKm > 0.01) {
      const fractionPerKm = deltaFuel / deltaDistanceKm;
      const estimatedRangeKm = clamp(fuel / fractionPerKm, 0, 999);
      const fuelRateL100Km = clamp(
        fractionPerKm * ASSUMED_FUEL_TANK_LITERS * 100,
        0,
        250,
      );
      smoothedFuelRate =
        smoothedFuelRate == null
          ? fuelRateL100Km
          : smoothedFuelRate + (fuelRateL100Km - smoothedFuelRate) * 0.08;
      smoothedFuelRange =
        smoothedFuelRange == null
          ? estimatedRangeKm
          : smoothedFuelRange + (estimatedRangeKm - smoothedFuelRange) * 0.06;
      derived = {
        ...derived,
        fuelRate: hasDirectFuelRate
          ? telemetry.fuelRate
          : Math.max(0, smoothedFuelRate),
        fuelRange: hasDirectFuelRange
          ? telemetry.fuelRange
          : Math.max(0, Math.round(smoothedFuelRange)),
      };
    } else if (smoothedFuelRate != null || smoothedFuelRange != null) {
      derived = {
        ...derived,
        fuelRate: hasDirectFuelRate
          ? telemetry.fuelRate
          : smoothedFuelRate ?? telemetry.fuelRate,
        fuelRange: hasDirectFuelRange
          ? telemetry.fuelRange
          : smoothedFuelRange == null
            ? telemetry.fuelRange
            : Math.round(smoothedFuelRange),
      };
    }
  }

  lastFuelTelemetry = { fuel, distance };
  return derived;
}

function normalizeForzaTelemetry(parsed, rawPacketSize = 0) {
  if (!parsed || typeof parsed !== "object") return null;
  try {
    const {
      IsRaceOn: isRaceOn,
      TimestampMS: timestampMs,
      EngineMaxRpm: engineMaxRpm,
      EngineIdleRpm: engineIdleRpm,
      CurrentEngineRpm: currentEngineRpm,
      AccelerationX: accelerationX,
      AccelerationY: accelerationY,
      AccelerationZ: accelerationZ,
      VelocityX: velocityX,
      VelocityY: velocityY,
      VelocityZ: velocityZ,
      AngularVelocityX: angularVelocityX,
      AngularVelocityY: angularVelocityY,
      AngularVelocityZ: angularVelocityZ,
      Yaw: yaw,
      Pitch: pitch,
      Roll: roll,
      NormalizedSuspensionTravelFrontLeft: normalizedSuspensionTravelFrontLeft,
      NormalizedSuspensionTravelFrontRight: normalizedSuspensionTravelFrontRight,
      NormalizedSuspensionTravelRearLeft: normalizedSuspensionTravelRearLeft,
      NormalizedSuspensionTravelRearRight: normalizedSuspensionTravelRearRight,
      TireSlipRatioFrontLeft: tireSlipRatioFrontLeft,
      TireSlipRatioFrontRight: tireSlipRatioFrontRight,
      TireSlipRatioRearLeft: tireSlipRatioRearLeft,
      TireSlipRatioRearRight: tireSlipRatioRearRight,
      WheelRotationSpeedFrontLeft: wheelRotationSpeedFrontLeft,
      WheelRotationSpeedFrontRight: wheelRotationSpeedFrontRight,
      WheelRotationSpeedRearLeft: wheelRotationSpeedRearLeft,
      WheelRotationSpeedRearRight: wheelRotationSpeedRearRight,
      WheelOnRumbleStripFrontLeft: wheelOnRumbleStripFrontLeft,
      WheelOnRumbleStripFrontRight: wheelOnRumbleStripFrontRight,
      WheelOnRumbleStripRearLeft: wheelOnRumbleStripRearLeft,
      WheelOnRumbleStripRearRight: wheelOnRumbleStripRearRight,
      WheelInPuddleDepthFrontLeft: wheelInPuddleFrontLeft,
      WheelInPuddleDepthFrontRight: wheelInPuddleFrontRight,
      WheelInPuddleDepthRearLeft: wheelInPuddleRearLeft,
      WheelInPuddleDepthRearRight: wheelInPuddleRearRight,
      SurfaceRumbleFrontLeft: surfaceRumbleFrontLeft,
      SurfaceRumbleFrontRight: surfaceRumbleFrontRight,
      SurfaceRumbleRearLeft: surfaceRumbleRearLeft,
      SurfaceRumbleRearRight: surfaceRumbleRearRight,
      TireSlipAngleFrontLeft: tireSlipAngleFrontLeft,
      TireSlipAngleFrontRight: tireSlipAngleFrontRight,
      TireSlipAngleRearLeft: tireSlipAngleRearLeft,
      TireSlipAngleRearRight: tireSlipAngleRearRight,
      TireCombinedSlipFrontLeft: tireCombinedSlipFrontLeft,
      TireCombinedSlipFrontRight: tireCombinedSlipFrontRight,
      TireCombinedSlipRearLeft: tireCombinedSlipRearLeft,
      TireCombinedSlipRearRight: tireCombinedSlipRearRight,
      SuspensionTravelMetersFrontLeft: suspensionTravelMetersFrontLeft,
      SuspensionTravelMetersFrontRight: suspensionTravelMetersFrontRight,
      SuspensionTravelMetersRearLeft: suspensionTravelMetersRearLeft,
      SuspensionTravelMetersRearRight: suspensionTravelMetersRearRight,
      CarOrdinal: carOrdinal,
      CarClass: carClass,
      CarPerformanceIndex: carPerformanceIndex,
      DrivetrainType: drivetrainType,
      NumCylinders: numCylinders,
      PositionX: positionX,
      PositionY: positionY,
      PositionZ: positionZ,
      Speed: speed,
      Power: power,
      Torque: torque,
      TireTempFrontLeft: tireTempFrontLeft,
      TireTempFrontRight: tireTempFrontRight,
      TireTempRearLeft: tireTempRearLeft,
      TireTempRearRight: tireTempRearRight,
      Boost: boostPsi,
      Fuel: fuel,
      DistanceTraveled: distanceTraveled,
      BestLap: bestLap,
      LastLap: lastLap,
      CurrentLap: currentLap,
      CurrentRaceTime: currentRaceTime,
      LapNumber: lapNumber,
      RacePosition: racePosition,
      Accel: accelInput,
      Brake: brakeInput,
      Clutch: clutchInput,
      HandBrake: handBrake,
      Gear: gear,
      Steer: steer,
      NormalizedDrivingLine: normalizedDrivingLine,
      NormalizedAIBrakeDifference: normalizedAIBrakeDifference,
    } = parsed;

    return {
      timestamp: Date.now(),
      rawPacketSize,
      rawCount,
      parsedCount,
      lastSender,
      status: "ONLINE",
      isRaceOn,
      timestampMs,
      engineMaxRpm,
      engineIdleRpm,
      rpm: Math.max(0, Math.round(currentEngineRpm || 0)),
      maxRpm: Math.max(7000, Math.round(engineMaxRpm || 10000)),
      accelerationX,
      accelerationY,
      accelerationZ,
      velocityX,
      velocityY,
      velocityZ,
      angularVelocityX,
      angularVelocityY,
      angularVelocityZ,
      yaw,
      pitch,
      roll,
      normalizedSuspensionTravelFrontLeft,
      normalizedSuspensionTravelFrontRight,
      normalizedSuspensionTravelRearLeft,
      normalizedSuspensionTravelRearRight,
      suspensionTravelMetersFrontLeft,
      suspensionTravelMetersFrontRight,
      suspensionTravelMetersRearLeft,
      suspensionTravelMetersRearRight,
      tireSlipRatioFrontLeft,
      tireSlipRatioFrontRight,
      tireSlipRatioRearLeft,
      tireSlipRatioRearRight,
      tireSlipAngleFrontLeft,
      tireSlipAngleFrontRight,
      tireSlipAngleRearLeft,
      tireSlipAngleRearRight,
      tireCombinedSlipFrontLeft,
      tireCombinedSlipFrontRight,
      tireCombinedSlipRearLeft,
      tireCombinedSlipRearRight,
      tireTempFrontLeft,
      tireTempFrontRight,
      tireTempRearLeft,
      tireTempRearRight,
      wheelRotationSpeedFrontLeft,
      wheelRotationSpeedFrontRight,
      wheelRotationSpeedRearLeft,
      wheelRotationSpeedRearRight,
      wheelOnRumbleStripFrontLeft,
      wheelOnRumbleStripFrontRight,
      wheelOnRumbleStripRearLeft,
      wheelOnRumbleStripRearRight,
      wheelInPuddleFrontLeft,
      wheelInPuddleFrontRight,
      wheelInPuddleRearLeft,
      wheelInPuddleRearRight,
      surfaceRumbleFrontLeft,
      surfaceRumbleFrontRight,
      surfaceRumbleRearLeft,
      surfaceRumbleRearRight,
      carOrdinal,
      carClass,
      carPerformanceIndex,
      drivetrainType,
      numCylinders,
      carGroup: null,
      smashableVelDiff: null,
      smashableMass: null,
      positionX,
      positionY,
      positionZ,
      speedMps: speed,
      speedKmh: Math.max(0, speed * 3.6),
      speedMph: Math.max(0, speed * 3.6 * 0.621371),
      powerW: power,
      powerHp: Math.max(0, power / 745.7),
      powerPs: Math.max(0, power / 735.49875),
      torqueNm: torque,
      boostPsi,
      boostBar: boostPsi / 14.5038,
      fuel,
      fuelPercent: Number.isFinite(fuel)
        ? Math.round(Math.min(Math.max(fuel, 0), 1) * 100)
        : null,
      distanceTraveled,
      bestLap,
      lastLap,
      currentLap,
      currentRaceTime,
      lapNumber,
      racePosition,
      throttle: accelInput,
      brake: brakeInput,
      clutch: clutchInput,
      handBrake,
      gear,
      steer,
      normalizedDrivingLine,
      normalizedAIBrakeDifference,
    };
  } catch {
    return null;
  }
}

const telemetryServer = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${WS_PORT}`);

  if (url.pathname === "/api/debug-log" && request.method === "GET") {
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        ok: true,
        developerMode: DIAGNOSTICS_ENABLED,
        logFile: diagnosticsPath,
      }),
    );
    return;
  }

  response.writeHead(404, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify({ error: "Not found" }));
});

const wss = new WebSocketServer({ server: telemetryServer });
wss.on("connection", (ws) => {
  diagnosticJson("WS_CLIENT_CONNECTED", { clients: wss.clients.size });
  if (latestTelemetry) ws.send(JSON.stringify(latestTelemetry));
  ws.on("close", () => {
    diagnosticJson("WS_CLIENT_DISCONNECTED", {
      clients: Math.max(wss.clients.size - 1, 0),
    });
  });
});

const udpForwardSocket = UDP_FORWARDING_ENABLED
  ? dgram.createSocket("udp4")
  : null;

function handleListenError(serviceName, port, error) {
  if (error?.code === "EADDRINUSE") {
    exitWithPortError(
      `${describePortUse(serviceName, port)} is already in use by another app.`,
    );
  }

  if (error?.code === "EACCES") {
    exitWithPortError(
      `${describePortUse(serviceName, port)} cannot be opened because permission was denied.`,
    );
  }

  console.error(`${serviceName} failed on ${LOCAL_HOST}:${port}`, error);
  process.exit(1);
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  diagnosticsBroadcastCount += 1;
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.bufferedAmount === 0) {
      client.send(message);
    } else if (client.readyState === 1) {
      diagnosticsSkippedClientCount += 1;
    }
  }
}

function scheduleTelemetryBroadcast() {
  if (telemetryBroadcastTimer) return;
  telemetryBroadcastTimer = setTimeout(() => {
    telemetryBroadcastTimer = null;
    if (latestTelemetry) broadcast(latestTelemetry);
  }, TELEMETRY_BROADCAST_INTERVAL_MS);
}

const forzaServer = new ForzaServer(UDP_PORT);
forzaServer.on("message", (message, remote) => {
  rawCount += 1;
  lastSender = `${remote.address}:${remote.port}`;

  if (udpForwardSocket) {
    for (const forwardPort of UDP_FORWARD_PORTS) {
      udpForwardSocket.send(
        message,
        0,
        message.length,
        forwardPort,
        "127.0.0.1",
        (err) => {
          if (err) {
            console.warn(`UDP forward to ${forwardPort} failed`, err);
          }
        },
      );
    }
  }
});

forzaServer.on("data", (parsedData) => {
  const startedAt = Date.now();
  const telemetry = normalizeForzaTelemetry(parsedData);
  if (!telemetry) return;
  parsedCount += 1;
  const telemetryWithFuel = deriveFuelMetrics(telemetry);
  latestTelemetry = { ...telemetryWithFuel, parsedCount };
  updateG29Leds(latestTelemetry);
  scheduleTelemetryBroadcast();
  diagnosticsPacketProcessMaxMs = Math.max(
    diagnosticsPacketProcessMaxMs,
    Date.now() - startedAt,
  );
});

diagnosticJson("ForzaDash debug log started", {
  logFile: diagnosticsPath,
  bindHost: SERVER_HOST,
  udpBindHost: "forza-horizon",
  udpPort: UDP_PORT,
  wsPort: WS_PORT,
  uiBroadcastFps: Math.round(1000 / TELEMETRY_BROADCAST_INTERVAL_MS),
  udpForwarding: UDP_FORWARDING_ENABLED,
  parser: "forza-horizon",
  developerMode: DEVELOPER_MODE,
  g29Enabled: G29_LEDS_ENABLED,
  g29BlinkEnabled: G29_CONNECT_BLINK_ENABLED,
  platform: process.platform,
  node: process.version,
  cpu: os.cpus()?.[0]?.model || "unknown",
  ramGb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
});
if (DIAGNOSTICS_ENABLED) {
  console.log(`Telemetry diagnostics: ${diagnosticsPath}`);
}

setInterval(() => {
  const now = Date.now();
  const elapsedMs = Math.max(now - diagnosticsExpectedTickAt + DIAGNOSTICS_INTERVAL_MS, 1);
  const rawDelta = rawCount - diagnosticsLastRawCount;
  const parsedDelta = parsedCount - diagnosticsLastParsedCount;
  const broadcastDelta = diagnosticsBroadcastCount;
  const lagMs = Math.max(0, now - diagnosticsExpectedTickAt);
  const cpuUsage = process.cpuUsage();
  const cpuDeltaMicros =
    cpuUsage.user +
    cpuUsage.system -
    diagnosticsLastCpuUsage.user -
    diagnosticsLastCpuUsage.system;
  const cpuElapsedMicros = Math.max((now - diagnosticsLastCpuAt) * 1000, 1);
  const cpuPercent = Math.max(0, Math.round((cpuDeltaMicros / cpuElapsedMicros) * 100));
  const memory = process.memoryUsage();
  let maxBufferedBytes = 0;
  for (const client of wss.clients) {
    maxBufferedBytes = Math.max(maxBufferedBytes, client.bufferedAmount || 0);
  }
  diagnosticJson("HEALTH", {
    rawPps: Number(((rawDelta * 1000) / elapsedMs).toFixed(1)),
    parsedPps: Number(((parsedDelta * 1000) / elapsedMs).toFixed(1)),
    droppedPps: Number(((diagnosticsSkippedClientCount * 1000) / elapsedMs).toFixed(1)),
    broadcastPps: Number(((broadcastDelta * 1000) / elapsedMs).toFixed(1)),
    rawCount,
    parsedCount,
    droppedPacketCount: diagnosticsSkippedClientCount,
    broadcastCount: diagnosticsBroadcastCount,
    lastSender,
    wsClients: wss.clients.size,
    pendingTelemetry: Boolean(telemetryBroadcastTimer),
    hasLatestRawPacket: rawCount > 0,
    latestTelemetryAgeMs: latestTelemetry?.timestamp ? now - latestTelemetry.timestamp : null,
    rssMb: Math.round(memory.rss / 1024 / 1024),
    heapMb: Math.round(memory.heapUsed / 1024 / 1024),
    cpuPercent,
    uiBroadcastFps: Math.round(1000 / TELEMETRY_BROADCAST_INTERVAL_MS),
    udpForwarding: UDP_FORWARDING_ENABLED,
    g29Enabled: G29_LEDS_ENABLED,
    hidScans: diagnosticsHidScanCount,
    maxHidScanMs: diagnosticsHidScanMaxMs,
    maxPacketMs: diagnosticsPacketProcessMaxMs,
    maxBufferedBytes,
    eventLoopLagMs: lagMs,
  });
  diagnosticsLastRawCount = rawCount;
  diagnosticsLastParsedCount = parsedCount;
  diagnosticsLastCpuUsage = cpuUsage;
  diagnosticsLastCpuAt = now;
  diagnosticsBroadcastCount = 0;
  diagnosticsSkippedClientCount = 0;
  diagnosticsHidScanCount = 0;
  diagnosticsHidScanMaxMs = 0;
  diagnosticsPacketProcessMaxMs = 0;
  diagnosticsExpectedTickAt = now + DIAGNOSTICS_INTERVAL_MS;
}, DIAGNOSTICS_INTERVAL_MS);

telemetryServer.on("error", (error) =>
  handleListenError("Telemetry WebSocket port", WS_PORT, error),
);

forzaServer.on("error", (error) =>
  handleListenError("Forza UDP input port", UDP_PORT, error),
);

telemetryServer.listen(WS_PORT, SERVER_HOST, () => {
  console.log(`Telemetry WebSocket listening on ws://${SERVER_HOST}:${WS_PORT}`);
  appendDiagnostic(`Telemetry WebSocket listening on ws://${SERVER_HOST}:${WS_PORT}`);
  appendDiagnostic(`Debug log path API listening on http://127.0.0.1:${WS_PORT}/api/debug-log`);
});

forzaServer.on("listening", () => {
  console.log(`Forza UDP listening on port ${UDP_PORT} via forza-horizon`);
  appendDiagnostic(`Forza UDP listening on port ${UDP_PORT} via forza-horizon`);
  if (UDP_FORWARDING_ENABLED) {
    const forwardMessage = `Forza UDP forwarding to ${UDP_FORWARD_PORTS.map((port) => `127.0.0.1:${port}`).join(", ")}`;
    console.log(forwardMessage);
    appendDiagnostic(forwardMessage);
  } else {
    console.log("Forza UDP forwarding disabled");
    appendDiagnostic("Forza UDP forwarding disabled");
  }
});

forzaServer.bind();
