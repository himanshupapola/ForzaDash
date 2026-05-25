const dgram = require("node:dgram");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocketServer } = require("ws");

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

loadLocalEnv();

const UDP_HOST = "0.0.0.0";
// Forza sends raw UDP telemetry packets here
const UDP_PORT = envPort("VITE_FORZA_UDP_PORT", 1234);
// Forward the raw packets to another local port for tools like SimHub
const UDP_FORWARD_PORT = envPort("VITE_FORZA_UDP_FORWARD_PORT", 1235);
// The dashboard app connects to this WebSocket for parsed telemetry
const WS_PORT = envPort("VITE_TELEMETRY_WS_PORT", 17878);

let rawCount = 0;
let parsedCount = 0;
let lastSender = "-";
let latestTelemetry = null;
let lastFuelTelemetry = null;
const ASSUMED_FUEL_TANK_LITERS = 60;

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
    if (deltaFuel > 0 && deltaDistanceKm > 0) {
      const fractionPerKm = deltaFuel / deltaDistanceKm;
      const estimatedRangeKm = fuel / fractionPerKm;
      const fuelRateL100Km = fractionPerKm * ASSUMED_FUEL_TANK_LITERS * 100;
      derived = {
        ...derived,
        fuelRate: hasDirectFuelRate
          ? telemetry.fuelRate
          : Math.max(0, fuelRateL100Km),
        fuelRange: hasDirectFuelRange
          ? telemetry.fuelRange
          : Math.max(0, Math.round(estimatedRangeKm)),
      };
    }
  }

  lastFuelTelemetry = { fuel, distance };
  return derived;
}

