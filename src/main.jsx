import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Car,
  Heart,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Wifi,
  Youtube,
} from "lucide-react";
import forzaLogo from "./assets/forza-logo.png";
import carTopView from "./assets/car.png";
import suspensionImage from "./assets/susp.png";
import spotifyLogo from "./assets/spotify.png";
import {
  completeSpotifyLogin,
  ensureSpotifyDevice,
  getPlaybackState,
  hasSpotifyLogin,
  isSpotifyConfigured,
  loginSpotify,
  logoutSpotify,
  seekSpotify,
  setSpotifyRepeat,
  setSpotifyShuffle,
  spotifyCommand,
} from "./spotify";
import "./styles.css";
import speedometerBg from "../spm.png";

const fallbackTelemetry = {
  status: "WAITING",
  speedKmh: 0,
  rpm: 0,
  maxRpm: 10000,
  gear: 0,
  powerHp: 0,
  torqueNm: 0,
  boostBar: 0,
  throttle: 0,
  brake: 0,
  clutch: 0,
  accelerationX: 0,
  accelerationY: 0,
  accelerationZ: 0,
  rawCount: 0,
  parsedCount: 0,
  lastSender: "-",
};

const SETTINGS_KEY = "forzadash_settings";
const MUSIC_PROVIDER_KEY = "forzadash_music_provider";
const YOUTUBE_VOLUME_KEY = "forzadash_youtube_volume";
const YOUTUBE_MUTED_KEY = "forzadash_youtube_muted";
const DEFAULT_SETTINGS = {
  weatherRegion: import.meta.env.VITE_WEATHER_REGION || "Bageshwar",
  dashboardPort: import.meta.env.VITE_DASHBOARD_PORT || "5173",
  forzaUdpPort: import.meta.env.VITE_FORZA_UDP_PORT || "1234",
  forzaUdpForwardPort: import.meta.env.VITE_FORZA_UDP_FORWARD_PORT || "1235",
  forzaUdpForwardPort2: import.meta.env.VITE_FORZA_UDP_FORWARD_PORT_2 || "1236",
  telemetryWsPort: import.meta.env.VITE_TELEMETRY_WS_PORT || "17878",
  spotifyClientId: import.meta.env.VITE_SPOTIFY_CLIENT_ID || "",
  demoDriveMode: false,
  backgroundColor: import.meta.env.VITE_BACKGROUND_COLOR || "#000204",
};

function createDemoTelemetry(frame) {
  const t = frame / 10;
  const speedKmh = clamp(
    82 + Math.sin(t * 0.34) * 46 + Math.sin(t * 0.1) * 18,
    0,
    248,
  );
  const maxRpm = 8600;
  const rpm = clamp(1500 + speedKmh * 36 + Math.sin(t * 1.45) * 520, 900, maxRpm);
  const gear = clamp(Math.floor(speedKmh / 34) + 1, 1, 7);
  const throttle = clamp(46 + Math.sin(t * 1.1) * 36, 4, 100);
  const brake = clamp(Math.sin(t * 0.7 + 0.8) > 0.82 ? 22 : 0, 0, 100);
  const clutch = clamp(Math.sin(t * 0.45 + 1.7) * 8 + 6, 0, 32);
  const boostBar = clamp(0.2 + throttle * 0.015 + Math.sin(t * 2.1) * 0.09, 0, 2);
  const powerHp = clamp(95 + (rpm / maxRpm) * 510 + throttle * 1.15, 70, 760);
  const torqueNm = clamp(170 + (rpm / maxRpm) * 570 + throttle * 1.55, 120, 980);

  return {
    ...fallbackTelemetry,
    status: "DEMO",
    speedKmh,
    rpm,
    maxRpm,
    gear,
    powerHp,
    torqueNm,
    boostBar,
    throttle,
    brake,
    clutch,
    steer: Math.round(Math.sin(t * 0.8) * 68),
    accelerationX: Math.sin(t * 1.22) * 3.3,
    accelerationY: Math.sin(t * 0.4) * 0.9,
    accelerationZ: Math.cos(t * 1.02) * 2.1,
    rawCount: frame,
    parsedCount: frame,
    lastSender: "DEMO",
  };
}

function readSettings() {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") || {}),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }).catch(() => {});
  window.dispatchEvent(
    new CustomEvent("forzadash:settings", { detail: settings }),
  );
}

async function readJsonResponse(response, fallbackError = "Request failed") {
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : null;
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || fallbackError);
  }
  return data || { ok: true };
}

