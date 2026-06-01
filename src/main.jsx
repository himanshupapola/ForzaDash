import React, { useCallback, useEffect, useRef, useState } from "react";
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
  Timer,
  Volume2,
  VolumeX,
  Wifi,
  Youtube,
} from "lucide-react";
import forzaLogo from "./assets/forza-logo.png";
import carTopView from "./assets/car.png";
import tiresSuspensionImage from "./assets/Tiers and Suspension.png";
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
import GripMonitorSection from "./components/GripMonitorCard";
import InputBarsSection from "./components/InputBars";
import NavigationSection from "./components/NavigationPanel";
import TireSuspensionSection from "./components/TireSuspensionCard";
import CircularProgressBar from "react-circular-progress";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./styles.css";
import speedometerBg from "../spm.png";
import horizonMap from "../map.jpg";

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
  handBrake: 0,
  steer: 0,
  accelerationX: 0,
  accelerationY: 0,
  accelerationZ: 0,
  rawCount: 0,
  parsedCount: 0,
  lastSender: "-",
};

const SETTINGS_KEY = "forzadash_settings";
const MAP_STATE_KEY = "forzadash_last_map_state";
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
  speedUnit: "kmh",
  backgroundColor: import.meta.env.VITE_BACKGROUND_COLOR || "#000204",
};
const FH6_MAP_IMAGE_SIZE = 6144;
const FH6_MAP_FACTOR_X = -3.5131;
const FH6_MAP_OFFSET_X = -172.55;
const FH6_MAP_FACTOR_Y = 3.512;
const FH6_MAP_OFFSET_Y = 12.86;
const GPS_MAP_ZOOM = 1.82;
const GPS_MAP_CENTER_OFFSET_X = 0;
const GPS_MAP_CENTER_OFFSET_Y = 0;
const GPS_MAP_STYLE = {
  background: "#02080c",
  road: "#edf7fb",
  roadGlow: "#25c8ff",
};

function toDisplaySpeed(speedKmh, speedUnit) {
  const kmh = Number(speedKmh) || 0;
  return speedUnit === "mph" ? kmh * 0.621371 : kmh;
}

function speedUnitLabel(speedUnit) {
  return speedUnit === "mph" ? "MPH" : "KM/H";
}

function worldToMapPoint(telemetry) {
  const worldX = Number(telemetry.positionX);
  const worldY = Number(telemetry.positionZ);
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  if (telemetry.status !== "DEMO" && Number(telemetry.isRaceOn) === 0) {
    return null;
  }
  if (
    telemetry.status !== "DEMO" &&
    Math.abs(worldX) < 0.001 &&
    Math.abs(worldY) < 0.001
  ) {
    return null;
  }

  return {
    x: FH6_MAP_IMAGE_SIZE / 2 - (worldX / FH6_MAP_FACTOR_X + FH6_MAP_OFFSET_X),
    y: FH6_MAP_IMAGE_SIZE / 2 - (worldY / FH6_MAP_FACTOR_Y + FH6_MAP_OFFSET_Y),
  };
}

function readStoredMapState() {
  try {
    const stored = JSON.parse(localStorage.getItem(MAP_STATE_KEY) || "null");
    const point = stored?.point;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return null;
    }
    return {
      point: {
        x: clamp(point.x, 0, FH6_MAP_IMAGE_SIZE),
        y: clamp(point.y, 0, FH6_MAP_IMAGE_SIZE),
      },
      yaw: Number.isFinite(stored.yaw) ? stored.yaw : 0,
      speed: Number.isFinite(stored.speed) ? stored.speed : 0,
      hasPosition: true,
    };
  } catch {
    return null;
  }
}

function storeMapState(mapState) {
  try {
    localStorage.setItem(
      MAP_STATE_KEY,
      JSON.stringify({
        point: mapState.point,
        yaw: mapState.yaw,
        speed: mapState.speed,
      }),
    );
  } catch {
    // Best effort only; minimap should still work if storage is unavailable.
  }
}

