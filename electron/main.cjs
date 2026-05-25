const { app, BrowserWindow, ipcMain } = require("electron");
const dgram = require("node:dgram");
const path = require("node:path");

const UDP_HOST = "0.0.0.0";
const UDP_PORT = 1234;

let mainWindow;
let udpSocket;
let rawCount = 0;
let parsedCount = 0;
let lastSender = "-";
let latestTelemetry = null;
let lastFuelTelemetry = null;
const ASSUMED_FUEL_TANK_LITERS = 60;

function readFloat(data, offset) {
  return data.readFloatLE(offset);
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

function startUdp() {
  udpSocket = dgram.createSocket("udp4");
  udpSocket.on("message", (message, remote) => {
    rawCount += 1;
    lastSender = `${remote.address}:${remote.port}`;
    const telemetry = parseForzaPacket(message);
    if (!telemetry) return;
    parsedCount += 1;
    const telemetryWithFuel = deriveFuelMetrics(telemetry);
    latestTelemetry = { ...telemetryWithFuel, parsedCount };
    mainWindow?.webContents.send("telemetry:update", latestTelemetry);
  });
  udpSocket.bind(UDP_PORT, UDP_HOST);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: "#02070b",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "..", "onyx_icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL("http://127.0.0.1:5173");
}

app.whenReady().then(() => {
  ipcMain.handle("telemetry:getLatest", () => latestTelemetry);
  startUdp();
  createWindow();
});

app.on("window-all-closed", () => {
  udpSocket?.close();
  if (process.platform !== "darwin") app.quit();
});