function useSettings() {
  const [settings, setSettings] = useState(readSettings);

  useEffect(() => {
    function sync(event) {
      setSettings(event.detail || readSettings());
    }
    window.addEventListener("forzadash:settings", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("forzadash:settings", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return settings;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function number(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

function formatGear(rawGear) {
  if (rawGear === 0) return "R";
  if (Number.isFinite(rawGear)) return rawGear;
  return "N";
}

function normalizeGear(rawGear, previousGear = 1) {
  const gear = Number(rawGear);
  if (!Number.isFinite(gear)) return previousGear;
  if (gear < 0 || gear > 10) return previousGear;
  return Math.round(gear);
}

function formatValue(value, unit = "", digits = 0) {
  if (value == null || value === "") {
    return "0";
  }
  if (typeof value === "number") {
    return `${value.toFixed(digits)}${unit}`;
  }
  const normalized = String(value).trim();
  if (/^[-+]?\d*\.?\d+$/.test(normalized)) {
    return `${Number(normalized).toFixed(digits)}${unit}`;
  }
  return normalized;
}

function normalizeColor(value, fallback = DEFAULT_SETTINGS.backgroundColor) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}
function readStoredYouTubeVolume() {
  const value = Number(localStorage.getItem(YOUTUBE_VOLUME_KEY));
  return Number.isFinite(value) ? clamp(value, 0, 100) : 100;
}
function readStoredYouTubeMuted() {
  return localStorage.getItem(YOUTUBE_MUTED_KEY) === "true";
}

function getServerHostname() {
  return "127.0.0.1";
}

function getTelemetryHttpBase(port) {
  return `http://${getServerHostname()}:${port}`;
}

function getTelemetryWsUrl(port) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${getServerHostname()}:${port}`;
}

function getTelemetryValue(telemetry, keys, fallback = null) {
  for (const key of keys) {
    if (telemetry?.[key] != null) {
      return telemetry[key];
    }
  }
  return fallback;
}

function getTelemetryArray(telemetry, keys, fallback = []) {
  const value = getTelemetryValue(telemetry, keys, null);
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return value.split(/[,;\s]+/).filter(Boolean);
  return fallback;
}

const SMOOTH_TELEMETRY_KEYS = [
  "speedKmh",
  "speedMph",
  "rpm",
  "powerHp",
  "powerPs",
  "torqueNm",
  "boostPsi",
  "boostBar",
  "throttle",
  "brake",
  "clutch",
  "steer",
  "accelerationX",
  "accelerationY",
  "accelerationZ",
  "velocityX",
  "velocityY",
  "velocityZ",
];

const SMOOTH_RATE_LIMITS = {
  speedKmh: 85,
  speedMph: 55,
  rpm: 4200,
  powerHp: 900,
  powerPs: 900,
  torqueNm: 1400,
  boostPsi: 18,
  boostBar: 1.2,
  throttle: 180,
  brake: 220,
  clutch: 220,
  steer: 420,
  accelerationX: 22,
  accelerationY: 22,
  accelerationZ: 22,
  velocityX: 40,
  velocityY: 40,
  velocityZ: 40,
};

function smoothValue(current, target, dt, key, responsiveness = 5.5) {
  if (!Number.isFinite(target)) return current;
  if (!Number.isFinite(current)) return target;
  const alpha = 1 - Math.exp(-responsiveness * dt);
  const eased = current + (target - current) * alpha;
  const maxDelta = (SMOOTH_RATE_LIMITS[key] ?? 9999) * dt;
  return current + clamp(eased - current, -maxDelta, maxDelta);
}

function useSmoothedTelemetry(targetTelemetry) {
  const [displayTelemetry, setDisplayTelemetry] = useState(targetTelemetry);
  const displayRef = useRef(targetTelemetry);
  const targetRef = useRef(targetTelemetry);

  useEffect(() => {
    targetRef.current = targetTelemetry;
  }, [targetTelemetry]);

  useEffect(() => {
    let frameId = 0;
    let lastFrame = performance.now();

    function tick(now) {
      const dt = clamp((now - lastFrame) / 1000, 0, 0.08);
      lastFrame = now;

      const target = targetRef.current;
      const next = { ...target };
      let changed = false;

      for (const key of SMOOTH_TELEMETRY_KEYS) {
        const currentValue = displayRef.current?.[key];
        const targetValue = target?.[key];
        const smoothed = smoothValue(
          Number(currentValue),
          Number(targetValue),
          dt,
          key,
        );
        if (Number.isFinite(smoothed)) {
          next[key] = smoothed;
          if (Math.abs(smoothed - Number(currentValue || 0)) > 0.001) {
            changed = true;
          }
        }
      }

      displayRef.current = next;
      if (changed) setDisplayTelemetry(next);
      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  return displayTelemetry;
}

function formatTireTemp(value) {
  if (value == null || value === "") return "0°C";
  const numeric = Number(String(value).replace(/[°CF]+/gi, ""));
  if (Number.isFinite(numeric))
    return `${Math.round(normalizeDisplayTireTemp(numeric))}°C`;
  return String(value);
}

function parseTireTemp(value) {
  const numeric = Number(String(value).replace(/[°CF]+/gi, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeDisplayTireTemp(value) {
  if (value <= 122) return Math.max(0, value);
  return 122 + Math.sqrt(value - 122) * 1.15;
}

function hasUsefulValues(values, minimum = 0) {
  return values.some(
    (value) => Number.isFinite(value) && Math.abs(value) > minimum,
  );
}

function formatSuspensionTravel(value) {
  if (value == null || value === "") return "0.0 cm";
  const numeric = Number(String(value).replace(/[^0-9.\-]+/g, ""));
  if (Number.isFinite(numeric)) {
    return `${numeric.toFixed(1)} cm`;
  }
  return String(value);
}

function getFuelInfo(telemetry) {
  const rawFuel = getTelemetryValue(
    telemetry,
    [
      "fuelPercent",
      "fuel_level",
      "fuelLevel",
      "fuel",
      "fuelRemaining",
      "fuel_remaining",
    ],
    0.58,
  );
  const fuelPercent =
    typeof rawFuel === "number"
      ? rawFuel <= 1
        ? Math.round(rawFuel * 100)
        : Math.round(rawFuel)
      : Number.parseFloat(String(rawFuel)) || 0;

  const fuelRate = getTelemetryValue(
    telemetry,
    [
      "fuelRate",
      "fuel_rate",
      "fuelConsumption",
      "fuel_consumption",
      "fuelEconomy",
      "fuel_economy",
    ],
    2.3,
  );

  const rawFuelRange = getTelemetryValue(
    telemetry,
    [
      "fuelRange",
      "fuel_range",
      "estimatedRange",
      "estimated_range",
      "rangeKm",
      "range_km",
      "range",
    ],
    null,
  );
  const fuelRange = Number.isFinite(rawFuelRange)
    ? Math.min(999, Math.max(0, rawFuelRange))
    : null;

  return {
    fuelPercent,
    fuelRate,
    fuelRange,
  };
}

function getTireTempValues(telemetry) {
  const direct = [
    telemetry.tireTempFrontLeft,
    telemetry.tireTempFrontRight,
    telemetry.tireTempRearLeft,
    telemetry.tireTempRearRight,
  ].map(parseTireTemp);
  if (hasUsefulValues(direct, 1)) {
    return direct;
  }

  const values = getTelemetryArray(
    telemetry,
    [
      "tireTemps",
      "tire_temp",
      "tyreTemps",
      "tireTemp",
      "tyreTemp",
      "tireTemperatures",
      "tire_temperature",
    ],
    [],
  );
  if (
    values.length >= 4 &&
    values.some((value) => value != null && value !== "")
  ) {
    return [0, 1, 2, 3].map((index) =>
      parseTireTemp(values[index] ?? values[0] ?? "0°C"),
    );
  }

  return null;
}

function getTireTemps(telemetry) {
  const rawValues = getTireTempValues(telemetry);
  if (rawValues) {
    return rawValues.map(formatTireTemp);
  }
  return deriveEstimatedTireTemps(telemetry).map(formatTireTemp);
}

function deriveEstimatedTireTemps(telemetry) {
  const speed = clamp(telemetry.speedKmh ?? 0, 0, 220);
  const steer = clamp((telemetry.steer ?? 0) / 127, -1, 1);
  const throttle = clamp(telemetry.throttle ?? 0, 0, 100);
  const brake = clamp(telemetry.brake ?? 0, 0, 100);
  const turnIntensity = Math.abs(steer);
  const driftIntensity = clamp(turnIntensity * clamp(speed / 120, 0, 1), 0, 1);

  const ambientTemp = 54;
  const speedHeat = speed * 0.12;
  const throttleHeat = throttle * 0.035;
  const brakeHeat = Math.min(brake, 80) * 0.03;
  const turnTemp = 8 * turnIntensity * clamp(speed / 140, 0, 1);
  const driftTemp = 10 * driftIntensity;

  const baseTemp = ambientTemp + speedHeat + throttleHeat + brakeHeat;
  const frontOutside = baseTemp + turnTemp * 0.9 + driftTemp * 1.0;
  const frontInside = baseTemp + turnTemp * 0.3;
  const rearOutside = baseTemp + turnTemp * 0.7 + driftTemp * 0.8;
  const rearInside = baseTemp + turnTemp * 0.25;

  const frontLeft = steer >= 0 ? frontOutside : frontInside;
  const frontRight = steer >= 0 ? frontInside : frontOutside;
  const rearLeft = steer >= 0 ? rearOutside : rearInside;
  const rearRight = steer >= 0 ? rearInside : rearOutside;

  return [frontLeft, frontRight, rearLeft, rearRight].map((value) =>
    clamp(value, 35, 118),
  );
}

function updateModeledTireTemps(telemetry, previousTemps, elapsedSeconds) {
  const dt = clamp(elapsedSeconds, 0.016, 1);
  const speed = clamp(telemetry.speedKmh ?? 0, 0, 260);
  const throttle = clamp(telemetry.throttle ?? 0, 0, 100) / 100;
  const brake = clamp(telemetry.brake ?? 0, 0, 100) / 100;
  const steer = clamp((telemetry.steer ?? 0) / 127, -1, 1);
  const rpmRatio = clamp(
    (telemetry.rpm ?? 0) / Math.max(telemetry.maxRpm ?? 10000, 1),
    0,
    1,
  );
  const lateralG = clamp((telemetry.accelerationX ?? 0) / 10, -1, 1);
  const longitudinalG = clamp((telemetry.accelerationZ ?? 0) / 10, -1, 1);
  const turn = Math.abs(lateralG) > 0.04 ? lateralG : steer;
  const turnIntensity = clamp(Math.abs(turn), 0, 1);
  const speedLoad = clamp(speed / 165, 0, 1);
  const moving = clamp(speed / 25, 0, 1);
  const driftLoad = turnIntensity * clamp(speed / 90, 0, 1);
  const driveLoad = throttle * (0.5 + rpmRatio * 0.5) * moving;
  const brakeLoad = brake * (0.35 + speedLoad * 0.65);
  const ambient = 42;

  return previousTemps.map((previous, index) => {
    const isFront = index < 2;
    const isLeft = index === 0 || index === 2;
    const outsideLoad = turn === 0 ? 0.5 : turn > 0 === isLeft ? 1 : 0.35;
    const axleDrive = isFront ? 0.35 : 1;
    const brakeBias = isFront ? 1 : 0.52;
    const cornerHeat = turnIntensity * outsideLoad * speedLoad * 12;
    const accelerationHeat = driveLoad * axleDrive * 7.2;
    const brakingHeat = brakeLoad * brakeBias * 10.5;
    const rollingHeat = moving * (1.6 + speedLoad * 4.2);
    const driftHeat = driftLoad * (isFront ? 3.4 : 8.5) * outsideLoad;
    const idleCooling =
      speed < 4 && throttle < 0.05 && brake < 0.05 ? 0.075 : 0;
    const cooling =
      (0.028 + speed * 0.00055 + idleCooling) * Math.max(0, previous - ambient);
    const heatDelta =
      rollingHeat + cornerHeat + accelerationHeat + brakingHeat + driftHeat;
    const heatFade = clamp((158 - previous) / 72, 0.18, 1);
    const next = previous + (heatDelta * heatFade - cooling) * dt;

    return clamp(next, 34, 220);
  });
}

function parseSuspensionTravel(value) {
  const numeric = Number(String(value).replace(/[^0-9.\-]+/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
}

function getSuspensionValues(telemetry) {
  const direct = [
    telemetry.suspensionTravelMetersFrontLeft,
    telemetry.suspensionTravelMetersFrontRight,
    telemetry.suspensionTravelMetersRearLeft,
    telemetry.suspensionTravelMetersRearRight,
  ].map((value) => parseSuspensionTravel(value) * 100);
  if (hasUsefulValues(direct, 0.05)) {
    return direct;
  }

  const values = getTelemetryArray(
    telemetry,
    [
      "suspensionTravel",
      "suspension_travel",
      "suspension",
      "suspensionTravelCm",
      "suspensionTravelMm",
    ],
    [],
  );
  if (
    values.length >= 4 &&
    values.some((value) => value != null && value !== "")
  ) {
    return [0, 1, 2, 3].map((index) =>
      parseSuspensionTravel(values[index] ?? values[0] ?? "2.0"),
    );
  }

  return null;
}

function getSuspensionTravel(telemetry) {
  const rawValues = getSuspensionValues(telemetry);
  if (rawValues) {
    return rawValues.map(formatSuspensionTravel);
  }
  return deriveEstimatedSuspension(telemetry).map(formatSuspensionTravel);
}

function hasDirectSuspensionTravel(telemetry) {
  return [
    telemetry.suspensionTravelMetersFrontLeft,
    telemetry.suspensionTravelMetersFrontRight,
    telemetry.suspensionTravelMetersRearLeft,
    telemetry.suspensionTravelMetersRearRight,
  ].some((value) => Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0.001);
}

function calculateDriftAngle(telemetry) {
  const lateral = Number(telemetry.velocityX) || 0;
  const forward = Number(telemetry.velocityZ) || 0;
  const speed = Math.hypot(lateral, forward);
  if (speed >= 3) {
    return clamp(
      Math.round(Math.abs(Math.atan2(lateral, Math.abs(forward))) * (180 / Math.PI)),
      0,
      90,
    );
  }

  return clamp(
    Math.round(
      Math.abs((telemetry.steer || 0) / 127) *
        clamp((telemetry.speedKmh || 0) / 80, 0, 1) *
        28,
    ),
    0,
    45,
  );
}

function getGForces(telemetry) {
  return {
    lateral: clamp((Number(telemetry.accelerationX) || 0) / 9.80665, -3, 3),
    longitudinal: clamp((Number(telemetry.accelerationZ) || 0) / 9.80665, -3, 3),
  };
}

function getSurfaceState(telemetry) {
  const rumble = [
    telemetry.wheelOnRumbleStripFrontLeft,
    telemetry.wheelOnRumbleStripFrontRight,
    telemetry.wheelOnRumbleStripRearLeft,
    telemetry.wheelOnRumbleStripRearRight,
  ].some((value) => Number(value) === 1);
  const puddle = [
    telemetry.wheelInPuddleFrontLeft,
    telemetry.wheelInPuddleFrontRight,
    telemetry.wheelInPuddleRearLeft,
    telemetry.wheelInPuddleRearRight,
  ].some((value) => Number(value) === 1);
  if (puddle) return "PUDDLE";
  if (rumble) return "RUMBLE";
  return "CLEAN";
}

function deriveEstimatedSuspension(telemetry) {
  const speed = clamp(telemetry.speedKmh ?? 0, 0, 250);
  const lateralG = clamp((telemetry.accelerationX ?? 0) / 12, -1, 1);
  const longitudinalG = clamp((telemetry.accelerationZ ?? 0) / 12, -1, 1);
  const throttle = clamp(telemetry.throttle ?? 0, 0, 100);
  const brake = clamp(telemetry.brake ?? 0, 0, 100);
  const steer = clamp((telemetry.steer ?? 0) / 127, -1, 1);
  const speedFactor = clamp(speed / 160, 0, 1);

  const baseTravel = 2.0 + speedFactor * 0.45;
  const dive = clamp(brake / 100, 0, 1) * 0.35 * speedFactor;
  const squat = clamp(throttle / 100, 0, 1) * 0.25 * speedFactor;
  const roll = Math.abs(lateralG) * 0.24 * speedFactor;
  const bump = Math.max(0, longitudinalG) * 0.18 * speedFactor;

  const frontLeft =
    baseTravel +
    dive * 0.82 +
    squat * 0.18 +
    (steer < 0 ? roll : 0.08 * roll) +
    bump * 0.6;
  const frontRight =
    baseTravel +
    dive * 0.82 +
    squat * 0.18 +
    (steer > 0 ? roll : 0.08 * roll) +
    bump * 0.6;
  const rearLeft =
    baseTravel +
    squat * 0.75 +
    dive * 0.12 +
    (steer > 0 ? roll : 0.08 * roll) +
    bump * 0.35;
  const rearRight =
    baseTravel +
    squat * 0.75 +
    dive * 0.12 +
    (steer < 0 ? roll : 0.08 * roll) +
    bump * 0.35;

  return [frontLeft, frontRight, rearLeft, rearRight].map((value) =>
    clamp(value, 1.5, 4.2),
  );
}

function updateModeledSuspensionTravel(
  telemetry,
  previousTravel,
  elapsedSeconds,
) {
  const dt = clamp(elapsedSeconds, 0.016, 1);
  const speed = clamp(telemetry.speedKmh ?? 0, 0, 260);
  const throttle = clamp(telemetry.throttle ?? 0, 0, 100) / 100;
  const brake = clamp(telemetry.brake ?? 0, 0, 100) / 100;
  const steer = clamp((telemetry.steer ?? 0) / 127, -1, 1);
  const lateralG = clamp((telemetry.accelerationX ?? 0) / 10, -1.2, 1.2);
  const longitudinalG = clamp((telemetry.accelerationZ ?? 0) / 10, -1.2, 1.2);
  const speedLoad = clamp(speed / 180, 0, 1);
  const turn = Math.abs(lateralG) > 0.04 ? lateralG : steer * speedLoad;
  const turnAmount = Math.abs(turn);
  const base = 2.15 + speedLoad * 0.28;
  const brakeDive =
    brake * (0.58 + speedLoad * 0.32) + Math.max(0, longitudinalG) * 0.35;
  const throttleSquat =
    throttle * (0.34 + speedLoad * 0.24) + Math.max(0, -longitudinalG) * 0.22;
  const roll = turnAmount * (0.52 + speedLoad * 0.34);

  const targets = [0, 1, 2, 3].map((index) => {
    const isFront = index < 2;
    const isLeft = index === 0 || index === 2;
    const outside = turn === 0 ? 0.5 : turn > 0 === isLeft ? 1 : 0.16;
    const insideLift = turn === 0 ? 0 : turn > 0 === isLeft ? 0 : 0.2;
    const axleLoad = isFront
      ? brakeDive * 0.74 - throttleSquat * 0.16
      : throttleSquat * 0.78 - brakeDive * 0.18;
    const cornerLoad = roll * outside - roll * insideLift;
    const vibration =
      speedLoad *
      (Math.sin(Date.now() / 120 + index * 1.7) * 0.05 +
        Math.sin(Date.now() / 53 + index) * 0.025);

    return clamp(base + axleLoad + cornerLoad + vibration, 1.35, 5.4);
  });

  const response = 1 - Math.exp(-dt * 7.5);
  return previousTravel.map((previous, index) => {
    const target = targets[index] ?? previous;
    return previous + (target - previous) * response;
  });
}

function formatTime(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function validTemperature(value) {
  return Number.isFinite(value) && value > -40 && value < 150;
}

function RainCloudIcon({ size = 42, className = "" }) {
  return (
    <svg
      className={`rain-cloud-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="rain-cloud-icon__cloud"
        d="M18.5 39.5H17a12 12 0 0 1 0-24c1.3 0 2.55.2 3.72.59A17 17 0 0 1 53 23.5h1.5a9 9 0 0 1 0 18H47"
      />
      <path className="rain-cloud-icon__rain" d="M24 45.5l-3 6" />
      <path className="rain-cloud-icon__rain" d="M34 45.5l-3 6" />
      <path className="rain-cloud-icon__rain" d="M44 45.5l-3 6" />
      <path className="rain-cloud-icon__rain" d="M29 54l-2 4" />
      <path className="rain-cloud-icon__rain" d="M39 54l-2 4" />
    </svg>
  );
}

function ClearWeatherIcon({ size = 42, className = "" }) {
  return (
    <svg
      className={`clear-weather-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <circle className="clear-weather-icon__sun" cx="32" cy="32" r="12" />
      <path className="clear-weather-icon__ray" d="M32 9v7" />
      <path className="clear-weather-icon__ray" d="M32 48v7" />
      <path className="clear-weather-icon__ray" d="M9 32h7" />
      <path className="clear-weather-icon__ray" d="M48 32h7" />
      <path className="clear-weather-icon__ray" d="M15.7 15.7l5 5" />
      <path className="clear-weather-icon__ray" d="M43.3 43.3l5 5" />
      <path className="clear-weather-icon__ray" d="M48.3 15.7l-5 5" />
      <path className="clear-weather-icon__ray" d="M20.7 43.3l-5 5" />
    </svg>
  );
}

function MoonWeatherIcon({ size = 42, className = "" }) {
  return (
    <svg
      className={`moon-weather-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="moon-weather-icon__moon"
        d="M45.5 43.5A22 22 0 0 1 23 14.2 22 22 0 1 0 49.8 41c-1.36 1.02-2.8 1.86-4.3 2.5Z"
      />
      <path className="moon-weather-icon__star" d="M47 13v8" />
      <path className="moon-weather-icon__star" d="M43 17h8" />
      <path className="moon-weather-icon__star" d="M53 27v5" />
      <path className="moon-weather-icon__star" d="M50.5 29.5h5" />
    </svg>
  );
}

function CloudWeatherIcon({ size = 42, className = "" }) {
  return (
    <svg
      className={`cloud-weather-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="cloud-weather-icon__cloud"
        d="M18.5 41H50.5a8.5 8.5 0 0 0 0-17h-1.4A16 16 0 0 0 18.8 18A11.5 11.5 0 0 0 18.5 41Z"
      />
    </svg>
  );
}

function WeatherIcon({ code, size = 42, isDay = true }) {
  if (code === 0) {
    return isDay ? (
      <ClearWeatherIcon size={size} />
    ) : (
      <MoonWeatherIcon size={size} />
    );
  }
  if ([1, 2, 3, 45, 48].includes(code)) return <CloudWeatherIcon size={size} />;
  return <RainCloudIcon size={size} />;
}

const WEATHER_CACHE_TTL_MS = 3 * 60 * 60 * 1000;

function fallbackWeatherFor(region) {
  return {
    temperature: 24,
    description: "Light Rain",
    location: region,
    error: "",
    isDay: true,
    code: 61,
    forecast: [
      { day: "Fri", temperature: 25, code: 61 },
      { day: "Sat", temperature: 22, code: 61 },
      { day: "Sun", temperature: 20, code: 61 },
      { day: "Mon", temperature: 21, code: 3 },
    ],
  };
}

function describeWeather(code) {
  if (code === 0) return "Clear";
  if ([1, 2].includes(code)) return "Partly Cloudy";
  if (code === 3) return "Cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 80].includes(code)) return "Light Rain";
  if ([63, 65, 66, 67, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Weather";
}

function formatForecastDay(dateText) {
  return new Intl.DateTimeFormat("en", { weekday: "short" }).format(
    new Date(`${dateText}T12:00:00`),
  );
}

function weatherCacheKey(region) {
  return `forzadash-weather:${region}`;
}

function getCachedWeather(region) {
  try {
    const cached = JSON.parse(
      localStorage.getItem(weatherCacheKey(region)) || "null",
    );
    if (!cached?.data || !Number.isFinite(cached.savedAt)) return null;
    if (Date.now() - cached.savedAt > WEATHER_CACHE_TTL_MS) return null;
    if (typeof cached.data.isDay !== "boolean") return null;
    return cached.data;
  } catch {
    return null;
  }
}

function saveCachedWeather(region, data) {
  try {
    localStorage.setItem(
      weatherCacheKey(region),
      JSON.stringify({ data, savedAt: Date.now() }),
    );
  } catch {
    // Weather still works without cache if browser storage is blocked.
  }
}

function useClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return {
    time: new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(now),
    date: new Intl.DateTimeFormat("en", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(now),
  };
}

function useHardwareTemperature() {
  const settings = useSettings();
  const [hardwareTemperature, setHardwareTemperature] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadHardwareTemperature() {
      try {
        const telemetryPort =
          settings.telemetryWsPort || DEFAULT_SETTINGS.telemetryWsPort;
        const response = await fetch(
          `${getTelemetryHttpBase(telemetryPort)}/api/hardware-temp`,
        );
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error(`Expected JSON, got ${contentType || "unknown"}`);
        }
        const data = await response.json();
        if (!cancelled) {
          setHardwareTemperature(
            Number.isFinite(data?.temperature) ? data : null,
          );
        }
      } catch {
        if (!cancelled) setHardwareTemperature(null);
      }
    }

    loadHardwareTemperature();
    const interval = window.setInterval(loadHardwareTemperature, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [settings.telemetryWsPort]);

  return hardwareTemperature;
}

function useWeather(settings) {
  const weatherRegion =
    settings.weatherRegion || DEFAULT_SETTINGS.weatherRegion;
  const fallbackWeather = fallbackWeatherFor(weatherRegion);
  const [weather, setWeather] = useState(
    () => getCachedWeather(weatherRegion) || fallbackWeather,
  );

  useEffect(() => {
    const controller = new AbortController();
    setWeather(getCachedWeather(weatherRegion) || fallbackWeather);

    async function loadWeather() {
      const cachedWeather = getCachedWeather(weatherRegion);
      if (cachedWeather) {
        setWeather(cachedWeather);
        return;
      }

      try {
        const searchParams = new URLSearchParams({
          name: weatherRegion,
          count: "1",
          language: "en",
          format: "json",
        });
        const locationResponse = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?${searchParams}`,
          {
            signal: controller.signal,
          },
        );
        const locationData = await locationResponse.json();
        const location = locationData.results?.[0];
        if (!location) {
          setWeather({
            ...fallbackWeather,
            description: "Weather unavailable",
            location: weatherRegion,
            error: "Location not found",
          });
          return;
        }

        const forecastParams = new URLSearchParams({
          latitude: String(location.latitude),
          longitude: String(location.longitude),
          current: "temperature_2m,weather_code,is_day",
          daily: "weather_code,temperature_2m_max",
          forecast_days: "4",
          timezone: "auto",
        });
        const forecastResponse = await fetch(
          `https://api.open-meteo.com/v1/forecast?${forecastParams}`,
          {
            signal: controller.signal,
          },
        );
        const forecastData = await forecastResponse.json();
        const dailyTimes = forecastData.daily?.time || [];
        const dailyTemps = forecastData.daily?.temperature_2m_max || [];
        const dailyCodes = forecastData.daily?.weather_code || [];

        const nextWeather = {
          temperature: Math.round(
            forecastData.current?.temperature_2m ?? fallbackWeather.temperature,
          ),
          description: describeWeather(forecastData.current?.weather_code),
          code: forecastData.current?.weather_code ?? fallbackWeather.code,
          isDay:
            forecastData.current?.is_day == null
              ? fallbackWeather.isDay
              : Boolean(forecastData.current.is_day),
          location: location.name,
          error: "",
          forecast: dailyTimes.map((day, index) => ({
            day: formatForecastDay(day),
            temperature: Math.round(
              dailyTemps[index] ??
                fallbackWeather.forecast[index]?.temperature ??
                0,
            ),
            code: dailyCodes[index] ?? 0,
          })),
        };

        setWeather(nextWeather);
        saveCachedWeather(weatherRegion, nextWeather);
      } catch (error) {
        if (error.name !== "AbortError") {
          setWeather((current) => ({
            ...current,
            description: "Weather unavailable",
            error: "Weather fetch failed",
          }));
        }
      }
    }

    loadWeather();
    const interval = window.setInterval(loadWeather, 15 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [weatherRegion]);

  return weather;
}

function App() {
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [telemetry, setTelemetry] = useState(fallbackTelemetry);
  const [lastPacketAt, setLastPacketAt] = useState(0);
  const [telemetryServerOnline, setTelemetryServerOnline] = useState(
    Boolean(window.forzaDash?.onTelemetry),
  );
  const smoothTelemetry = useSmoothedTelemetry(telemetry);
  const weather = useWeather(settings);
  const hardwareTemperature = useHardwareTemperature();
  const clock = useClock();
  const demoFrameRef = useRef(0);

  useEffect(() => {
    function toggleFullscreen(event) {
      if (
        event.button !== 0 ||
        event.target.closest(
          "button, input, select, textarea, a, [role='button'], .settings-modal",
        )
      ) {
        return;
      }

      fetch("/api/window/toggle-fullscreen").catch(() => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.().catch(() => {});
        } else {
          document.exitFullscreen?.().catch(() => {});
        }
      });
    }

    window.addEventListener("dblclick", toggleFullscreen);
    return () => window.removeEventListener("dblclick", toggleFullscreen);
  }, []);

  useEffect(() => {
    if (window.forzaDash?.onTelemetry) {
      window.forzaDash
        .getLatestTelemetry?.()
        .then((data) => {
          setTelemetryServerOnline(true);
          if (data) {
            setTelemetry(data);
            setLastPacketAt(Date.now());
          }
        })
        .catch(() => setTelemetryServerOnline(false));
      return window.forzaDash.onTelemetry((data) => {
        setTelemetryServerOnline(true);
        setTelemetry(data);
        setLastPacketAt(Date.now());
      });
    }

    const telemetryPort =
      settings.telemetryWsPort || DEFAULT_SETTINGS.telemetryWsPort;
    const socket = new WebSocket(getTelemetryWsUrl(telemetryPort));
    socket.addEventListener("open", () => setTelemetryServerOnline(true));
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      setTelemetryServerOnline(true);
      setTelemetry(data);
      setLastPacketAt(Date.now());
    });
    socket.addEventListener("error", () => setTelemetryServerOnline(false));
    socket.addEventListener("close", () => setTelemetryServerOnline(false));
    return () => socket.close();
  }, [settings.telemetryWsPort]);

  const online = lastPacketAt && Date.now() - lastPacketAt < 2500;

  useEffect(() => {
    if (!settings.demoDriveMode) return undefined;
    if (online) {
      saveSettings({ ...settings, demoDriveMode: false });
      return undefined;
    }
    const id = setInterval(() => {
      demoFrameRef.current += 1;
      setTelemetry(createDemoTelemetry(demoFrameRef.current));
    }, 100);
    return () => clearInterval(id);
  }, [settings, online]);

  useEffect(() => {
    if (!settings.demoDriveMode && !online) {
      setTelemetry(fallbackTelemetry);
    }
  }, [settings.demoDriveMode, online]);
  const telemetryStatus = !telemetryServerOnline
    ? "SERVER OFF"
    : online
      ? "ONLINE"
      : "NO PACKETS";
  const rpmRatio = clamp(smoothTelemetry.rpm / smoothTelemetry.maxRpm, 0, 1);
  const speed = Math.round(smoothTelemetry.speedKmh);
  const stableGearRef = useRef(1);
  stableGearRef.current = normalizeGear(telemetry.gear, stableGearRef.current);
  const gear = formatGear(stableGearRef.current);

  return (
    <main
      className="dashboard"
      style={{
        "--dashboard-bg": normalizeColor(settings.backgroundColor),
      }}
    >
      <TopBar
        online={online}
        telemetryStatus={telemetryStatus}
        weather={weather}
        clock={clock}
      />
      <section className="main-grid">
        <TelemetryPanel telemetry={smoothTelemetry} gear={gear} />
        <CenterDial
          telemetry={smoothTelemetry}
          speed={speed}
          gear={gear}
          rpmRatio={rpmRatio}
          hardwareTemperature={hardwareTemperature}
        />
        <aside className="right-stack">
          <MusicPanel onOpenSettings={() => setSettingsOpen(true)} />
          <WeatherPanel weather={weather} />
        </aside>
      </section>
      <BottomSystems telemetry={smoothTelemetry} />
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          telemetryOnline={Boolean(online)}
        />
      )}
    </main>
  );
}