function createDemoTelemetry(frame) {
  const t = frame / 10;
  const speedKmh = clamp(
    82 + Math.sin(t * 0.34) * 46 + Math.sin(t * 0.1) * 18,
    0,
    248,
  );
  const maxRpm = 8600;
  const rpm = clamp(
    1500 + speedKmh * 36 + Math.sin(t * 1.45) * 520,
    900,
    maxRpm,
  );
  const gear = clamp(Math.floor(speedKmh / 34) + 1, 1, 7);
  const throttle = clamp(46 + Math.sin(t * 1.1) * 36, 4, 100);
  const brake = clamp(Math.sin(t * 0.7 + 0.8) > 0.82 ? 22 : 0, 0, 100);
  const clutch = clamp(Math.sin(t * 0.45 + 1.7) * 8 + 6, 0, 32);
  const handBrakePulse = Math.max(0, Math.sin(t * 0.52 + 2.4) - 0.62) / 0.38;
  const handBrake = clamp(handBrakePulse ** 1.8 * 210, 0, 255);
  const boostBar = clamp(
    0.2 + throttle * 0.015 + Math.sin(t * 2.1) * 0.09,
    0,
    2,
  );
  const rpmRatio = clamp(rpm / maxRpm, 0, 1);
  const torqueCurve =
    Math.sin(rpmRatio * Math.PI) * 0.64 + Math.max(0, 0.58 - rpmRatio) * 0.18;
  const torqueNm = clamp(
    140 + torqueCurve * 360 + throttle * 0.55,
    95,
    560,
  );
  const powerHp = clamp(
    80 + rpmRatio ** 1.25 * 680 + throttle * 0.9,
    70,
    820,
  );
  const gripDemo = (Math.sin(t * 0.72) + 1) / 2;
  const demoGripIndex = clamp(10 + gripDemo * 90, 10, 100);
  const demoSlip = clamp((100 - demoGripIndex) / 80, 0, 1.125);
  const frontSlip = clamp(demoSlip * (0.82 + Math.abs(Math.sin(t * 0.9)) * 0.34), 0, 1.4);
  const rearSlip = clamp(demoSlip * (0.72 + Math.abs(Math.cos(t * 0.78)) * 0.44), 0, 1.4);

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
    handBrake,
    steer: Math.round(Math.sin(t * 0.8) * 68),
    accelerationX: Math.sin(t * 1.22) * 3.3,
    accelerationY: Math.sin(t * 0.4) * 0.9,
    accelerationZ: Math.cos(t * 1.02) * 2.1,
    tireCombinedSlipFrontLeft: frontSlip,
    tireCombinedSlipFrontRight: frontSlip,
    tireCombinedSlipRearLeft: rearSlip,
    tireCombinedSlipRearRight: rearSlip,
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
    const frameIntervalMs = 1000 / 45;

    function tick(now) {
      if (now - lastFrame < frameIntervalMs) {
        frameId = requestAnimationFrame(tick);
        return;
      }
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

function useSmoothedNumber(target, options = {}) {
  const { responsiveness = 8, rateLimit = 9999, minStep = 0.01 } = options;
  const valueRef = useRef(Number(target) || 0);
  const timeRef = useRef(Date.now());
  const [, forceFrame] = useState(0);

  useEffect(() => {
    let frameId = 0;

    function tick() {
      const now = Date.now();
      const dt = clamp((now - timeRef.current) / 1000, 0.016, 0.08);
      timeRef.current = now;
      const current = valueRef.current;
      const nextTarget = Number(target) || 0;
      const alpha = 1 - Math.exp(-responsiveness * dt);
      const delta = clamp(
        (nextTarget - current) * alpha,
        -rateLimit * dt,
        rateLimit * dt,
      );
      const next = Math.abs(nextTarget - current) <= minStep ? nextTarget : current + delta;

      if (Math.abs(next - current) > 0.001) {
        valueRef.current = next;
        forceFrame((frame) => frame + 1);
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [minStep, rateLimit, responsiveness, target]);

  return valueRef.current;
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
  ].some(
    (value) =>
      Number.isFinite(Number(value)) && Math.abs(Number(value)) > 0.001,
  );
}

function calculateDriftAngle(telemetry) {
  const lateral = Number(telemetry.velocityX) || 0;
  const forward = Number(telemetry.velocityZ) || 0;
  const speed = Math.hypot(lateral, forward);
  if (speed >= 3) {
    return clamp(
      Math.round(
        Math.abs(Math.atan2(lateral, Math.abs(forward))) * (180 / Math.PI),
      ),
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
    longitudinal: clamp(
      (Number(telemetry.accelerationZ) || 0) / 9.80665,
      -3,
      3,
    ),
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

function useUpdateInfo() {
  const [updateInfo, setUpdateInfo] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/update-check");
        const data = await response.json();
        if (!cancelled) setUpdateInfo(data);
      } catch {
        if (!cancelled) setUpdateInfo(null);
      }
    }
    load();
    const id = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  return updateInfo;
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
  const updateInfo = useUpdateInfo();
  const hardwareTemperature = useHardwareTemperature();
  const clock = useClock();
  const demoFrameRef = useRef(0);
  const lastLiveTelemetryRef = useRef(null);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

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
  const speed = Math.round(
    useSmoothedNumber(toDisplaySpeed(smoothTelemetry.speedKmh, settings.speedUnit), {
      responsiveness: 7.5,
      rateLimit: settings.speedUnit === "mph" ? 90 : 145,
      minStep: 0.08,
    }),
  );
  const stableGearRef = useRef(1);
  stableGearRef.current = normalizeGear(telemetry.gear, stableGearRef.current);
  const gear = formatGear(stableGearRef.current);
  if (
    online &&
    smoothTelemetry?.positionX != null &&
    smoothTelemetry?.positionZ != null
  ) {
    lastLiveTelemetryRef.current = smoothTelemetry;
  }
  const mapTelemetry = lastLiveTelemetryRef.current || smoothTelemetry;

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
        updateInfo={updateInfo}
      />
      <section className="main-grid">
        <aside className="left-stack">
          <TelemetryPanel
            telemetry={smoothTelemetry}
            gear={gear}
            speedUnit={settings.speedUnit}
          />
          <section className="glass-panel navigation-spacer-card">
            <PowerGraph telemetry={smoothTelemetry} />
          </section>
          <NavigationSection telemetry={mapTelemetry} online={online} />
        </aside>
        <CenterDial
          telemetry={smoothTelemetry}
          speed={speed}
          gear={gear}
          speedUnit={settings.speedUnit}
          rpmRatio={rpmRatio}
          hardwareTemperature={hardwareTemperature}
        />
        <aside className="right-stack">
          <MusicPanel onOpenSettings={openSettings} />
        </aside>
      </section>
      <BottomSystems telemetry={smoothTelemetry} />
      {settingsOpen && (
        <SettingsModal
          onClose={closeSettings}
          telemetryOnline={Boolean(online)}
        />
      )}
    </main>
  );
}

const TopBar = React.memo(function TopBar({
  online,
  telemetryStatus,
  weather,
  clock,
  updateInfo,
}) {
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
          {updateInfo?.updateAvailable && (
            <em>
              <a
                href={updateInfo.releaseUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#31b8ee", textDecoration: "none" }}
              >
                Update v{updateInfo.latestVersion} available
              </a>
            </em>
          )}
        </div>
      </div>
    </header>
  );
});

const LiveMapPanel = React.memo(function LiveMapPanel({ telemetry, online }) {
  const driveStatsRef = useRef({
    lastAt: Date.now(),
    minutes: 0,
    distanceKm: 0,
  });
  const lastMapStateRef = useRef(
    readStoredMapState() || {
      point: null,
      yaw: 0,
      speed: 0,
      hasPosition: false,
    },
  );
  const point = worldToMapPoint(telemetry);
  const liveYaw = Number(telemetry.yaw);
  const liveSpeed = Math.round(Number(telemetry.speedKmh) || 0);
  const liveHasPosition = Boolean(point);

  if (liveHasPosition) {
    lastMapStateRef.current = {
      point,
      yaw: Number.isFinite(liveYaw) ? liveYaw : lastMapStateRef.current.yaw,
      speed: liveSpeed,
      hasPosition: true,
    };
    storeMapState(lastMapStateRef.current);
  }

  const mapState = lastMapStateRef.current;
  const yaw = mapState.yaw;
  const speed = mapState.hasPosition ? mapState.speed : liveSpeed;
  const hasPosition = mapState.hasPosition;
  const mapPoint = mapState.point;
  const mapX = mapPoint
    ? clamp(mapPoint.x, 0, FH6_MAP_IMAGE_SIZE)
    : FH6_MAP_IMAGE_SIZE / 2;
  const mapY = mapPoint
    ? clamp(mapPoint.y, 0, FH6_MAP_IMAGE_SIZE)
    : FH6_MAP_IMAGE_SIZE / 2;
  const centeredMapX = clamp(
    mapX + GPS_MAP_CENTER_OFFSET_X,
    0,
    FH6_MAP_IMAGE_SIZE,
  );
  const centeredMapY = clamp(
    mapY + GPS_MAP_CENTER_OFFSET_Y,
    0,
    FH6_MAP_IMAGE_SIZE,
  );
  const mapRotation = Number.isFinite(yaw) ? -yaw : 0;
  const headingDeg = Number.isFinite(yaw) ? yaw * (180 / Math.PI) : 0;
  const now = Date.now();
  const elapsedSeconds = clamp(
    (now - driveStatsRef.current.lastAt) / 1000,
    0,
    2,
  );
  driveStatsRef.current.lastAt = now;
  if (online && hasPosition && speed > 1) {
    driveStatsRef.current.minutes += elapsedSeconds / 60;
    driveStatsRef.current.distanceKm += (speed / 3600) * elapsedSeconds;
  }
  const driveMinutes = Math.floor(driveStatsRef.current.minutes);
  const drivenKm = driveStatsRef.current.distanceKm.toFixed(1);

  return (
    <section className="glass-panel live-map-panel">
      <div
        className="live-map"
        style={{
          "--gps-bg": GPS_MAP_STYLE.background,
          "--gps-road": GPS_MAP_STYLE.road,
          "--gps-road-glow": GPS_MAP_STYLE.roadGlow,
        }}
      >
        <div className="minimap-title">
          <strong>NAVIGATION</strong>
        </div>
        <div
          className="live-map-world"
          style={{
            transform: `rotate(${mapRotation}rad) scale(${GPS_MAP_ZOOM})`,
            "--map-x": `${centeredMapX}px`,
            "--map-y": `${centeredMapY}px`,
          }}
        >
          <img
            src={horizonMap}
            alt=""
            style={{
              transform: `translate(-${centeredMapX}px, -${centeredMapY}px)`,
            }}
          />
        </div>
        <div
          className={`live-map-marker ${online && hasPosition ? "active" : ""}`}
          style={{ transform: "translate(-50%, -50%)" }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24">
            <path d="M11.7 1.6 21.9 22.1 12.1 17.4 3 22.3 11.7 1.6Z" />
          </svg>
        </div>
        <div className="live-map-vignette" />
        <div className="navigation-stats">
          <span>
            <Timer size={16} /> {driveMinutes} min
          </span>
          <span>{drivenKm} km</span>
        </div>
      </div>
    </section>
  );
});

const TelemetryPanel = React.memo(function TelemetryPanel({
  telemetry,
  gear,
  speedUnit,
}) {
  return <section className="glass-panel telemetry-panel" aria-hidden="true" />;
});

const PowerStatsPanel = React.memo(function PowerStatsPanel({ telemetry }) {
  return <section className="glass-panel power-stats-panel" aria-hidden="true" />;
});

function MiniStat({ label, value, unit, fill = 0 }) {
  return (
    <div
      className="mini-stat"
      style={{ "--stat-fill": `${fill * 100}%`, "--stat-alpha": fill }}
    >
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit || label}</small>
      </strong>
    </div>
  );
}

const GForceMeterCanvas = React.memo(function GForceMeterCanvas({
  lateral = 0,
  longitudinal = 0,
}) {
  const canvasRef = useRef(null);
  const historyRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssSize = 132;
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const maxG = 2;
    const gx = clamp(lateral, -maxG, maxG);
    const gz = clamp(longitudinal, -maxG, maxG);
    const history = historyRef.current;
    history.push({ x: gx, z: gz });
    if (history.length > 46) history.shift();

    const size = cssSize;
    const center = size / 2;
    const scale = (size / 2 - 14) / maxG;

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "rgba(1, 8, 13, 0.52)";
    ctx.beginPath();
    ctx.arc(center, center, center - 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(120, 205, 255, 0.12)";
    ctx.lineWidth = 1;
    [0.5, 1, 1.5, 2].forEach((ring) => {
      ctx.beginPath();
      ctx.arc(center, center, ring * scale, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.strokeStyle = "rgba(120, 205, 255, 0.16)";
    ctx.beginPath();
    ctx.moveTo(9, center);
    ctx.lineTo(size - 9, center);
    ctx.moveTo(center, 9);
    ctx.lineTo(center, size - 9);
    ctx.stroke();

    if (history.length > 1) {
      const drawThread = (width, alpha, blur) => {
        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = width;
        ctx.shadowBlur = blur;
        ctx.shadowColor = `rgba(24, 215, 255, ${alpha})`;
        for (let index = 0; index < history.length - 1; index += 1) {
          const point = history[index];
          const next = history[index + 1];
          const age = (index + 1) / history.length;
          const opacity = Math.pow(age, 1.9) * alpha;
          const x1 = center + point.x * scale;
          const y1 = center - point.z * scale;
          const x2 = center + next.x * scale;
          const y2 = center - next.z * scale;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          ctx.strokeStyle = `rgba(24, 215, 255, ${opacity})`;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(midX, midY, x2, y2);
          ctx.stroke();
        }
        ctx.restore();
      };

      drawThread(5, 0.18, 10);
      drawThread(2.4, 0.72, 4);

      for (let index = 0; index < history.length; index += 4) {
        const point = history[index];
        const age = (index + 1) / history.length;
        const opacity = Math.pow(age, 2) * 0.28;
        ctx.fillStyle = `rgba(24, 215, 255, ${opacity})`;
        ctx.beginPath();
        ctx.arc(center + point.x * scale, center - point.z * scale, 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const dotX = center + gx * scale;
    const dotY = center - gz * scale;
    const glow = ctx.createRadialGradient(dotX, dotY, 1, dotX, dotY, 15);
    glow.addColorStop(0, "rgba(255, 47, 98, 0.96)");
    glow.addColorStop(0.34, "rgba(255, 47, 98, 0.38)");
    glow.addColorStop(1, "rgba(255, 47, 98, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ff2f62";
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }, [lateral, longitudinal]);

  return <canvas ref={canvasRef} aria-hidden="true" />;
});

const CenterDial = React.memo(function CenterDial({
  telemetry,
  speed,
  gear,
  hardwareTemperature,
  speedUnit,
}) {
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
  const driveGearRatio =
    Number.isFinite(gearNumber) && gearNumber > 0
      ? clamp(speed / Math.max(gearMaxSpeed, 1), 0, 1)
      : 0;
  const rpmNeedleRatio = speed > 4 || throttleRatio > 0.08 ? liveRpmRatio : 0;
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
  const speedGlowProgress = forceFullSpeedGlow ? 100 : glowFillRatio * 100;
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
  const packetGForce = Math.hypot(
    packetForces.lateral || 0,
    packetForces.longitudinal || 0,
  );
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
  const driftAngle = calculateDriftAngle(telemetry);
  const realTempValue = getTelemetryValue(
    telemetry,
    ["engineTemp", "coolantTemp", "temp", "temperature"],
    null,
  );
  const derivedTempTarget = clamp(
    82 +
      clamp(telemetry.throttle || 0, 0, 100) * 0.14 +
      liveRpmRatio * 18 +
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
  const rpmReadout = Math.max(0, Math.round(telemetry.rpm || 0))
    .toString()
    .padStart(4, "0");
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
          <em>{speedUnitLabel(speedUnit)}</em>
        </div>
        <div className="dial-lower">
          <div className="lower-g-meter">
            <div className="lower-g-grid">
              <GForceMeterCanvas
                lateral={lastGForceRef.current.lateral}
                longitudinal={lastGForceRef.current.longitudinal}
              />
            </div>
            <span>G-FORCE</span>
          </div>

          <div className="lower-center">
            <div className={`lower-gear ${reverseGear ? "is-reverse" : ""}`}>
              <strong>{gear}</strong>
              <span>GEAR</span>
            </div>
            <div
              className="lower-rpm"
              style={{ "--rpm-ratio": liveRpmRatio }}
            >
              <strong>{rpmReadout} RPM</strong>
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
});

const MusicPanel = React.memo(function MusicPanel({ onOpenSettings }) {
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
  const youtubeActionLocksRef = useRef({});
  const [youtubeVolume, setYoutubeVolume] = useState(readStoredYouTubeVolume);
  const [youtubeMuted, setYoutubeMuted] = useState(readStoredYouTubeMuted);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState("off");

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
      if (!event.target?.closest?.(".youtube-volume-control"))
        setVolumeOpen(false);
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
          setYoutubeTrack(result);
          setYoutubeMusicPlaying(Boolean(result.isPlaying));
          setYoutubeWindowVisible(Boolean(result.visible));
          if (!volumeOpen) {
            setYoutubeVolume(
              Number.isFinite(result.volume)
                ? result.volume
                : readStoredYouTubeVolume(),
            );
            setYoutubeMuted(Boolean(result.muted));
          }
        }
      } catch {}
    }

    refreshYouTube();
    const intervalMs =
      youtubeMusicPlaying || youtubeWindowVisible ? 1000 : 2500;
    const id = setInterval(refreshYouTube, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [musicProvider, volumeOpen, youtubeMusicPlaying, youtubeWindowVisible]);

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

  const youtubeActionCooldowns = {
    jump: 450,
    "command-next": 450,
    "command-previous": 450,
    "command-shuffle": 450,
    "command-repeat": 450,
    "command-toggle": 650,
    "play-toggle": 650,
    "window-toggle": 700,
    volume: 250,
  };

  function lockYouTubeAction(key) {
    if (youtubeActionLocksRef.current[key]) return false;
    youtubeActionLocksRef.current[key] = true;
    setTimeout(() => {
      delete youtubeActionLocksRef.current[key];
    }, youtubeActionCooldowns[key] || 450);
    return true;
  }

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
    if (!lockYouTubeAction("play-toggle")) return;
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
    if (!lockYouTubeAction("window-toggle")) return;
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
    if (!lockYouTubeAction(`command-${command}`)) return;
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
      setYoutubeVolume(
        Number.isFinite(result.volume) ? result.volume : youtubeVolume,
      );
      setYoutubeMuted(Boolean(result.muted));
      setYoutubeTestStatus(
        result.title ? `YouTube: ${result.title}` : "YouTube Music",
      );
    } catch (error) {
      setYoutubeTestStatus(error.message || "YouTube Music needs Electron");
    }
  }
  async function setYouTubeVolume(value, muted = youtubeMuted) {
    if (!lockYouTubeAction("volume")) return;
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
      setYoutubeVolume(
        Number.isFinite(result.volume) ? result.volume : nextVolume,
      );
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
    if (!lockYouTubeAction("jump")) return;
    const currentProgress = Number(youtubeTrack?.progress) || 0;
    const currentDuration = Number(youtubeTrack?.duration) || 0;
    const nextPosition = clamp(
      currentProgress + deltaMs,
      0,
      currentDuration || 0,
    );
    setYoutubeTrack((current) => ({
      ...(current || {}),
      progress: nextPosition,
      duration: currentDuration || current?.duration || 0,
    }));
    try {
      const response = await fetch(
        `/api/youtube-music/jump?delta=${encodeURIComponent(deltaMs)}`,
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
  const image = isYouTube
    ? youtubeTrack?.image
    : track?.album?.images?.[0]?.url;
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
        {isYouTube &&
          (!youtubeMusicPlaying || keepYouTubeOpenButtonVisible) && (
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
      <div className="progress-wrap">
        <div
          className={`progress ${isYouTube ? "is-readonly" : ""}`}
          role="slider"
          tabIndex={0}
          aria-label={`${isYouTube ? "YouTube Music" : "Spotify"} progress`}
          aria-disabled={isYouTube ? "true" : undefined}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(progress)}
          onClick={seekPlayback}
          style={{
            "--progress": `${progressPct}%`,
          }}
        >
          <i />
        </div>
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
            <button
              type="button"
              className="side-control"
              aria-label="YouTube Music volume"
              onClick={() => setVolumeOpen((v) => !v)}
              onDoubleClick={toggleYouTubeMute}
            >
              {youtubeMuted || youtubeVolume === 0 ? <VolumeX /> : <Volume2 />}
            </button>
            {volumeOpen && (
              <div className="youtube-volume-popover">
                <button
                  type="button"
                  aria-label="Raise YouTube Music volume"
                  onClick={() => setYouTubeVolume(youtubeVolume + 10, false)}
                >
                  <Plus />
                </button>
                <strong>{youtubeMuted ? 0 : youtubeVolume}%</strong>
                <button
                  type="button"
                  aria-label="Lower YouTube Music volume"
                  onClick={() => setYouTubeVolume(youtubeVolume - 10, false)}
                >
                  <Minus />
                </button>
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
});

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
            <span>Speed Unit</span>
            <select
              value={draft.speedUnit || "kmh"}
              onChange={(event) => updateField("speedUnit", event.target.value)}
            >
              <option value="kmh">KM/H</option>
              <option value="mph">MPH</option>
            </select>
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

const WeatherPanel = React.memo(function WeatherPanel({ weather }) {
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
});

const BottomSystems = React.memo(function BottomSystems({ telemetry }) {
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
    <section className="bottom-area" aria-label="Dashboard widgets">
      <TireSuspensionSection
        tireTemps={tireTemps}
        suspensionTravel={suspensionTravel}
        imageSrc={tiresSuspensionImage}
      />
      <InputBarsSection telemetry={telemetry} />
      <GripMonitorSection telemetry={telemetry} />
    </section>
  );
});

function TireSuspensionCard({
  className = "",
  tireTemps,
  suspensionTravel,
  imageSrc,
}) {
  const corners = ["FL", "FR", "RL", "RR"];

  return (
    <div className={`glass-panel system-card tire-suspension-card ${className}`}>
      <h3>TIRES & SUSPENSION</h3>
      <div className="tire-suspension-layout">
        {corners.map((corner, index) => {
          const tireTemp = parseTireTemp(tireTemps[index]);
          const tempRatio = clamp((normalizeDisplayTireTemp(tireTemp) - 55) / 65, 0, 1);
          const tireHue = 122 - tempRatio * 102;
          const suspension = parseSuspensionTravel(suspensionTravel[index]);
          const suspensionRatio = clamp(suspension / 3, 0, 1);

          return (
            <div
              className={`wheel-readout wheel-${corner.toLowerCase()}`}
              key={corner}
              style={{
                "--temp-fill": tempRatio,
                "--tire-hue": tireHue,
                "--susp-fill": `${suspensionRatio * 100}%`,
              }}
            >
              <span className="wheel-label">{corner}</span>
              <div className="tire-block">
                <strong>{tireTemps[index]}</strong>
              </div>
              <div className="suspension-readout">
                <span>SUSP:</span>
                <em>{suspensionTravel[index]}</em>
                <i />
                <small>{number(suspensionRatio * 100)}%</small>
              </div>
            </div>
          );
        })}
        <div className="systems-car-slot">
          <img className="systems-car-image" src={imageSrc} alt="" />
        </div>
      </div>
    </div>
  );
}

function GripMonitorCard({ telemetry }) {
  const fallbackSlip = (() => {
    const throttle = clamp((telemetry.throttle || 0) / 255, 0, 1);
    const brake = clamp((telemetry.brake || 0) / 255, 0, 1);
    const steer = clamp(Math.abs(telemetry.steer || 0) / 127, 0, 1);
    return [
      brake * 0.55 + steer * 0.28,
      brake * 0.55 + steer * 0.28,
      throttle * 0.48 + steer * 0.22,
      throttle * 0.48 + steer * 0.22,
    ];
  })();
  const slipValues = [
    getTelemetryValue(telemetry, ["TireCombinedSlipFrontLeft", "tireCombinedSlipFrontLeft", "slipFL"], fallbackSlip[0]),
    getTelemetryValue(telemetry, ["TireCombinedSlipFrontRight", "tireCombinedSlipFrontRight", "slipFR"], fallbackSlip[1]),
    getTelemetryValue(telemetry, ["TireCombinedSlipRearLeft", "tireCombinedSlipRearLeft", "slipRL"], fallbackSlip[2]),
    getTelemetryValue(telemetry, ["TireCombinedSlipRearRight", "tireCombinedSlipRearRight", "slipRR"], fallbackSlip[3]),
  ].map((value) => Math.max(0, Number(value) || 0));
  const frontSlipPct = clamp(Math.round(((slipValues[0] + slipValues[1]) / 2) * 100), 0, 100);
  const rearSlipPct = clamp(Math.round(((slipValues[2] + slipValues[3]) / 2) * 100), 0, 100);
  const maxSlip = Math.max(...slipValues);
  const wheelspinPct = maxSlip > 1 ? clamp(Math.round(((maxSlip - 1) / 1.5) * 100), 0, 100) : 0;
  const avgSlip = slipValues.reduce((sum, value) => sum + value, 0) / slipValues.length;
  const gripIndex = clamp(Math.round(100 - avgSlip * 80), 0, 100);
  const status = gripIndex < 40 ? "NO CONTROL" : gripIndex < 85 ? "SLIPPING" : "PERFECT";
  const statusClass = gripIndex < 40 ? "danger" : gripIndex < 85 ? "warn" : "good";
  const rows = [
    ["FRONT SLIP", frontSlipPct],
    ["REAR SLIP", rearSlipPct],
    ["WHEELSPIN", wheelspinPct],
  ];

  return (
    <div className="glass-panel system-card grip-monitor-card">
      <div className="grip-monitor-body">
        <div
          className={`grip-index ${statusClass}`}
          style={{ "--grip-value": gripIndex }}
        >
          <GripRing value={gripIndex} />
        </div>
        <div className="grip-slip-list">
          {rows.map(([label, value]) => (
            <div className="grip-slip-row" key={label} style={{ "--slip": `${value}%` }}>
              <span>{label}</span>
              <i><em /></i>
              <strong>{value}%</strong>
            </div>
          ))}
        </div>
      </div>
      <div className={`grip-status ${statusClass}`}>
        <span>STATUS</span>
        <strong>{status}</strong>
        <em>{status === "PERFECT" ? "OPTIMAL TRACTION" : "TRACTION ACTIVE"}</em>
      </div>
    </div>
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
    <div className={`glass-panel system-card ${accent}`}>
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

const PowerGraph = React.memo(function PowerGraph({ telemetry }) {
  const graphWindowMs = 9000;
  const [samples, setSamples] = useState(() => [
    { at: Date.now(), power: 0, torque: 0 },
  ]);
  const lastSampleRef = useRef(0);
  const smoothSampleRef = useRef({ power: 0, torque: 0 });

  useEffect(() => {
    const now = Date.now();
    if (now - lastSampleRef.current < 90) return;
    lastSampleRef.current = now;

    const targetPower = Math.max(0, telemetry.powerHp || 0);
    const targetTorque = Math.max(0, telemetry.torqueNm || 0);
    const previous = smoothSampleRef.current;
    const nextPower = previous.power + (targetPower - previous.power) * 0.34;
    const nextTorque = previous.torque + (targetTorque - previous.torque) * 0.34;
    smoothSampleRef.current = { power: nextPower, torque: nextTorque };

    const nextSample = {
      at: now,
      power: nextPower,
      torque: nextTorque,
    };

    setSamples((current) => [
      ...current.filter((sample) => now - sample.at <= graphWindowMs + 1400),
      nextSample,
    ]);
  }, [telemetry.powerHp, telemetry.torqueNm]);

  const now = Date.now();
  const visibleSamples = samples.filter(
    (sample) => now - sample.at <= graphWindowMs + 900,
  );
  const maxValue = Math.max(
    100,
    600,
    ...visibleSamples.map((sample) => Math.max(sample.power, sample.torque)),
  );
  const scaleMax = Math.ceil(maxValue / 100) * 100;
  const chartData = visibleSamples.map((sample) => ({
    t: -((now - sample.at) / 1000),
    torque: sample.torque,
    power: sample.power,
  }));
  if (chartData.length > 0) {
    const latestSample = chartData[chartData.length - 1];
    chartData.push({
      ...latestSample,
      t: 0,
    });
  }
  const latestTorque = Math.max(0, Math.round(telemetry.torqueNm || 0));
  const latestPower = Math.max(0, Math.round(telemetry.powerHp || 0));
  return (
    <div className="system-card power-graph-card">
      <div className="power-graph-title">
        <h3>POWER & TORQUE</h3>
        <div className="power-current">
          <span className="power-current-torque">
            ✦ {latestTorque} <small>NM</small>
          </span>
          <span className="power-current-hp">
            ✦ {latestPower} <small>HP</small>
          </span>
        </div>
      </div>
      <div className="power-graph" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 4, left: 0, bottom: 4 }}
          >
            <defs>
              <linearGradient id="torqueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ff1f3d" stopOpacity={0.42} />
                <stop offset="92%" stopColor="#ff1f3d" stopOpacity={0.035} />
              </linearGradient>
              <linearGradient id="powerFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#31b8ff" stopOpacity={0.34} />
                <stop offset="92%" stopColor="#31b8ff" stopOpacity={0.025} />
              </linearGradient>
            </defs>
            <CartesianGrid
              stroke="rgba(92,145,170,0.14)"
              strokeDasharray="3 7"
              vertical={false}
            />
            <XAxis
              dataKey="t"
              type="number"
              domain={[-9.35, 0.35]}
              hide
              allowDataOverflow
            />
            <YAxis domain={[0, scaleMax]} hide />
            <Tooltip content={() => null} cursor={false} />
            <Area
              type="natural"
              dataKey="torque"
              stroke="#ff1f3d"
              fill="url(#torqueFill)"
              strokeWidth={2.4}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Area
              type="natural"
              dataKey="power"
              stroke="#31b8ff"
              fill="url(#powerFill)"
              strokeWidth={2.4}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="graph-axis x-axis">
        <span>-9s</span>
        <span>-6s</span>
        <span>-3s</span>
        <span>NOW</span>
      </div>
    </div>
  );
});

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

const InputBars = React.memo(function InputBars({ telemetry }) {
  const rows = [
    ["THROTTLE", telemetry.throttle, "#21e78a", 255],
    ["BRAKE", telemetry.brake, "#ff3d4f", 255],
    ["CLUTCH", telemetry.clutch, "#25c8ff", 255],
    ["HANDBRAKE", telemetry.handBrake, "#ff9b2f", 255],
  ];
  const steer = clamp(telemetry.steer ?? 0, -127, 127);
  const steerPercent = Math.abs(steer / 127) * 100;
  const steerLabel = `${number(steerPercent)}%`;
  return (
    <div className="glass-panel system-card input-card">
      <h3>INPUTS</h3>
      {rows.map(([label, value, color, max]) => {
        const percent = clamp(((Number(value) || 0) / max) * 100, 0, 100);
        return (
          <p
            key={label}
            style={{
              "--value": `${percent}%`,
              "--bar": color,
            }}
          >
            <span>{label}</span>
            <i />
            <strong>{number(percent)}%</strong>
          </p>
        );
      })}
      <p
        className="steer-input"
        style={{
          "--steer": `${50 + (steer / 127) * 50}%`,
          "--steer-left": steer < 0 ? `${steerPercent / 2}%` : "0%",
          "--steer-right": steer > 0 ? `${steerPercent / 2}%` : "0%",
        }}
      >
        <span>STEER</span>
        <i />
        <strong>{steerLabel}</strong>
      </p>
    </div>
  );
});

createRoot(document.getElementById("root")).render(<App />);