function parseForzaPacket(data) {
  if (data.length < 324) return null;
  try {
    let offset = 0;
    const readInt = () => {
      const value = data.readInt32LE(offset);
      offset += 4;
      return value;
    };
    const readUInt = () => {
      const value = data.readUInt32LE(offset);
      offset += 4;
      return value;
    };
    const readFloat = () => {
      const value = data.readFloatLE(offset);
      offset += 4;
      return value;
    };
    const readUInt16 = () => {
      const value = data.readUInt16LE(offset);
      offset += 2;
      return value;
    };
    const readUInt8 = () => {
      const value = data.readUInt8(offset);
      offset += 1;
      return value;
    };
    const readInt8 = () => {
      const value = data.readInt8(offset);
      offset += 1;
      return value;
    };

    const isRaceOn = readInt();
    const timestampMs = readUInt();
    const engineMaxRpm = readFloat();
    const engineIdleRpm = readFloat();
    const currentEngineRpm = readFloat();
    const accelerationX = readFloat();
    const accelerationY = readFloat();
    const accelerationZ = readFloat();
    const velocityX = readFloat();
    const velocityY = readFloat();
    const velocityZ = readFloat();
    const angularVelocityX = readFloat();
    const angularVelocityY = readFloat();
    const angularVelocityZ = readFloat();
    const yaw = readFloat();
    const pitch = readFloat();
    const roll = readFloat();
    const normalizedSuspensionTravelFrontLeft = readFloat();
    const normalizedSuspensionTravelFrontRight = readFloat();
    const normalizedSuspensionTravelRearLeft = readFloat();
    const normalizedSuspensionTravelRearRight = readFloat();
    const tireSlipRatioFrontLeft = readFloat();
    const tireSlipRatioFrontRight = readFloat();
    const tireSlipRatioRearLeft = readFloat();
    const tireSlipRatioRearRight = readFloat();
    const wheelRotationSpeedFrontLeft = readFloat();
    const wheelRotationSpeedFrontRight = readFloat();
    const wheelRotationSpeedRearLeft = readFloat();
    const wheelRotationSpeedRearRight = readFloat();
    const wheelOnRumbleStripFrontLeft = readInt();
    const wheelOnRumbleStripFrontRight = readInt();
    const wheelOnRumbleStripRearLeft = readInt();
    const wheelOnRumbleStripRearRight = readInt();
    const wheelInPuddleFrontLeft = readInt();
    const wheelInPuddleFrontRight = readInt();
    const wheelInPuddleRearLeft = readInt();
    const wheelInPuddleRearRight = readInt();
    const surfaceRumbleFrontLeft = readFloat();
    const surfaceRumbleFrontRight = readFloat();
    const surfaceRumbleRearLeft = readFloat();
    const surfaceRumbleRearRight = readFloat();
    const tireSlipAngleFrontLeft = readFloat();
    const tireSlipAngleFrontRight = readFloat();
    const tireSlipAngleRearLeft = readFloat();
    const tireSlipAngleRearRight = readFloat();
    const tireCombinedSlipFrontLeft = readFloat();
    const tireCombinedSlipFrontRight = readFloat();
    const tireCombinedSlipRearLeft = readFloat();
    const tireCombinedSlipRearRight = readFloat();
    const suspensionTravelMetersFrontLeft = readFloat();
    const suspensionTravelMetersFrontRight = readFloat();
    const suspensionTravelMetersRearLeft = readFloat();
    const suspensionTravelMetersRearRight = readFloat();
    const carOrdinal = readInt();
    const carClass = readInt();
    const carPerformanceIndex = readInt();
    const drivetrainType = readInt();
    const numCylinders = readInt();
    const carGroup = readUInt();
    const smashableVelDiff = readFloat();
    const smashableMass = readFloat();
    const positionX = readFloat();
    const positionY = readFloat();
    const positionZ = readFloat();
    const speed = readFloat();
    const power = readFloat();
    const torque = readFloat();
    const tireTempFrontLeft = readFloat();
    const tireTempFrontRight = readFloat();
    const tireTempRearLeft = readFloat();
    const tireTempRearRight = readFloat();
    const boostPsi = readFloat();
    const fuel = readFloat();
    const distanceTraveled = readFloat();
    const bestLap = readFloat();
    const lastLap = readFloat();
    const currentLap = readFloat();
    const currentRaceTime = readFloat();
    const lapNumber = readUInt16();
    const racePosition = readUInt8();
    const accelInput = readUInt8();
    const brakeInput = readUInt8();
    const clutchInput = readUInt8();
    const handBrake = readUInt8();
    const gear = readUInt8();
    const steer = readInt8();
    const normalizedDrivingLine = readInt8();
    const normalizedAIBrakeDifference = readInt8();

    return {
      timestamp: Date.now(),
      rawPacketSize: data.length,
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
      carGroup,
      smashableVelDiff,
      smashableMass,
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

  if (url.pathname === "/api/hardware-temp") {
    readHardwareTemperature().then((result) => {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify(result));
    });
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
  if (latestTelemetry) ws.send(JSON.stringify(latestTelemetry));
});

const udpForwardSocket = dgram.createSocket("udp4");

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

const udp = dgram.createSocket("udp4");
udp.on("message", (message, remote) => {
  rawCount += 1;
  lastSender = `${remote.address}:${remote.port}`;

  udpForwardSocket.send(
    message,
    0,
    message.length,
    UDP_FORWARD_PORT,
    "127.0.0.1",
    (err) => {
      if (err) {
        console.warn("UDP forward failed", err);
      }
    },
  );

  const telemetry = parseForzaPacket(message);
  if (!telemetry) return;
  parsedCount += 1;
  const telemetryWithFuel = deriveFuelMetrics(telemetry);
  latestTelemetry = { ...telemetryWithFuel, parsedCount };
  broadcast(latestTelemetry);
});

telemetryServer.listen(WS_PORT, "127.0.0.1", () => {
  console.log(`Telemetry WebSocket listening on ws://127.0.0.1:${WS_PORT}`);
  console.log(`Hardware temp API listening on http://127.0.0.1:${WS_PORT}/api/hardware-temp`);
});

udp.bind(UDP_PORT, UDP_HOST, () => {
  console.log(`Forza UDP listening on ${UDP_HOST}:${UDP_PORT}`);
  console.log(`Forza UDP forwarding to 127.0.0.1:${UDP_FORWARD_PORT}`);
});