function TopBar({ online, telemetryStatus, weather, clock }) {
  const [clockTime, meridiem] = clock.time.split(" ");

  return (
    <header className="top-bar">
      <div className="brand-mark">
        <img className="forza-logo" src={forzaLogo} alt="" />
        <div className="brand-lines">
          <strong>FORZA</strong>
          <span>
            HORIZON <b>6</b>
          </span>
        </div>
      </div>
      <div className="assist-row">
        {["ABS", "TCS", "STM"].map((item) => (
          <div className="assist" key={item}>
            <span>{item}</span>
            <strong>ON</strong>
          </div>
        ))}
        <div className="assist wide">
          <Wifi size={23} className={online ? "online" : ""} />
          <span>{telemetryStatus}</span>
        </div>
      </div>
      <div className="time-weather">
        <WeatherIcon code={weather.code} size={42} isDay={weather.isDay} />
        <div>
          <strong>{weather.temperature}°C</strong>
          <span>{weather.description}</span>
        </div>
        <div className="clock">
          <strong>{clockTime}</strong>
          <span>{meridiem}</span>
          <em>{clock.date}</em>
        </div>
      </div>
    </header>
  );
}

function TelemetryPanel({ telemetry, gear }) {
  const { fuelRange } = getFuelInfo(telemetry);
  const reverseGear = gear === "R";
  const reportedDistance = getTelemetryValue(
    telemetry,
    ["distance", "distanceKm", "distance_km", "odometer"],
    null,
  );

  const distanceRef = useRef(reportedDistance ?? 0);
  const lastDistanceTimeRef = useRef(Date.now());
  const fuelRef = useRef(60 + Math.random() * 20);
  const now = Date.now();
  const elapsedSeconds = clamp(
    (now - lastDistanceTimeRef.current) / 1000,
    0,
    2,
  );
  lastDistanceTimeRef.current = now;

  let displayDistance = distanceRef.current;
  if (reportedDistance != null && Number.isFinite(reportedDistance)) {
    displayDistance = reportedDistance;
    distanceRef.current = reportedDistance;
  } else {
    const speedKmH = clamp(telemetry.speedKmh ?? 0, 0, 300);
    displayDistance = distanceRef.current + (speedKmH / 3600) * elapsedSeconds;
    distanceRef.current = displayDistance;
  }

  const speedKmH = clamp(telemetry.speedKmh ?? 0, 0, 300);
  const distanceDelta = (speedKmH / 3600) * elapsedSeconds;
  const fuelUsePerKm =
    0.08 +
    clamp(telemetry.throttle ?? 0, 0, 100) * 0.0014 +
    clamp(telemetry.boostBar ?? 0, 0, 2) * 0.02;
  fuelRef.current = fuelRef.current - distanceDelta * fuelUsePerKm;
  if (fuelRef.current <= 10) {
    fuelRef.current = 60 + Math.random() * 20;
  }
  const fuelPercent = clamp(fuelRef.current, 0, 100);
  const fuelLiters = fuelPercent * 0.59;
  const rangeOrDistanceLabel = fuelRange != null ? "RANGE" : "DISTANCE";
  const rangeOrDistanceValue = fuelRange != null ? fuelRange : displayDistance;
  const maxSpeedRef = useRef(0);
  const currentSpeed = telemetry.speedKmh ?? 0;
  if (currentSpeed < 1) {
    maxSpeedRef.current = 0;
  } else {
    maxSpeedRef.current = Math.max(maxSpeedRef.current, currentSpeed);
  }

  const rows = [
    ["POWER", number(telemetry.powerHp), "HP"],
    ["TORQUE", number(telemetry.torqueNm), "NM"],
    ["BOOST", number(Math.abs(telemetry.boostBar), 2), "BAR"],
    ["THROTTLE", number(telemetry.throttle), "%"],
    ["BRAKE", number(telemetry.brake), "%"],
    ["CLUTCH", number(telemetry.clutch), "%"],
    [
      "FUEL",
      formatValue(fuelPercent, "", 0),
      "%",
      `${number(fuelLiters, 1)} L`,
    ],
    ["MAX SPEED", formatValue(maxSpeedRef.current, "", 0), "KM/H"],
    [
      rangeOrDistanceLabel,
      formatValue(rangeOrDistanceValue, "", fuelRange != null ? 0 : 1),
      "KM",
    ],
  ];

  return (
    <section className="glass-panel telemetry-panel">
      <h2>VEHICLE TELEMETRY</h2>
      <div className="hero-telemetry">
        <div>
          <span>GEAR</span>
          <div className={`gear-hero-row ${reverseGear ? "is-reverse" : ""}`}>
            <strong>{gear}</strong>
          </div>
          <em>MANUAL</em>
        </div>
        <div>
          <MiniStat
            label="SPEED"
            value={number(telemetry.speedKmh)}
            unit="KM/H"
          />
          <MiniStat label="RPM" value={number(telemetry.rpm)} />
        </div>
      </div>
      <div className="stat-grid">
        {rows.map(([label, value, unit, sub]) => (
          <div className="stat-cell" key={label}>
            <span>{label}</span>
            <strong>
              {value}
              {unit === "%" && <small>%</small>}
            </strong>
            <em>{sub || (unit !== "%" ? unit : "")}</em>
            {(label === "THROTTLE" ||
              label === "BRAKE" ||
              label === "CLUTCH") && (
              <i
                style={{
                  "--fill": `${label === "THROTTLE" ? telemetry.throttle : label === "BRAKE" ? telemetry.brake : telemetry.clutch}%`,
                  "--bar": label === "BRAKE" ? "#ff3d4f" : "#28f28a",
                }}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function MiniStat({ label, value, unit }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
    </div>
  );
}

function CenterDial({ telemetry, speed, gear, hardwareTemperature }) {
  const reverseGear = gear === "R";
  const fallbackGearMaxSpeeds = {
    1: 65,
    2: 105,
    3: 150,
    4: 195,
    5: 240,
    6: 285,
    7: 330,
    8: 375,
    9: 420,
    10: 465,
  };
  const gearNumber = Number(gear);
  const liveRpmRatio = clamp(
    (telemetry.rpm || 0) / Math.max(telemetry.maxRpm || 10000, 1),
    0,
    1,
  );
  const learnedGearMaxRef = useRef({});
  const fallbackGearMaxSpeed = fallbackGearMaxSpeeds[gearNumber] ?? 340;
  const canLearnGear =
    Number.isFinite(gearNumber) &&
    gearNumber > 0 &&
    speed > 8 &&
    liveRpmRatio > 0.22;
  if (canLearnGear) {
    const estimatedMaxSpeed = speed / Math.max(liveRpmRatio, 0.12);
    const saneEstimate = clamp(
      estimatedMaxSpeed,
      Math.max(30, speed),
      Math.max(fallbackGearMaxSpeed * 1.45, speed + 20),
    );
    const previousMax = learnedGearMaxRef.current[gearNumber] || saneEstimate;
    const learnRate = liveRpmRatio > 0.72 ? 0.18 : 0.06;
    learnedGearMaxRef.current[gearNumber] =
      previousMax + (saneEstimate - previousMax) * learnRate;
  }
  const gearMaxSpeed =
    learnedGearMaxRef.current[gearNumber] || fallbackGearMaxSpeed;
  const throttleRatio = clamp((telemetry.throttle || 0) / 100, 0, 1);
  const brakeRatio = clamp((telemetry.brake || 0) / 100, 0, 1);
  const driveGearRatio = Number.isFinite(gearNumber) && gearNumber > 0
    ? clamp(speed / Math.max(gearMaxSpeed, 1), 0, 1)
    : 0;
  const rpmNeedleRatio =
    speed > 4 || throttleRatio > 0.08 ? liveRpmRatio : 0;
  const gearSpeedRatio = Math.max(driveGearRatio, rpmNeedleRatio);
  const needleRatioRef = useRef(0);
  const needleTimeRef = useRef(Date.now());
  const needleNow = Date.now();
  const needleElapsed = clamp(
    (needleNow - needleTimeRef.current) / 1000,
    0.016,
    0.08,
  );
  needleTimeRef.current = needleNow;
  needleRatioRef.current = smoothValue(
    needleRatioRef.current,
    gearSpeedRatio,
    needleElapsed,
    "speedKmh",
    3.1,
  );
  const limiterIntensity =
    clamp((needleRatioRef.current - 0.88) / 0.12, 0, 1) * throttleRatio;
  const needleBounce =
    limiterIntensity *
    (Math.sin(needleNow / 58) * 3.8 + Math.sin(needleNow / 31) * 2.0);
  const needleStartAngle = 183;
  const needleSweepAngle = 220;
  const needleAngle =
    needleStartAngle + needleRatioRef.current * needleSweepAngle + needleBounce;
  const needleHot = needleRatioRef.current > 0.5;
  const forceFullSpeedGlow = false;
  const shiftLightRatio = Math.max(needleRatioRef.current, rpmNeedleRatio);
  const glowFillRatio = clamp(shiftLightRatio / 0.9, 0, 1);
  const speedGlowProgress = forceFullSpeedGlow
    ? 100
    : glowFillRatio * 100;
  const speedGlowHot = forceFullSpeedGlow
    ? 1
    : clamp((shiftLightRatio - 0.62) / 0.38, 0, 1);
  const speedGlowVisible = forceFullSpeedGlow
    ? 1
    : clamp((shiftLightRatio - 0.018) / 0.04, 0, 1);
  const lastGForceRef = useRef({
    at: Date.now(),
    speedKmh: telemetry.speedKmh || 0,
    value: 0,
    lateral: 0,
    longitudinal: 0,
  });
  const packetForces = getGForces(telemetry);
  const packetGForce =
    Math.hypot(packetForces.lateral || 0, packetForces.longitudinal || 0);
  const gNow = Date.now();
  const gElapsed = clamp((gNow - lastGForceRef.current.at) / 1000, 0.016, 0.25);
  const speedDeltaMps =
    ((telemetry.speedKmh || 0) - lastGForceRef.current.speedKmh) / 3.6;
  const derivedGForce = Math.abs(speedDeltaMps / gElapsed) / 9.80665;
  const gTarget = packetGForce > 0.015 ? packetGForce : derivedGForce;
  lastGForceRef.current.value = smoothValue(
    lastGForceRef.current.value,
    clamp(gTarget, 0, 2.5),
    gElapsed,
    "accelerationX",
    4.2,
  );
  lastGForceRef.current.lateral = smoothValue(
    lastGForceRef.current.lateral,
    packetForces.lateral,
    gElapsed,
    "accelerationX",
    5.2,
  );
  lastGForceRef.current.longitudinal = smoothValue(
    lastGForceRef.current.longitudinal,
    packetForces.longitudinal,
    gElapsed,
    "accelerationZ",
    5.2,
  );
  lastGForceRef.current.at = gNow;
  lastGForceRef.current.speedKmh = telemetry.speedKmh || 0;
  const gForce = lastGForceRef.current.value;
  const driftAngle = calculateDriftAngle(telemetry);
  const realTempValue = getTelemetryValue(
    telemetry,
    ["engineTemp", "coolantTemp", "temp", "temperature"],
    null,
  );
  const derivedTempTarget = clamp(
    82 +
      clamp(telemetry.throttle || 0, 0, 100) * 0.14 +
      liveRpmRatio *
        18 +
      clamp(telemetry.boostBar || 0, 0, 2) * 2 -
      clamp(telemetry.speedKmh || 0, 0, 260) * 0.025,
    78,
    118,
  );
  const hardwareTempValue = Number(hardwareTemperature?.temperature);
  const tempTarget = validTemperature(hardwareTempValue)
    ? hardwareTempValue
    : validTemperature(realTempValue)
      ? realTempValue
      : derivedTempTarget;
  const tempSource = validTemperature(hardwareTempValue)
    ? hardwareTemperature.source || "hardware"
    : validTemperature(realTempValue)
      ? "telemetry"
      : "fallback";
  const tempRef = useRef(tempTarget);
  const tempTimeRef = useRef(Date.now());
  const tempElapsed = clamp((Date.now() - tempTimeRef.current) / 1000, 0, 1);
  tempTimeRef.current = Date.now();
  if (!validTemperature(tempRef.current)) {
    tempRef.current = tempTarget;
  }
  tempRef.current =
    tempRef.current +
    clamp(tempTarget - tempRef.current, -3 * tempElapsed, 3 * tempElapsed);
  const tempValue = Math.round(tempRef.current);
  const tempRatio = clamp(tempValue / 140, 0, 1);
  return (
    <section className="dial-wrap">
      <div className="dial">
        <img className="speedometer-bg" src={speedometerBg} alt="" />
        <svg
          className="speed-arc-glow"
          viewBox="0 0 100 100"
          aria-hidden="true"
          style={{
            "--speed-glow": speedGlowProgress,
            "--speed-hot": speedGlowHot,
            "--speed-visible": speedGlowVisible,
          }}
        >
          <defs>
            <linearGradient
              id="speedArcGradient"
              x1="4%"
              y1="54%"
              x2="93%"
              y2="68%"
            >
              <stop offset="0%" stopColor="#13d9ff" />
              <stop offset="55%" stopColor="#1486ff" />
              <stop offset="78%" stopColor="#ff2a4a" />
              <stop offset="100%" stopColor="#ff1732" />
            </linearGradient>
          </defs>
          <path
            className="speed-arc-glow__track"
            d="M5 53 A45 45 0 1 1 91 68"
            pathLength="100"
          />
          <path
            className="speed-arc-glow__value"
            d="M5 53 A45 45 0 1 1 91 68"
            pathLength="100"
          />
        </svg>
        <div
          className={`speed-needle ${needleHot ? "hot" : ""}`}
          style={{ transform: `rotate(${needleAngle}deg)` }}
        />
        <div className={`dial-speed-readout ${needleHot ? "hot" : ""}`}>
          <strong>{speed}</strong>
          <em>KM/H</em>
        </div>
        <div className="dial-lower">
          <div className="lower-g-meter">
            <div className="lower-g-grid">
              <strong>{number(gForce, 2)}</strong>
            </div>
            <span>G-FORCE</span>
          </div>

          <div className="lower-center">
            <div className={`lower-gear ${reverseGear ? "is-reverse" : ""}`}>
              <strong>{gear}</strong>
              <span>GEAR</span>
            </div>
            <div className="lower-temp">
              <span>♨</span>
              <strong>{tempValue}°C</strong>
              <i style={{ "--temp": `${tempRatio * 100}%` }} />
            </div>
          </div>

          <div className="lower-drift">
            <div className="lower-drift-grid">
              <strong>{driftAngle}</strong>
            </div>
            <div>
              <strong>{driftAngle}</strong>
              <span>DRIFT ANGLE</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MusicPanel({ onOpenSettings }) {
  const settings = useSettings();
  const configured = isSpotifyConfigured();
  const spotifyLoggedIn = hasSpotifyLogin();
  const [playback, setPlayback] = useState(null);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [progressAnchor, setProgressAnchor] = useState({
    progress: 0,
    at: Date.now(),
    playing: false,
  });
  const [spotifyReady, setSpotifyReady] = useState(false);
  const [spotifyError, setSpotifyError] = useState("");
  const [youtubeTestStatus, setYoutubeTestStatus] = useState("");
  const [youtubeMusicPlaying, setYoutubeMusicPlaying] = useState(false);
  const [musicProvider, setMusicProvider] = useState(
    () => localStorage.getItem(MUSIC_PROVIDER_KEY) || "spotify",
  );
  const [youtubeTrack, setYoutubeTrack] = useState(null);
  const [youtubeWindowVisible, setYoutubeWindowVisible] = useState(false);
  const [keepYouTubeOpenButtonVisible, setKeepYouTubeOpenButtonVisible] =
    useState(false);
  const wasYouTubePlayingRef = useRef(false);
  const openButtonTimerRef = useRef(null);
  const [youtubeVolume, setYoutubeVolume] = useState(readStoredYouTubeVolume);
  const [youtubeMuted, setYoutubeMuted] = useState(readStoredYouTubeMuted);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");
  const lastYouTubeTrackKeyRef = useRef("");

  async function refreshPlayback() {
    if (!configured) return;
    const result = await getPlaybackState();
    if (result.status === 401) {
      setSpotifyReady(false);
      setSpotifyError(
        configured ? "Spotify login required" : "Spotify not configured",
      );
      return;
    }
    if (result.status === 204) {
      setSpotifyReady(true);
      setPlayback(null);
      setSpotifyError("Open Spotify on a device to control playback");
      return;
    }
    if (result.status >= 400) {
      setSpotifyError(result.data?.error?.message || "Spotify unavailable");
      return;
    }
    setSpotifyReady(true);
    setSpotifyError("");
    setPlayback(result.data);
    setShuffleEnabled(Boolean(result.data?.shuffle_state));
    setRepeatMode(result.data?.repeat_state === "off" ? "off" : "track");
    setProgressAnchor({
      progress: result.data?.progress_ms || 0,
      at: Date.now(),
      playing: Boolean(result.data?.is_playing),
    });
  }

  useEffect(() => {
    let cancelled = false;
    async function start() {
      await completeSpotifyLogin();
      if (!cancelled) await refreshPlayback();
    }
    start();
    const id = setInterval(() => refreshPlayback(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [settings.spotifyClientId]);

  useEffect(() => {
    const id = setInterval(() => {
      setDisplayProgress(() => {
        const elapsed = progressAnchor.playing
          ? Date.now() - progressAnchor.at
          : 0;
        const duration = playback?.item?.duration_ms || 0;
        return duration
          ? Math.min(duration, progressAnchor.progress + elapsed)
          : progressAnchor.progress;
      });
    }, 250);
    return () => clearInterval(id);
  }, [playback?.item?.duration_ms, progressAnchor]);

  useEffect(() => {
    localStorage.setItem(MUSIC_PROVIDER_KEY, musicProvider);
  }, [musicProvider]);
  useEffect(() => {
    function closeVolume(event) {
      if (!event.target?.closest?.(".youtube-volume-control")) setVolumeOpen(false);
    }
    window.addEventListener("pointerdown", closeVolume);
    return () => window.removeEventListener("pointerdown", closeVolume);
  }, []);

  useEffect(() => {
    if (musicProvider !== "youtube") return undefined;
    let cancelled = false;

    async function refreshYouTube() {
      try {
        const response = await fetch("/api/youtube-music/status");
        const result = await readJsonResponse(
          response,
          "YouTube Music status failed",
        );
        if (!cancelled && result.ok && result.available !== false) {
          const nextTitle = String(result.title || "").trim().toLowerCase();
          const nextArtist = String(result.artist || "").trim().toLowerCase();
          const nextDuration = Number(result.duration) || 0;
          const nextTrackKey = `${nextTitle}|${nextArtist}|${nextDuration}`;
          const previousTrackKey = lastYouTubeTrackKeyRef.current;
          const trackChanged =
            Boolean(previousTrackKey) &&
            Boolean(nextTrackKey) &&
            previousTrackKey !== nextTrackKey;
          const normalizedResult = { ...result };
          if (trackChanged) {
            const progress = Number(result.progress) || 0;
            const duration = Number(result.duration) || 0;
            const progressRatio =
              duration > 0 ? progress / duration : 0;
            // If a new song appears with carried-over mid/end progress, reset.
            if (progressRatio > 0.18) {
              normalizedResult.progress = 0;
            }
          }
          lastYouTubeTrackKeyRef.current = nextTrackKey;
          setYoutubeTrack(normalizedResult);
          setYoutubeMusicPlaying(Boolean(result.isPlaying));
          setYoutubeWindowVisible(Boolean(result.visible));
          if (!volumeOpen) {
            setYoutubeVolume(Number.isFinite(result.volume) ? result.volume : readStoredYouTubeVolume());
            setYoutubeMuted(Boolean(result.muted));
          }
        }
      } catch {}
    }

    refreshYouTube();
    const id = setInterval(refreshYouTube, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [musicProvider, volumeOpen]);

  useEffect(() => {
    const wasPlaying = wasYouTubePlayingRef.current;
    const isNowPlaying = youtubeMusicPlaying;

    if (!wasPlaying && isNowPlaying) {
      setKeepYouTubeOpenButtonVisible(true);
      if (openButtonTimerRef.current) {
        clearTimeout(openButtonTimerRef.current);
      }
      openButtonTimerRef.current = setTimeout(() => {
        setKeepYouTubeOpenButtonVisible(false);
      }, 3000);
    } else if (!isNowPlaying) {
      setKeepYouTubeOpenButtonVisible(false);
      if (openButtonTimerRef.current) {
        clearTimeout(openButtonTimerRef.current);
        openButtonTimerRef.current = null;
      }
    }

    wasYouTubePlayingRef.current = isNowPlaying;
  }, [youtubeMusicPlaying]);

  useEffect(
    () => () => {
      if (openButtonTimerRef.current) clearTimeout(openButtonTimerRef.current);
    },
    [],
  );

  // YouTube progress is sourced from backend status polling to avoid drift/stuck
  // behavior at track boundaries and near end-of-track seeks.

  async function runCommand(command) {
    if (!spotifyReady) {
      const deviceReady = await ensureSpotifyDevice();
      if (!deviceReady) {
        setSpotifyError("No Spotify playback device found");
        return;
      }
      setSpotifyReady(true);
    }

    const action =
      command === "toggle"
        ? playback?.is_playing
          ? "pause"
          : "play"
        : command;
    const result = await spotifyCommand(action);
    if (result.status >= 400 && result.status !== 204) {
      setSpotifyError(result.data?.error?.message || "Spotify command failed");
      return;
    }
    setTimeout(refreshPlayback, 500);
  }

  async function toggleShuffle() {
    if (!spotifyReady) {
      const deviceReady = await ensureSpotifyDevice();
      if (!deviceReady) {
        setSpotifyError("No Spotify playback device found");
        return;
      }
      setSpotifyReady(true);
    }

    const nextShuffle = !shuffleEnabled;
    setShuffleEnabled(nextShuffle);
    const result = await setSpotifyShuffle(nextShuffle);
    if (result.status >= 400 && result.status !== 204) {
      setShuffleEnabled(!nextShuffle);
      setSpotifyError(
        result.data?.error?.message || "Spotify shuffle change failed",
      );
      return;
    }
    setTimeout(refreshPlayback, 500);
  }

  async function cycleRepeat() {
    if (!spotifyReady) {
      const deviceReady = await ensureSpotifyDevice();
      if (!deviceReady) {
        setSpotifyError("No Spotify playback device found");
        return;
      }
      setSpotifyReady(true);
    }

    const nextMode = repeatMode === "off" ? "track" : "off";
    setRepeatMode(nextMode);
    const result = await setSpotifyRepeat(nextMode);
    if (result.status >= 400 && result.status !== 204) {
      setRepeatMode(repeatMode);
      setSpotifyError(
        result.data?.error?.message || "Spotify repeat change failed",
      );
      return;
    }
    setTimeout(refreshPlayback, 500);
  }

  async function tryYouTubeMusicRandom() {
    if (youtubeMusicPlaying) {
      setYoutubeTestStatus("Stopping YouTube Music...");
      try {
        const response = await fetch("/api/youtube-music/stop");
        await readJsonResponse(response, "Could not stop YouTube Music");
        setYoutubeMusicPlaying(false);
        setYoutubeTestStatus("YouTube Music stopped");
      } catch (error) {
        setYoutubeTestStatus(error.message || "Could not stop YouTube Music");
      }
      return;
    }

    setYoutubeTestStatus("Opening YouTube Music...");
    try {
      const response = await fetch("/api/youtube-music/play-random");
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("application/json")) {
        throw new Error("Electron app required");
      }
      const result = await readJsonResponse(response, "Playback failed");
      setMusicProvider("youtube");
      setYoutubeTrack(result);
      setYoutubeMusicPlaying(true);
      setYoutubeTestStatus(
        result.title ? `YouTube: ${result.title}` : "YouTube Music started",
      );
    } catch (error) {
      setYoutubeTestStatus(error.message || "YouTube Music needs Electron");
    }
  }

  async function openYouTubeMusic() {
    if (youtubeWindowVisible) {
      setYoutubeTestStatus("Hiding YouTube Music window...");
      try {
        const response = await fetch("/api/youtube-music/hide");
        await readJsonResponse(response, "Could not hide YouTube Music");
        setYoutubeWindowVisible(false);
        setYoutubeTestStatus("YouTube Music hidden");
      } catch (error) {
        setYoutubeTestStatus(error.message || "Could not hide YouTube Music");
      }
      return;
    }

    setYoutubeTestStatus("Opening YouTube Music...");
    try {
      const response = await fetch("/api/youtube-music/open");
      await readJsonResponse(response, "Could not open YouTube Music");
      setYoutubeWindowVisible(true);
      setYoutubeTestStatus("YouTube Music window open");
    } catch (error) {
      setYoutubeTestStatus(error.message || "YouTube Music needs Electron");
    }
  }

  async function runYouTubeCommand(command) {
    if (!youtubeTrack && command === "toggle") {
      await tryYouTubeMusicRandom();
      return;
    }

    try {
      const response = await fetch(
        `/api/youtube-music/control?command=${encodeURIComponent(command)}`,
      );
      const result = await readJsonResponse(
        response,
        "YouTube Music control failed",
      );
      setYoutubeTrack(result);
      setYoutubeMusicPlaying(Boolean(result.isPlaying));
      setYoutubeVolume(Number.isFinite(result.volume) ? result.volume : youtubeVolume);
      setYoutubeMuted(Boolean(result.muted));
      setYoutubeTestStatus(
        result.title ? `YouTube: ${result.title}` : "YouTube Music",
      );
    } catch (error) {
      setYoutubeTestStatus(error.message || "YouTube Music needs Electron");
    }
  }
  async function setYouTubeVolume(value, muted = youtubeMuted) {
    const nextVolume = clamp(Number(value), 0, 100);
    localStorage.setItem(YOUTUBE_VOLUME_KEY, String(nextVolume));
    localStorage.setItem(YOUTUBE_MUTED_KEY, String(Boolean(muted)));
    setYoutubeVolume(nextVolume);
    setYoutubeMuted(Boolean(muted));
    try {
      const response = await fetch(
        `/api/youtube-music/volume?value=${encodeURIComponent(nextVolume)}&muted=${encodeURIComponent(Boolean(muted))}`,
      );
      const result = await readJsonResponse(response, "Volume failed");
      setYoutubeTrack(result);
      setYoutubeVolume(Number.isFinite(result.volume) ? result.volume : nextVolume);
      setYoutubeMuted(Boolean(result.muted));
    } catch (error) {
      setYoutubeTestStatus(error.message || "YouTube Music needs Electron");
    }
  }
  function toggleYouTubeMute() {
    setYouTubeVolume(youtubeVolume, !youtubeMuted);
  }

  async function seekPlayback(event) {
    if (isYouTube) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const position = ratio * duration;

    if (!spotifyReady) {
      const deviceReady = await ensureSpotifyDevice();
      if (!deviceReady) {
        setSpotifyError("No Spotify playback device found");
        return;
      }
      setSpotifyReady(true);
    }

    setDisplayProgress(position);
    setProgressAnchor({
      progress: position,
      at: Date.now(),
      playing: Boolean(playback?.is_playing),
    });
    const result = await seekSpotify(position);
    if (result.status >= 400 && result.status !== 204) {
      setSpotifyError(result.data?.error?.message || "Spotify seek failed");
    }
  }

  async function jumpYouTubeBy(deltaMs) {
    if (!isYouTube) return;
    const currentProgress = Number(youtubeTrack?.progress) || 0;
    const currentDuration = Number(youtubeTrack?.duration) || 0;
    const nextPosition = clamp(currentProgress + deltaMs, 0, currentDuration || 0);
    setYoutubeTrack((current) => ({
      ...(current || {}),
      progress: nextPosition,
      duration: currentDuration || current?.duration || 0,
    }));
    try {
      const response = await fetch(
        `/api/youtube-music/seek?position=${encodeURIComponent(nextPosition)}`,
      );
      const result = await readJsonResponse(response, "YouTube jump failed");
      setYoutubeTrack(result);
      setYoutubeMusicPlaying(Boolean(result.isPlaying));
    } catch (error) {
      setYoutubeTestStatus(error.message || "YouTube Music needs Electron");
    }
  }

  const track = playback?.item;
  const isYouTube = musicProvider === "youtube";
  const title = isYouTube
    ? youtubeTrack?.title || "YouTube Music"
    : track?.name || "Connect Spotify";
  const artist = isYouTube
    ? youtubeTrack?.artist || "Click play to start YouTube Music"
    : track?.artists?.map((item) => item.name).join(", ") ||
      "Login to show current track";
  const album = isYouTube
    ? youtubeTestStatus || youtubeTrack?.album || "YouTube Music ready"
    : track?.album?.name ||
      (configured ? "Playback controls ready" : "Spotify login unavailable");
  const image = isYouTube ? youtubeTrack?.image : track?.album?.images?.[0]?.url;
  const duration = isYouTube
    ? youtubeTrack?.duration || 200000
    : track?.duration_ms || 200000;
  const progress = isYouTube
    ? youtubeTrack?.progress || 0
    : displayProgress || playback?.progress_ms || 0;
  const progressPct = clamp((progress / duration) * 100, 0, 100);
  const remainingMs = Math.max(0, duration - progress);
  const canJumpForwardYouTube = remainingMs > 30000;
  const providerStatus = isYouTube
    ? youtubeTestStatus || youtubeTrack?.album || "YouTube Music ready"
    : spotifyError || album;
  const providerPlaying = isYouTube
    ? youtubeMusicPlaying
    : Boolean(playback?.is_playing);
  const primaryAction = isYouTube
    ? () => runYouTubeCommand("toggle")
    : spotifyLoggedIn
      ? () => runCommand("toggle")
      : loginSpotify;

  return (
    <section
      className={`glass-panel music-panel ${isYouTube ? "youtube-mode" : ""}`}
    >
      <div className="panel-title">
        {isYouTube ? (
          <Youtube className="provider-icon youtube-provider-icon" />
        ) : (
          <img className="spotify-logo" src={spotifyLogo} alt="" />
        )}
        <h2>{isYouTube ? "YOUTUBE" : "SPOTIFY"}</h2>
        {isYouTube && (!youtubeMusicPlaying || keepYouTubeOpenButtonVisible) && (
          <button
            className="youtube-open-button"
            type="button"
            onClick={openYouTubeMusic}
          >
            {youtubeWindowVisible ? "HIDE YT" : "OPEN YT"}
          </button>
        )}
        <button
          className={`provider-toggle ${isYouTube && youtubeMusicPlaying ? "is-hidden" : ""}`}
          type="button"
          aria-label={isYouTube ? "Switch to Spotify" : "Switch to YouTube"}
          title={isYouTube ? "Switch to Spotify" : "Switch to YouTube"}
          onClick={() => setMusicProvider(isYouTube ? "spotify" : "youtube")}
          disabled={isYouTube && youtubeMusicPlaying}
        >
          {isYouTube ? (
            <img className="provider-toggle-logo" src={spotifyLogo} alt="" />
          ) : (
            <Youtube />
          )}
        </button>
        <button
          className="settings-trigger"
          type="button"
          aria-label="Open settings"
          onClick={onOpenSettings}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
      <div className="track-row">
        <div
          className="album-art"
          style={image ? { backgroundImage: `url(${image})` } : undefined}
        >
          {!image && (isYouTube ? "YOUTUBE" : "STARBOY")}
        </div>
        <div className="track-copy">
          <strong>{title}</strong>
          <span>{artist}</span>
          {!isYouTube && <em className="spotify-status">{providerStatus}</em>}
        </div>
        <Heart className="heart" fill="currentColor" />
      </div>
      <div
        className="progress"
        role="slider"
        tabIndex={0}
        aria-label={`${isYouTube ? "YouTube Music" : "Spotify"} progress`}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(progress)}
        onClick={seekPlayback}
        style={{
          "--progress": `${progressPct}%`,
          "--elapsed": `"${formatTime(progress)}"`,
          "--duration": `"${formatTime(duration)}"`,
        }}
      >
        <i />
      </div>
      <div className="music-controls">
        {!isYouTube && (
          <button
            type="button"
            className={`side-control ${shuffleEnabled ? "active" : ""}`}
            aria-label="Toggle shuffle"
            title={shuffleEnabled ? "Shuffle on" : "Shuffle off"}
            onClick={toggleShuffle}
          >
            <Shuffle />
          </button>
        )}
        {isYouTube && (
          <div className="youtube-volume-control">
            <button type="button" className="side-control" aria-label="YouTube Music volume" onClick={() => setVolumeOpen((v) => !v)} onDoubleClick={toggleYouTubeMute}>
              {youtubeMuted || youtubeVolume === 0 ? <VolumeX /> : <Volume2 />}
            </button>
            {volumeOpen && (
              <div className="youtube-volume-popover">
                <button type="button" aria-label="Raise YouTube Music volume" onClick={() => setYouTubeVolume(youtubeVolume + 10, false)}><Plus /></button>
                <strong>{youtubeMuted ? 0 : youtubeVolume}%</strong>
                <button type="button" aria-label="Lower YouTube Music volume" onClick={() => setYouTubeVolume(youtubeVolume - 10, false)}><Minus /></button>
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          aria-label="Previous track"
          onClick={() =>
            isYouTube ? runYouTubeCommand("previous") : runCommand("previous")
          }
        >
          <SkipBack />
        </button>
        <button
          className="primary-control"
          type="button"
          aria-label={providerPlaying ? "Pause" : "Play"}
          onClick={primaryAction}
        >
          {providerPlaying ? (
            <Pause fill="currentColor" />
          ) : (
            <Play fill="currentColor" />
          )}
        </button>
        <button
          type="button"
          aria-label="Next track"
          onClick={() =>
            isYouTube ? runYouTubeCommand("next") : runCommand("next")
          }
        >
          <SkipForward />
        </button>
        {isYouTube && (
          <button
            type="button"
            className="jump-control"
            aria-label="Jump forward 10 seconds"
            title={
              canJumpForwardYouTube
                ? "+10 seconds"
                : "Jump disabled in last 30 seconds"
            }
            disabled={!canJumpForwardYouTube}
            onClick={() => jumpYouTubeBy(10000)}
          >
            +10
          </button>
        )}
        {!isYouTube && (
          <button
            type="button"
            className={`side-control ${repeatMode !== "off" ? "active" : ""}`}
            aria-label="Toggle repeat"
            title={repeatMode === "track" ? "Repeat one" : "Repeat off"}
            onClick={cycleRepeat}
          >
            <Repeat />
          </button>
        )}
      </div>
    </section>
  );
}

function SettingsModal({ onClose, telemetryOnline = false }) {
  const settings = useSettings();
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const spotifyConfigured = Boolean(draft.spotifyClientId?.trim());
  const spotifyLoggedIn = hasSpotifyLogin();

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  function updateField(key, value) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    saveSettings({
      ...DEFAULT_SETTINGS,
      ...draft,
      weatherRegion:
        draft.weatherRegion.trim() || DEFAULT_SETTINGS.weatherRegion,
      dashboardPort:
        draft.dashboardPort.trim() || DEFAULT_SETTINGS.dashboardPort,
      forzaUdpPort: draft.forzaUdpPort.trim() || DEFAULT_SETTINGS.forzaUdpPort,
      forzaUdpForwardPort:
        draft.forzaUdpForwardPort.trim() ||
        DEFAULT_SETTINGS.forzaUdpForwardPort,
      forzaUdpForwardPort2:
        draft.forzaUdpForwardPort2.trim() ||
        DEFAULT_SETTINGS.forzaUdpForwardPort2,
      telemetryWsPort:
        draft.telemetryWsPort.trim() || DEFAULT_SETTINGS.telemetryWsPort,
      spotifyClientId: draft.spotifyClientId.trim(),
      demoDriveMode: telemetryOnline ? false : Boolean(draft.demoDriveMode),
      backgroundColor: normalizeColor(draft.backgroundColor),
    });
    setSaved(true);
    onClose();
  }

  async function logoutAll() {
    logoutSpotify();
    await fetch("/api/youtube-music/logout").catch(() => {});
    window.dispatchEvent(
      new CustomEvent("forzadash:settings", { detail: readSettings() }),
    );
    setSaved(true);
  }

  function resetDefaults() {
    setDraft(DEFAULT_SETTINGS);
    saveSettings(DEFAULT_SETTINGS);
    setSaved(true);
  }

  return (
    <div
      className="settings-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="ForzaDash settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <h2>SETTINGS</h2>
          <button type="button" onClick={onClose} aria-label="Close settings">
            x
          </button>
        </div>
        <div className="settings-grid">
          <label>
            <span>Weather Region</span>
            <input
              value={draft.weatherRegion}
              onChange={(event) =>
                updateField("weatherRegion", event.target.value)
              }
            />
          </label>
          <label>
            <span>Dashboard Port</span>
            <input
              inputMode="numeric"
              value={draft.dashboardPort}
              onChange={(event) =>
                updateField("dashboardPort", event.target.value)
              }
            />
          </label>
          <label>
            <span>Forza UDP Port</span>
            <input
              inputMode="numeric"
              value={draft.forzaUdpPort}
              onChange={(event) =>
                updateField("forzaUdpPort", event.target.value)
              }
            />
          </label>
          <label>
            <span>UDP Forward Port</span>
            <input
              inputMode="numeric"
              value={draft.forzaUdpForwardPort}
              onChange={(event) =>
                updateField("forzaUdpForwardPort", event.target.value)
              }
            />
          </label>
          <label>
            <span>UDP Forward Port 2</span>
            <input
              inputMode="numeric"
              value={draft.forzaUdpForwardPort2}
              onChange={(event) =>
                updateField("forzaUdpForwardPort2", event.target.value)
              }
            />
          </label>
          <label>
            <span>Telemetry WS Port</span>
            <input
              inputMode="numeric"
              value={draft.telemetryWsPort}
              onChange={(event) =>
                updateField("telemetryWsPort", event.target.value)
              }
            />
          </label>
          <label>
            <span>Demo Drive Mode</span>
            <input
              type="checkbox"
              checked={Boolean(draft.demoDriveMode)}
              disabled={telemetryOnline}
              onChange={(event) =>
                updateField("demoDriveMode", event.target.checked)
              }
            />
          </label>
          <label>
            <span>Background Color</span>
            <input
              className="color-input"
              type="color"
              value={normalizeColor(draft.backgroundColor)}
              onChange={(event) =>
                updateField("backgroundColor", event.target.value)
              }
            />
          </label>
        </div>
        <p className="settings-note">
          {saved
            ? "Saved. Port changes apply after restarting the local server/app."
            : "Port changes apply after restarting the local server/app."}
        </p>
        <p className="settings-note">
          Best viewed fullscreen with F11. Tested at 1280x800 with a Logitech
          G29 wheel.
        </p>
        <div className="settings-actions">
          <button type="button" onClick={resetDefaults}>
            Reset
          </button>
          <button
            type="button"
            onClick={loginSpotify}
            disabled={!spotifyConfigured || spotifyLoggedIn}
          >
            {spotifyLoggedIn ? "Spotify Logged In" : "Login Spotify"}
          </button>
          <button type="button" onClick={logoutAll}>
            Clear Data
          </button>
          <button className="primary-settings" type="button" onClick={save}>
            Save Settings
          </button>
        </div>
      </section>
    </div>
  );
}

function WeatherPanel({ weather }) {
  return (
    <section className="glass-panel weather-panel">
      <div className="weather-icon-block">
        <div className="weather-icon-stage">
          <WeatherIcon code={weather.code} size={88} isDay={weather.isDay} />
        </div>
      </div>
      <div className={`weather-now ${weather.error ? "weather-error" : ""}`}>
        <strong>{weather.temperature}°C</strong>
        <span>{weather.description}</span>
        <em>{weather.location}</em>
      </div>
      <div className="forecast">
        {weather.forecast.map((day) => (
          <span key={day.day}>
            <WeatherIcon code={day.code} size={22} />
            <b>{day.day}</b>
            <em>{day.temperature}°C</em>
          </span>
        ))}
      </div>
    </section>
  );
}

function BottomSystems({ telemetry }) {
  const lastTireTempsRef = useRef([52, 52, 50, 50]);
  const lastSuspensionRef = useRef([2.2, 2.2, 2.0, 2.0]);
  const lastTimestampRef = useRef(Date.now());

  const now = Date.now();
  const elapsedSeconds = clamp((now - lastTimestampRef.current) / 1000, 0, 1);
  lastTimestampRef.current = now;

  const tireTemps = (() => {
    const direct = getTireTemps(telemetry);
    if (getTireTempValues(telemetry)) {
      lastTireTempsRef.current = direct.map(parseTireTemp);
      return direct;
    }

    const modeled = updateModeledTireTemps(
      telemetry,
      lastTireTempsRef.current,
      elapsedSeconds,
    );
    lastTireTempsRef.current = modeled;
    return modeled.map(formatTireTemp);
  })();

  const suspensionTravel = (() => {
    const direct = getSuspensionTravel(telemetry);
    if (getSuspensionValues(telemetry)) {
      lastSuspensionRef.current = direct.map(parseSuspensionTravel);
      return direct;
    }

    const modeled = updateModeledSuspensionTravel(
      telemetry,
      lastSuspensionRef.current,
      elapsedSeconds,
    );
    lastSuspensionRef.current = modeled;
    return modeled.map(formatSuspensionTravel);
  })();

  return (
    <section className="bottom-systems glass-panel">
      <SystemCar title="TIRE TEMP" values={tireTemps} visual="image" />
      <SystemCar
        title="SUSPENSION"
        values={suspensionTravel}
        accent="violet"
        visual="image"
        imageSrc={suspensionImage}
      />
      <InputBars telemetry={telemetry} />
      <PowerGraph telemetry={telemetry} />
    </section>
  );
}

function SystemCar({
  title = "",
  values,
  accent = "green",
  visual = "shape",
  imageSrc = carTopView,
}) {
  return (
    <div className={`system-card ${accent}`}>
      {title && <h3>{title}</h3>}
      <div className="car-metrics">
        <span>{values[0]}</span>
        <span>{values[1]}</span>
        {visual === "image" ? (
          <img className="mini-car car-asset" src={imageSrc} alt="" />
        ) : (
          <div className="mini-car" />
        )}
        <span>{values[2]}</span>
        <span>{values[3]}</span>
      </div>
    </div>
  );
}

function PowerGraph({ telemetry }) {
  const graphWindowMs = 9000;
  const [samples, setSamples] = useState(() => [
    { at: Date.now(), power: 0, torque: 0 },
  ]);
  const lastSampleRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    if (now - lastSampleRef.current < 220) return;
    lastSampleRef.current = now;

    const nextSample = {
      at: now,
      power: Math.max(0, telemetry.powerHp || 0),
      torque: Math.max(0, telemetry.torqueNm || 0),
    };

    setSamples((current) => [
      ...current.filter((sample) => now - sample.at <= graphWindowMs),
      nextSample,
    ]);
  }, [telemetry.powerHp, telemetry.torqueNm]);

  const now = Date.now();
  const visibleSamples = samples.filter(
    (sample) => now - sample.at <= graphWindowMs,
  );
  const maxValue = Math.max(
    100,
    600,
    ...visibleSamples.map((sample) => Math.max(sample.power, sample.torque)),
  );
  const scaleMax = Math.ceil(maxValue / 100) * 100;

  function toLivePath(key) {
    if (visibleSamples.length < 2) return "";

    return visibleSamples
      .map((sample, index) => {
        const x = clamp(
          100 - ((now - sample.at) / graphWindowMs) * 100,
          0,
          100,
        );
        const y = clamp(100 - (sample[key] / scaleMax) * 100, 0, 100);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");
  }

  const torquePath = toLivePath("torque");
  const powerPath = toLivePath("power");
  const yLabels = [
    scaleMax,
    Math.round(scaleMax * 0.67),
    Math.round(scaleMax * 0.33),
    0,
  ];

  return (
    <div className="system-card power-graph-card">
      <div className="power-graph-title">
        <h3>LIVE POWER</h3>
        <span className="legend torque">TORQUE (NM)</span>
        <span className="legend power">POWER (HP)</span>
      </div>
      <svg
        className="power-graph"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g className="graph-grid">
          {[20, 40, 60, 80].map((y) => (
            <line key={`h-${y}`} x1="0" y1={y} x2="100" y2={y} />
          ))}
          {[16.67, 33.33, 50, 66.67, 83.33].map((x) => (
            <line key={`v-${x}`} x1={x} y1="0" x2={x} y2="100" />
          ))}
        </g>
        <path className="torque-line active-curve live-curve" d={torquePath} />
        <path className="power-line active-curve live-curve" d={powerPath} />
      </svg>
      <div className="graph-axis x-axis">
        <span>-9s</span>
        <span>-6s</span>
        <span>-3s</span>
        <span>NOW</span>
      </div>
      <div className="graph-axis y-axis-left">
        {yLabels.map((label) => (
          <span key={`torque-${label}`}>{label}</span>
        ))}
      </div>
      <div className="graph-axis y-axis-right">
        {yLabels.map((label) => (
          <span key={`power-${label}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}

function Turbo({ value }) {
  return (
    <div className="system-card turbo-card">
      <h3>TURBO</h3>
      <div className="turbo">
        <i />
        <strong>{value}</strong>
        <span>BAR</span>
      </div>
    </div>
  );
}

function InputBars({ telemetry }) {
  const rows = [
    ["THROTTLE", telemetry.throttle, "#21e78a"],
    ["BRAKE", telemetry.brake, "#ff3d4f"],
    ["CLUTCH", telemetry.clutch, "#25c8ff"],
    ["STEER", Math.abs(telemetry.steer ?? 0) / 1.27, "#8b57ff"],
  ];
  return (
    <div className="system-card input-card">
      <h3>INPUTS</h3>
      {rows.map(([label, value, color]) => (
        <p
          key={label}
          style={{ "--value": `${clamp(value, 0, 100)}%`, "--bar": color }}
        >
          <span>{label}</span>
          <i />
          <strong>{number(value)}%</strong>
        </p>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
