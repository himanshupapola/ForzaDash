import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Car,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  Radio,
  Settings,
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
import carTopView from "./assets/car-small.png";
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
import speedometerBg from "./assets/speedometer-bg.jpg";

const DEFAULT_DEVELOPER_MODE = import.meta.env.VITE_DEVELOPER_MODE === "true";
let rendererDeveloperMode = DEFAULT_DEVELOPER_MODE;

function reportRendererLog(message) {
  if (!rendererDeveloperMode) return;
  fetch("/api/renderer-log", {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: String(message).slice(0, 4000),
  }).catch(() => {});
}

function reportClientEvent(name, data = {}, level = "info") {
  reportRendererLog(
    JSON.stringify({
      source: "frontend",
      name,
      level,
      at: new Date().toISOString(),
      page: window.location.href,
      userAgent: navigator.userAgent,
      data,
    }),
  );
}

window.addEventListener("error", (event) => {
  reportClientEvent(
    "ERROR",
    {
      message: event.message || "unknown",
      source: event.filename || "-",
      line: event.lineno || 0,
      column: event.colno || 0,
      stack: event.error?.stack || "-",
    },
    "error",
  );
});

window.addEventListener("unhandledrejection", (event) => {
  reportClientEvent(
    "UNHANDLED_REJECTION",
    {
      reason:
        event.reason?.stack || event.reason?.message || String(event.reason),
    },
    "error",
  );
});

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
const MUSIC_PROVIDER_KEY = "forzadash_music_provider";
const YOUTUBE_VOLUME_KEY = "forzadash_youtube_volume";
const YOUTUBE_MUTED_KEY = "forzadash_youtube_muted";
const NAVIGATION_ONLY_ZOOM_KEY = "forzadash_navigation_only_zoom";
const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
const DEFAULT_NAVIGATION_ONLY_ZOOM = 2.08;
const MIN_NAVIGATION_ONLY_ZOOM = 1.05;
const MAX_NAVIGATION_ONLY_ZOOM = 4.25;
const DEFAULT_SETTINGS = {
  weatherRegion: import.meta.env.VITE_WEATHER_REGION || "Bageshwar",
  dashboardPort: import.meta.env.VITE_DASHBOARD_PORT || "5173",
  forzaUdpPort: import.meta.env.VITE_FORZA_UDP_PORT || "1234",
  udpForwardingEnabled: import.meta.env.VITE_UDP_FORWARDING_ENABLED === "true",
  forzaUdpForwardPort: import.meta.env.VITE_FORZA_UDP_FORWARD_PORT || "1235",
  forzaUdpForwardPort2: import.meta.env.VITE_FORZA_UDP_FORWARD_PORT_2 || "1236",
  telemetryWsPort: import.meta.env.VITE_TELEMETRY_WS_PORT || "17878",
  lanAccessEnabled: import.meta.env.VITE_LAN_ACCESS_ENABLED !== "false",
  developerMode: DEFAULT_DEVELOPER_MODE,
  spotifyClientId: import.meta.env.VITE_SPOTIFY_CLIENT_ID || "",
  demoDriveMode: false,
  uiFpsLimit: "60",
  speedUnit: "kmh",
  mapQuality: "full",
  dashboardTheme: "full",
  flashMode: false,
  backgroundColor: import.meta.env.VITE_BACKGROUND_COLOR || "#000204",
};

function portValue(value) {
  const port = Number(String(value || "").trim());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function repairSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {
      settings: { ...DEFAULT_SETTINGS },
      repairs: ["settings were invalid"],
    };
  }

  const repaired = { ...DEFAULT_SETTINGS, ...settings };
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
      repaired[key] = DEFAULT_SETTINGS[key];
      repairs.push(`${key} reset to default`);
    } else {
      repaired[key] = String(repaired[key]).trim();
    }
  }

  let udpPort = portValue(repaired.forzaUdpPort);
  let telemetryPort = portValue(repaired.telemetryWsPort);
  let dashboardPort = portValue(repaired.dashboardPort);
  if (
    dashboardPort === telemetryPort ||
    dashboardPort === udpPort ||
    telemetryPort === udpPort
  ) {
    repaired.dashboardPort = DEFAULT_SETTINGS.dashboardPort;
    repaired.forzaUdpPort = DEFAULT_SETTINGS.forzaUdpPort;
    repaired.telemetryWsPort = DEFAULT_SETTINGS.telemetryWsPort;
    repairs.push("conflicting dashboard/telemetry/Forza UDP ports reset to defaults");
  }

  udpPort = portValue(repaired.forzaUdpPort);
  telemetryPort = portValue(repaired.telemetryWsPort);
  dashboardPort = portValue(repaired.dashboardPort);
  const forwardPort1 = portValue(repaired.forzaUdpForwardPort);
  const forwardPort2 = portValue(repaired.forzaUdpForwardPort2);
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
      repaired.forzaUdpForwardPort = DEFAULT_SETTINGS.forzaUdpForwardPort;
      repaired.forzaUdpForwardPort2 = DEFAULT_SETTINGS.forzaUdpForwardPort2;
      repairs.push("conflicting UDP forwarding ports reset to defaults");
    }
  }

  if (!["30", "60", "120"].includes(String(repaired.uiFpsLimit))) {
    repaired.uiFpsLimit = DEFAULT_SETTINGS.uiFpsLimit;
    repairs.push("uiFpsLimit reset to default");
  }

  if (!["kmh", "mph"].includes(String(repaired.speedUnit))) {
    repaired.speedUnit = DEFAULT_SETTINGS.speedUnit;
    repairs.push("speedUnit reset to default");
  }

  if (!["optimized", "full"].includes(String(repaired.mapQuality))) {
    repaired.mapQuality = DEFAULT_SETTINGS.mapQuality;
    repairs.push("mapQuality reset to default");
  }

  if (!["full", "top-only"].includes(String(repaired.dashboardTheme))) {
    repaired.dashboardTheme = DEFAULT_SETTINGS.dashboardTheme;
    repairs.push("dashboardTheme reset to default");
  }

  return { settings: repaired, repairs };
}

function saveRepairedSettings(settings, repairs) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  reportClientEvent("SETTINGS_REPAIRED", { repairs });
  fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }).catch(() => {});
  return settings;
}

function toDisplaySpeed(speedKmh, speedUnit) {
  const kmh = Number(speedKmh) || 0;
  return speedUnit === "mph" ? kmh * 0.621371 : kmh;
}

function speedUnitLabel(speedUnit) {
  return speedUnit === "mph" ? "MPH" : "KM/H";
}

function readNavigationOnlyZoom() {
  try {
    const zoom = Number(localStorage.getItem(NAVIGATION_ONLY_ZOOM_KEY));
    return Number.isFinite(zoom)
      ? clamp(
          zoom,
          MIN_NAVIGATION_ONLY_ZOOM,
          MAX_NAVIGATION_ONLY_ZOOM,
        )
      : DEFAULT_NAVIGATION_ONLY_ZOOM;
  } catch {
    return DEFAULT_NAVIGATION_ONLY_ZOOM;
  }
}

function uiFrameIntervalMs(value) {
  const fps = Number(value);
  return [30, 60, 120].includes(fps) ? 1000 / fps : 1000 / 60;
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
  const demoRaceTime = frame * 0.12;
  const demoLapLength = 86;
  const demoLapProgress = (demoRaceTime % demoLapLength) / demoLapLength;
  const demoLapNumber = Math.floor(demoRaceTime / demoLapLength) + 1;
  const demoCurrentLap = demoRaceTime % demoLapLength;
  const demoLastLap = 84.6 + Math.sin(demoLapNumber * 0.7) * 1.8;
  const demoBestLap = Math.min(82.715, demoLastLap - 0.9);
  const demoRacePosition = clamp(
    6 - Math.floor(demoRaceTime / 35) + Math.round(Math.sin(t * 0.16)),
    1,
    12,
  );

  return {
    ...fallbackTelemetry,
    status: "DEMO",
    isRaceOn: 1,
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
    racePosition: demoRacePosition,
    lapNumber: demoLapNumber,
    currentRaceTime: demoRaceTime,
    currentLap: demoCurrentLap,
    lastLap: demoLapNumber > 1 ? demoLastLap : 0,
    bestLap: demoLapNumber > 1 ? demoBestLap : 0,
    distanceTraveled: demoLapProgress * 5200 + (demoLapNumber - 1) * 5200,
    rawCount: frame,
    parsedCount: frame,
    lastSender: "DEMO",
  };
}

function createMusicTelemetry(frame, music = {}, drive = {}) {
  const now = Date.now();
  const playing = Boolean(music.playing);
  const duration = Math.max(Number(music.duration) || 200000, 1);
  const progress =
    (Number(music.progress) || 0) +
    (playing && music.updatedAt ? Math.max(0, now - music.updatedAt) : 0);
  const progressRatio = (progress % duration) / duration;
  const dt = clamp((now - (drive.at || now)) / 1000, 0.045, 0.18);
  drive.at = now;

  const titleSeed = String(`${music.provider || ""}:${music.title || ""}`)
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const trackKey = `${music.provider || ""}:${music.title || ""}:${duration}`;
  if (drive.trackKey !== trackKey) {
    drive.trackKey = trackKey;
    drive.speedKmh = Math.min(Number(drive.speedKmh) || 0, 42);
    drive.rpm = 900;
    drive.intensity = 0;
    drive.bass = 0;
    drive.beatHold = 0;
    drive.dropHold = 0;
    drive.prevIntensity = 0;
  }

  const tempo = 92 + (titleSeed % 54);
  const beatMs = 60000 / tempo;
  const phase = ((progress || frame * beatMs * 0.5) % beatMs) / beatMs;
  const barPhase = ((progress || frame * beatMs * 0.5) % (beatMs * 4)) / (beatMs * 4);
  const sectionPhase =
    ((progress || frame * beatMs * 0.5) % (beatMs * 16)) / (beatMs * 16);
  const downBeat = Math.max(0, 1 - phase * 3.8) ** 2;
  const halfBeat = Math.max(0, 1 - Math.abs(phase - 0.5) * 5.5) ** 2;
  const barKick = Math.max(0, 1 - barPhase * 5.8) ** 2;
  const dropHit = Math.max(0, 1 - Math.abs(sectionPhase - 0.5) * 18) ** 2;
  const audio = music.audio || {};
  const audioConfidence = clamp(Number(audio.confidence) || 0, 0, 1);
  const audioFresh =
    Boolean(audio.at) && now - Number(audio.at) < 650 && audioConfidence > 0.08;
  const audioEnergy = audioFresh
    ? clamp(Number(audio.intensity ?? audio.energy) || 0, 0, 1)
    : 0;
  const audioBass = audioFresh ? clamp(Number(audio.bass) || 0, 0, 1) : 0;
  const audioBeat = audioFresh ? clamp(Number(audio.beat) || 0, 0, 1) : 0;
  const audioDrop = audioFresh ? clamp(Number(audio.drop) || 0, 0, 1) : 0;
  const liveBeatAge = Number(audio.beatAt) ? now - Number(audio.beatAt) : 9999;
  const liveDropAge = Number(audio.dropAt) ? now - Number(audio.dropAt) : 9999;
  const liveBeatHit = audioFresh ? clamp(1 - liveBeatAge / 240, 0, 1) ** 1.65 : 0;
  const liveDropHit = audioFresh ? clamp(1 - liveDropAge / 620, 0, 1) ** 1.4 : 0;
  const buildRise = clamp(sectionPhase / 0.5, 0, 1) ** 1.65;
  const postDropRun = sectionPhase > 0.5 ? 1 - (sectionPhase - 0.5) * 0.55 : 0;
  const sectionLift = clamp(buildRise * 0.58 + postDropRun * 0.42, 0, 1);
  const waveA = (Math.sin(frame * 0.18 + titleSeed * 0.01) + 1) / 2;
  const waveB = (Math.sin(frame * 0.073 + progressRatio * Math.PI * 4) + 1) / 2;
  const waveC = (Math.sin(frame * 0.031 + titleSeed * 0.017) + 1) / 2;
  const fallbackIntensity = clamp(
    0.16 + sectionLift * 0.38 + downBeat * 0.14 + barKick * 0.1 + waveA * 0.1,
    0,
    0.86,
  );
  const targetIntensity = playing
    ? audioFresh
      ? clamp(audioEnergy ** 1.18, 0, 1)
      : fallbackIntensity
    : 0;
  const beat = playing
    ? audioFresh
      ? Math.max(audioBeat, liveBeatHit)
      : clamp(downBeat * 0.7 + barKick * 0.35, 0, 1)
    : 0;
  const drop = playing
    ? audioFresh
      ? Math.max(audioDrop, liveDropHit)
      : dropHit
    : 0;
  const bass = playing ? (audioFresh ? audioBass : clamp(0.25 + downBeat * 0.55, 0, 1)) : 0;
  const responseUp = targetIntensity > (drive.intensity || 0) ? 0.2 : 0.08;
  drive.intensity = (drive.intensity || 0) + (targetIntensity - (drive.intensity || 0)) * responseUp;
  drive.bass = (drive.bass || 0) + (bass - (drive.bass || 0)) * 0.26;
  drive.beatHold = Math.max((drive.beatHold || 0) * Math.exp(-dt * 8.5), beat);
  drive.dropHold = Math.max((drive.dropHold || 0) * Math.exp(-dt * 3.4), drop);

  const intensityFall = Math.max(0, (drive.prevIntensity || 0) - drive.intensity);
  drive.prevIntensity = drive.intensity;
  const energy = drive.intensity;
  const accent = drive.beatHold;
  const launch = drive.dropHold;
  const maxRpm = 9000;
  const speedTarget = playing
    ? clamp(
        12 +
          energy ** 1.55 * 220 +
          drive.bass * 24 +
          accent * 22 +
          launch ** 1.18 * 72 +
          waveC * (audioFresh ? 5 : 14),
        0,
        334,
      )
    : 0;
  const speedResponse =
    speedTarget > (drive.speedKmh || 0)
      ? 1 - Math.exp(-(2.6 + launch * 4.4 + accent * 1.8) * dt)
      : 1 - Math.exp(-(1.15 + intensityFall * 7.5) * dt);
  drive.speedKmh =
    (drive.speedKmh || 0) + (speedTarget - (drive.speedKmh || 0)) * speedResponse;
  if (!playing && drive.speedKmh < 0.4) drive.speedKmh = 0;
  const speedKmh = clamp(drive.speedKmh, 0, 334);
  const gear = playing ? clamp(Math.floor(speedKmh / 43) + 1, 1, 8) : 1;
  const gearBaseSpeed = (gear - 1) * 43;
  const gearProgress = clamp((speedKmh - gearBaseSpeed) / 43, 0, 1);
  const rpmTarget = playing
    ? clamp(
        1050 +
          gearProgress * 5200 +
          energy * 850 +
          drive.bass * 1050 +
          accent * 1300 +
          launch * 900,
        850,
        maxRpm,
      )
    : 900;
  const rpmResponse = 1 - Math.exp(-(7.2 + accent * 5 + launch * 2.5) * dt);
  drive.rpm = (drive.rpm || rpmTarget) + (rpmTarget - (drive.rpm || rpmTarget)) * rpmResponse;
  const rpm = clamp(drive.rpm, 850, maxRpm);
  const braking = clamp(
    intensityFall * 340 + Math.max(0, speedKmh - speedTarget) * 0.62,
    0,
    180,
  );
  const throttle = playing
    ? clamp(20 + energy * 138 + launch * 86 + accent * 34 + drive.bass * 24 - braking * 0.16, 0, 255)
    : 0;
  const brake = playing ? braking : 0;
  const steer = playing
    ? Math.round(Math.sin(frame * 0.11 + titleSeed) * (12 + energy * 42 + launch * 12))
    : 0;
  const slipPulse = playing ? clamp(drive.bass * 0.5 + accent * 0.42 + launch * 0.8, 0, 1.65) : 0;
  const tireHeat = 42 + speedKmh * 0.13 + energy * 38 + launch * 26;
  const suspensionBase = 0.78 + energy * 1.38 + launch * 0.62;
  const raceTime = progress / 1000;
  const lapLength = Math.max(duration / 1000 / 3, 58);
  const lapNumber = playing ? Math.floor(raceTime / lapLength) + 1 : 0;
  const currentLap = playing ? raceTime % lapLength : 0;

  return {
    ...fallbackTelemetry,
    status: playing ? "MUSIC" : "MUSIC IDLE",
    isRaceOn: playing ? 1 : 0,
    speedKmh,
    rpm,
    maxRpm,
    gear,
    powerHp: playing ? clamp(55 + energy * 520 + launch * 310 + speedKmh * 1.15, 0, 980) : 0,
    torqueNm: playing ? clamp(110 + drive.bass * 270 + energy * 300 + launch * 260, 0, 760) : 0,
    boostBar: playing ? clamp(energy * 1.05 + drive.bass * 0.55 + launch * 0.8, 0, 2.35) : 0,
    throttle,
    brake,
    clutch: playing ? clamp(6 + accent * 36, 0, 255) : 0,
    handBrake: playing && launch > 0.82 ? 92 : 0,
    steer,
    accelerationX: playing ? Math.sin(frame * 0.23) * (energy * 3.8 + launch * 1.4) : 0,
    accelerationY: playing ? (speedTarget - speedKmh) * 0.035 + launch * 4.2 + accent * 1.8 : 0,
    accelerationZ: playing ? Math.cos(frame * 0.18) * (energy * 2.6 + drive.bass) : 0,
    tireCombinedSlipFrontLeft: slipPulse * (0.8 + waveA * 0.24),
    tireCombinedSlipFrontRight: slipPulse * (0.76 + waveB * 0.28),
    tireCombinedSlipRearLeft: slipPulse * (0.9 + accent * 0.2),
    tireCombinedSlipRearRight: slipPulse * (0.86 + halfBeat * 0.24),
    tireTempFrontLeft: `${Math.round(tireHeat + waveA * 8)}\u00b0C`,
    tireTempFrontRight: `${Math.round(tireHeat + waveB * 8)}\u00b0C`,
    tireTempRearLeft: `${Math.round(tireHeat + accent * 11)}\u00b0C`,
    tireTempRearRight: `${Math.round(tireHeat + launch * 12)}\u00b0C`,
    suspensionTravelMetersFrontLeft: suspensionBase + accent * 0.55 + launch * 0.35,
    suspensionTravelMetersFrontRight: suspensionBase + beat * 0.5,
    suspensionTravelMetersRearLeft: suspensionBase + waveA * 0.6,
    suspensionTravelMetersRearRight: suspensionBase + waveB * 0.6,
    racePosition: playing ? clamp(9 - Math.floor(energy * 4 + launch * 3), 1, 12) : 0,
    lapNumber,
    currentRaceTime: raceTime,
    currentLap,
    lastLap: lapNumber > 1 ? lapLength + Math.sin(titleSeed) * 1.8 : 0,
    bestLap: lapNumber > 1 ? lapLength - 1.4 : 0,
    distanceTraveled: progressRatio * 5200 + Math.max(0, lapNumber - 1) * 5200,
    rawCount: frame,
    parsedCount: frame,
    lastSender: music.provider ? `MUSIC ${String(music.provider).toUpperCase()}` : "MUSIC",
  };
}

function readSettings() {
  try {
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null") || {}),
    };
    const result = repairSettings(settings);
    return result.repairs.length
      ? saveRepairedSettings(result.settings, result.repairs)
      : result.settings;
  } catch {
    return saveRepairedSettings(
      { ...DEFAULT_SETTINGS },
      ["settings JSON could not be parsed"],
    );
  }
}

function saveSettings(settings) {
  rendererDeveloperMode = Boolean(settings.developerMode);
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
      const nextSettings = event.detail || readSettings();
      rendererDeveloperMode = Boolean(nextSettings.developerMode);
      setSettings(nextSettings);
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

function slipToGripIndex(slipValues, telemetry = {}) {
  const avgSlip =
    slipValues.reduce((sum, value) => sum + value, 0) / slipValues.length;
  const maxSlip = Math.max(...slipValues);
  const speedKmh = Math.max(0, Number(telemetry.speedKmh) || 0);
  const brake = clamp((Number(telemetry.brake) || 0) / 255, 0, 1);
  const throttle = clamp((Number(telemetry.throttle) || 0) / 255, 0, 1);
  const steer = clamp(Math.abs(Number(telemetry.steer) || 0) / 127, 0, 1);
  const speedLoad = clamp(speedKmh / 120, 0, 1);
  const cornerLoad = steer * speedLoad;
  const brakeLoad = brake * speedLoad;
  const expectedSlip =
    0.18 + cornerLoad * 0.48 + brakeLoad * 0.42 + throttle * speedLoad * 0.28;
  const normalLoadPenalty =
    clamp(avgSlip / Math.max(expectedSlip + 0.8, 1), 0, 1) * 14;
  const excessSlipPenalty =
    Math.max(0, avgSlip - expectedSlip - 0.45) * (36 + speedLoad * 18);
  const peakSlipPenalty =
    Math.max(0, maxSlip - expectedSlip - 0.85) * (22 + speedLoad * 16);
  const wheelspinPenalty =
    maxSlip > 1 ? clamp(((maxSlip - 1) / 1.5) * 100, 0, 100) * 0.42 : 0;
  const brakeTurnPenalty =
    brake > 0.25 && cornerLoad > 0.2
      ? brake * cornerLoad * Math.max(0, maxSlip - expectedSlip) * 14
      : 0;

  return clamp(
    Math.round(
      100 -
        normalLoadPenalty -
        excessSlipPenalty -
        peakSlipPenalty -
        wheelspinPenalty -
        brakeTurnPenalty,
    ),
    0,
    100,
  );
}

function getControlLossInfo(telemetry) {
  const throttle = clamp((Number(telemetry?.throttle) || 0) / 255, 0, 1);
  const brake = clamp((Number(telemetry?.brake) || 0) / 255, 0, 1);
  const steer = clamp(Math.abs(Number(telemetry?.steer) || 0) / 127, 0, 1);
  const fallbackSlip = [
    brake * 0.55 + steer * 0.28,
    brake * 0.55 + steer * 0.28,
    throttle * 0.48 + steer * 0.22,
    throttle * 0.48 + steer * 0.22,
  ];
  const slipValues = [
    getTelemetryValue(telemetry, ["TireCombinedSlipFrontLeft", "tireCombinedSlipFrontLeft", "slipFL"], fallbackSlip[0]),
    getTelemetryValue(telemetry, ["TireCombinedSlipFrontRight", "tireCombinedSlipFrontRight", "slipFR"], fallbackSlip[1]),
    getTelemetryValue(telemetry, ["TireCombinedSlipRearLeft", "tireCombinedSlipRearLeft", "slipRL"], fallbackSlip[2]),
    getTelemetryValue(telemetry, ["TireCombinedSlipRearRight", "tireCombinedSlipRearRight", "slipRR"], fallbackSlip[3]),
  ].map((value) => Math.max(0, Number(value) || 0));
  const maxSlip = Math.max(...slipValues);
  const gripIndex = slipToGripIndex(slipValues, telemetry);
  const wheelspinPct = maxSlip > 1 ? clamp(Math.round(((maxSlip - 1) / 1.5) * 100), 0, 100) : 0;
  return {
    gripIndex,
    wheelspinPct,
    losingControl: gripIndex < 40 || wheelspinPct > 55,
  };
}

function getGearLimitFlashInfo(telemetry) {
  const gear = Number(telemetry?.gear);
  const rpm = Number(telemetry?.rpm) || 0;
  const maxRpm = Math.max(Number(telemetry?.maxRpm) || 10000, 1);
  const throttle = clamp((Number(telemetry?.throttle) || 0) / 100, 0, 1);
  const speed = Number(telemetry?.speedKmh) || 0;
  const rpmRatio = clamp(rpm / maxRpm, 0, 1);

  return {
    rpmRatio,
    atLimit:
      Number.isFinite(gear) &&
      gear > 0 &&
      speed > 8 &&
      throttle > 0.35 &&
      rpmRatio >= 0.92,
  };
}

function readStoredYouTubeVolume() {
  const value = Number(localStorage.getItem(YOUTUBE_VOLUME_KEY));
  return Number.isFinite(value) ? clamp(value, 0, 100) : 100;
}
function readStoredYouTubeMuted() {
  return localStorage.getItem(YOUTUBE_MUTED_KEY) === "true";
}

function getServerHostname() {
  const hostname = window.location.hostname;
  return hostname || "127.0.0.1";
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
  const sourceKeyRef = useRef(
    `${targetTelemetry?.status || ""}:${targetTelemetry?.isRaceOn ?? ""}`,
  );

  useEffect(() => {
    const nextSourceKey = `${targetTelemetry?.status || ""}:${targetTelemetry?.isRaceOn ?? ""}`;
    targetRef.current = targetTelemetry;
    if (nextSourceKey !== sourceKeyRef.current) {
      sourceKeyRef.current = nextSourceKey;
      displayRef.current = targetTelemetry;
      setDisplayTelemetry(targetTelemetry);
    }
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
  const resetKeyRef = useRef(options.resetKey);
  const [, forceFrame] = useState(0);

  useEffect(() => {
    if (options.resetKey === resetKeyRef.current) return;
    resetKeyRef.current = options.resetKey;
    valueRef.current = Number(target) || 0;
    timeRef.current = Date.now();
    forceFrame((frame) => frame + 1);
  }, [options.resetKey, target]);

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

function formatLapTime(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "--:--.---";
  const totalMs = Math.round(numeric * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatRaceNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "--";
  return String(Math.round(numeric)).padStart(2, "0");
}

function isTelemetryRaceActive(telemetry) {
  return telemetry?.status === "DEMO" || Number(telemetry?.isRaceOn) === 1;
}

function formatCarClass(value) {
  const classes = ["D", "C", "B", "A", "S1", "S2", "X"];
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "--";
  return classes[Math.round(numeric)] || String(Math.round(numeric));
}

function formatPerformanceIndex(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "--";
  return String(Math.round(numeric));
}

function formatDrivetrain(value) {
  const drivetrains = ["FWD", "RWD", "AWD"];
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "--";
  return drivetrains[Math.round(numeric)] || String(Math.round(numeric));
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
    if (!/\bElectron\b/i.test(navigator.userAgent)) return undefined;

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
    return () => {
      cancelled = true;
    };
  }, []);
  return updateInfo;
}

function App() {
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showFullscreenToast, setShowFullscreenToast] = useState(false);
  const [telemetry, setTelemetry] = useState(fallbackTelemetry);
  const [musicSnapshot, setMusicSnapshot] = useState({
    provider: "spotify",
    playing: false,
    progress: 0,
    duration: 200000,
    title: "",
    updatedAt: Date.now(),
  });
  const [navigationOnlyZoom, setNavigationOnlyZoom] = useState(
    readNavigationOnlyZoom,
  );
  const [lastPacketAt, setLastPacketAt] = useState(0);
  const [telemetryServerOnline, setTelemetryServerOnline] = useState(
    Boolean(window.forzaDash?.onTelemetry),
  );
  const smoothTelemetry = useSmoothedTelemetry(telemetry);
  const weather = useWeather(settings);
  const updateInfo = useUpdateInfo();
  const clock = useClock();
  const demoFrameRef = useRef(0);
  const musicFrameRef = useRef(0);
  const musicDriveStateRef = useRef({});
  const lastLiveTelemetryRef = useRef(null);
  const lastPacketAtRef = useRef(lastPacketAt);
  const telemetryServerOnlineRef = useRef(telemetryServerOnline);
  const frontendRateRef = useRef({
    lastRawCount: Number(fallbackTelemetry.rawCount) || 0,
    lastParsedCount: Number(fallbackTelemetry.parsedCount) || 0,
  });
  const pendingTelemetryRef = useRef(null);
  const telemetryFrameRef = useRef(0);
  const lastTelemetryRenderAtRef = useRef(0);
  const fullscreenToastTimerRef = useRef(0);
  const wasFullscreenRef = useRef(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  lastPacketAtRef.current = lastPacketAt;
  telemetryServerOnlineRef.current = telemetryServerOnline;

  useEffect(() => {
    if (!rendererDeveloperMode) return undefined;
    reportClientEvent("APP_BOOT", {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      devicePixelRatio: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      memoryGb: navigator.deviceMemory || null,
      electron: /\bElectron\b/i.test(navigator.userAgent),
      settings: {
        lanAccessEnabled: settings.lanAccessEnabled !== false,
        developerMode: Boolean(settings.developerMode),
        telemetryWsPort: settings.telemetryWsPort,
        demoDriveMode: settings.demoDriveMode,
        dashboardTheme: settings.dashboardTheme,
      },
    });
  }, []);

  useEffect(() => {
    if (!rendererDeveloperMode) return undefined;
    let frames = 0;
    let slowFrames = 0;
    let worstFrameMs = 0;
    let lastFrameAt = performance.now();
    let lastReportAt = performance.now();
    let frameId = 0;

    function tick(now) {
      const frameMs = now - lastFrameAt;
      lastFrameAt = now;
      frames += 1;
      if (frameMs > 50) slowFrames += 1;
      worstFrameMs = Math.max(worstFrameMs, frameMs);

      if (now - lastReportAt >= 5000) {
        const elapsedSeconds = Math.max((now - lastReportAt) / 1000, 1);
        reportClientEvent("RENDER_HEALTH", {
          fps: Math.round(frames / elapsedSeconds),
          slowFrames,
          worstFrameMs: Math.round(worstFrameMs),
          online: Boolean(lastPacketAtRef.current && Date.now() - lastPacketAtRef.current < 2500),
          telemetryServerOnline: telemetryServerOnlineRef.current,
          rawCount: Number(lastLiveTelemetryRef.current?.rawCount) || 0,
          parsedCount: Number(lastLiveTelemetryRef.current?.parsedCount) || 0,
          droppedPacketCount: lastLiveTelemetryRef.current?.droppedPacketCount ?? null,
          broadcastCount: lastLiveTelemetryRef.current?.broadcastCount ?? null,
        });
        frames = 0;
        slowFrames = 0;
        worstFrameMs = 0;
        lastReportAt = now;
      }

      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, []);

  function isAppFullscreen() {
    if (document.fullscreenElement) return true;
    return (
      Math.abs(window.innerWidth - window.screen.width) <= 2 &&
      Math.abs(window.innerHeight - window.screen.height) <= 2
    );
  }

  function showWindowedHint() {
    window.clearTimeout(fullscreenToastTimerRef.current);
    setShowFullscreenToast(true);
    fullscreenToastTimerRef.current = window.setTimeout(() => {
      setShowFullscreenToast(false);
    }, 4200);
  }

  useEffect(() => {
    function updateFullscreenHint() {
      const fullscreen = isAppFullscreen();
      if (fullscreen) {
        window.clearTimeout(fullscreenToastTimerRef.current);
        setShowFullscreenToast(false);
      } else if (!wasFullscreenRef.current) {
        showWindowedHint();
      } else {
        showWindowedHint();
      }
      wasFullscreenRef.current = fullscreen;
    }

    updateFullscreenHint();
    window.addEventListener("resize", updateFullscreenHint);
    document.addEventListener("fullscreenchange", updateFullscreenHint);
    return () => {
      window.clearTimeout(fullscreenToastTimerRef.current);
      window.removeEventListener("resize", updateFullscreenHint);
      document.removeEventListener("fullscreenchange", updateFullscreenHint);
    };
  }, []);

  useEffect(() => {
    function toggleBrowserFullscreen() {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    }

    function toggleFullscreen(event) {
      if (
        event.button !== 0 ||
        event.target.closest(
          "button, input, select, textarea, a, [role='button'], .settings-modal",
        )
      ) {
        return;
      }

      const isElectronWindow = /\bElectron\b/i.test(navigator.userAgent);
      if (!isElectronWindow) {
        toggleBrowserFullscreen();
        return;
      }

      fetch("/api/window/toggle-fullscreen")
        .then((response) => {
          if (!response.ok) throw new Error("Window fullscreen API unavailable");
        })
        .catch(toggleBrowserFullscreen);
    }

    window.addEventListener("dblclick", toggleFullscreen);
    return () => window.removeEventListener("dblclick", toggleFullscreen);
  }, []);

  useEffect(() => {
    if (!rendererDeveloperMode) return undefined;
    let expectedAt = Date.now() + 5000;
    const id = window.setInterval(() => {
      const now = Date.now();
      reportClientEvent("HEARTBEAT", {
        timerLagMs: Math.max(0, now - expectedAt),
        telemetryAgeMs: lastPacketAtRef.current ? now - lastPacketAtRef.current : -1,
        telemetryServerOnline: telemetryServerOnlineRef.current,
        visibility: document.visibilityState,
      });
      expectedAt = now + 5000;
    }, 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (window.forzaDash?.onTelemetry) {
      function applyElectronTelemetryFrame(now = performance.now()) {
        const minInterval = uiFrameIntervalMs(settings.uiFpsLimit);
        if (now - lastTelemetryRenderAtRef.current < minInterval) {
          telemetryFrameRef.current = requestAnimationFrame(applyElectronTelemetryFrame);
          return;
        }
        telemetryFrameRef.current = 0;
        lastTelemetryRenderAtRef.current = now;
        const data = pendingTelemetryRef.current;
        pendingTelemetryRef.current = null;
        if (!data) return;
        setTelemetryServerOnline(true);
        setTelemetry(data);
        lastLiveTelemetryRef.current = data;
        setLastPacketAt(Date.now());
      }

      window.forzaDash
        .getLatestTelemetry?.()
        .then((data) => {
          if (data) {
            pendingTelemetryRef.current = data;
            if (!telemetryFrameRef.current) {
              telemetryFrameRef.current = requestAnimationFrame(applyElectronTelemetryFrame);
            }
          }
        })
        .catch(() => setTelemetryServerOnline(false));
      const unsubscribe = window.forzaDash.onTelemetry((data) => {
        pendingTelemetryRef.current = data;
        if (!telemetryFrameRef.current) {
          telemetryFrameRef.current = requestAnimationFrame(applyElectronTelemetryFrame);
        }
      });
      return () => {
        unsubscribe?.();
        if (telemetryFrameRef.current) {
          cancelAnimationFrame(telemetryFrameRef.current);
          telemetryFrameRef.current = 0;
        }
        pendingTelemetryRef.current = null;
      };
    }

    const telemetryPort =
      settings.telemetryWsPort || DEFAULT_SETTINGS.telemetryWsPort;
    const telemetryWsUrl = getTelemetryWsUrl(telemetryPort);
    reportClientEvent("TELEMETRY_WS_CONNECTING", { url: telemetryWsUrl });
    const socket = new WebSocket(telemetryWsUrl);
    function applyTelemetryFrame(now = performance.now()) {
      const minInterval = uiFrameIntervalMs(settings.uiFpsLimit);
      if (now - lastTelemetryRenderAtRef.current < minInterval) {
        telemetryFrameRef.current = requestAnimationFrame(applyTelemetryFrame);
        return;
      }
      telemetryFrameRef.current = 0;
      lastTelemetryRenderAtRef.current = now;
      const data = pendingTelemetryRef.current;
      pendingTelemetryRef.current = null;
      if (!data) return;
      setTelemetryServerOnline(true);
      setTelemetry(data);
      lastLiveTelemetryRef.current = data;
      setLastPacketAt(Date.now());
    }
    socket.addEventListener("open", () => {
      reportClientEvent("TELEMETRY_WS_OPEN", { url: telemetryWsUrl });
      setTelemetryServerOnline(true);
    });
    socket.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        const rawCount = Number(data.rawCount) || 0;
        const parsedCount = Number(data.parsedCount) || 0;
        const now = Date.now();
        if (!frontendRateRef.current.lastReportAt) {
          frontendRateRef.current.lastReportAt = now;
          frontendRateRef.current.lastRawCount = rawCount;
          frontendRateRef.current.lastParsedCount = parsedCount;
        } else if (now - frontendRateRef.current.lastReportAt >= 5000) {
          const elapsedSeconds = Math.max((now - frontendRateRef.current.lastReportAt) / 1000, 1);
          reportClientEvent("TELEMETRY_FRONTEND_RATE", {
            rawPerSecond: Number(((rawCount - frontendRateRef.current.lastRawCount) / elapsedSeconds).toFixed(1)),
            parsedPerSecond: Number(((parsedCount - frontendRateRef.current.lastParsedCount) / elapsedSeconds).toFixed(1)),
            rawCount,
            parsedCount,
            lastSender: data.lastSender || "-",
            status: data.status || "-",
          });
          frontendRateRef.current.lastReportAt = now;
          frontendRateRef.current.lastRawCount = rawCount;
          frontendRateRef.current.lastParsedCount = parsedCount;
        }
        pendingTelemetryRef.current = data;
        if (!telemetryFrameRef.current) {
          telemetryFrameRef.current = requestAnimationFrame(applyTelemetryFrame);
        }
      } catch (error) {
        reportClientEvent("WEBSOCKET_PARSE_ERROR", { error: error?.message || String(error) }, "error");
      }
    });
    socket.addEventListener("error", () => {
      reportClientEvent("WEBSOCKET_ERROR", { url: telemetryWsUrl }, "error");
      setTelemetryServerOnline(false);
    });
    socket.addEventListener("close", (event) => {
      reportClientEvent("WEBSOCKET_CLOSE", { code: event.code, reason: event.reason || "-" });
      setTelemetryServerOnline(false);
    });
    return () => {
      socket.close();
      if (telemetryFrameRef.current) {
        cancelAnimationFrame(telemetryFrameRef.current);
        telemetryFrameRef.current = 0;
      }
      pendingTelemetryRef.current = null;
    };
  }, [settings.telemetryWsPort, settings.uiFpsLimit]);

  const online = lastPacketAt && Date.now() - lastPacketAt < 2500;

  useEffect(() => {
    if (!settings.demoDriveMode) return undefined;
    if (online) {
      saveSettings({ ...settings, demoDriveMode: false });
      return undefined;
    }
    const id = setInterval(() => {
      demoFrameRef.current += 1;
      if (musicSnapshot.playing && musicSnapshot.provider === "youtube") {
        musicFrameRef.current += 1;
        setTelemetry(
          createMusicTelemetry(
            musicFrameRef.current,
            musicSnapshot,
            musicDriveStateRef.current,
          ),
        );
        return;
      }
      setTelemetry(createDemoTelemetry(demoFrameRef.current));
    }, 100);
    return () => clearInterval(id);
  }, [settings, online, musicSnapshot]);

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
  const telemetryUiKey = `${smoothTelemetry?.status || ""}:${smoothTelemetry?.isRaceOn ?? ""}:${smoothTelemetry?.lastSender || ""}`;
  const rpmRatio = clamp(smoothTelemetry.rpm / smoothTelemetry.maxRpm, 0, 1);
  const controlLossInfo = getControlLossInfo(smoothTelemetry);
  const gearLimitFlashInfo = getGearLimitFlashInfo(smoothTelemetry);
  const flashModeActive = Boolean(
    settings.flashMode &&
      (controlLossInfo.losingControl || gearLimitFlashInfo.atLimit),
  );
  const speed = Math.round(
    useSmoothedNumber(toDisplaySpeed(smoothTelemetry.speedKmh, settings.speedUnit), {
      responsiveness: 7.5,
      rateLimit: settings.speedUnit === "mph" ? 90 : 145,
      minStep: 0.08,
      resetKey: telemetryUiKey,
    }),
  );
  const stableGearRef = useRef(1);
  useEffect(() => {
    stableGearRef.current = normalizeGear(telemetry.gear, 1);
  }, [telemetryUiKey, telemetry.gear]);
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
  const navigationOnlyTheme = settings.dashboardTheme === "top-only";

  function changeNavigationOnlyZoom(delta) {
    setNavigationOnlyZoom((current) => {
      const next = clamp(
        Number((current + delta).toFixed(2)),
        MIN_NAVIGATION_ONLY_ZOOM,
        MAX_NAVIGATION_ONLY_ZOOM,
      );
      localStorage.setItem(NAVIGATION_ONLY_ZOOM_KEY, String(next));
      return next;
    });
  }

  return (
    <main
      className={`dashboard ${navigationOnlyTheme ? "theme-navigation-only" : ""}`}
      style={{
        "--dashboard-bg": normalizeColor(settings.backgroundColor),
      }}
    >
      {navigationOnlyTheme ? (
        <section
          className="navigation-only-screen"
          aria-label="Navigation only dashboard"
          style={{ "--navigation-only-zoom": navigationOnlyZoom }}
        >
          <NavigationSection
            key={`nav-only-${telemetryUiKey}`}
            telemetry={mapTelemetry}
            online={online}
            mapQuality={settings.mapQuality}
          />
          <div className="navigation-only-zoom-controls" aria-label="Map zoom controls">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => changeNavigationOnlyZoom(0.16)}
            >
              +
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => changeNavigationOnlyZoom(-0.16)}
            >
              -
            </button>
          </div>
          <button
            className="navigation-only-settings"
            type="button"
            aria-label="Open settings"
            title="Open settings"
            onClick={openSettings}
          >
            <Settings />
          </button>
        </section>
      ) : (
        <>
          <TopBar
            online={online}
            telemetryStatus={telemetryStatus}
            telemetry={smoothTelemetry}
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
                <PowerGraph key={`power-${telemetryUiKey}`} telemetry={smoothTelemetry} />
              </section>
              <NavigationSection
                key={`nav-${telemetryUiKey}`}
                telemetry={mapTelemetry}
                online={online}
                mapQuality={settings.mapQuality}
              />
            </aside>
            <CenterDial
              key={`dial-${telemetryUiKey}`}
              telemetry={smoothTelemetry}
              speed={speed}
              gear={gear}
              speedUnit={settings.speedUnit}
              rpmRatio={rpmRatio}
            />
            <aside className="right-stack">
              <MusicPanel
                telemetry={smoothTelemetry}
                onOpenSettings={openSettings}
                onMusicSnapshot={setMusicSnapshot}
                telemetryOnline={Boolean(online)}
              />
              <BoostPressurePanel key={`boost-${telemetryUiKey}`} telemetry={smoothTelemetry} />
            </aside>
          </section>
          <BottomSystems
            key={`systems-${telemetryUiKey}`}
            telemetry={smoothTelemetry}
            inputTelemetry={telemetry}
          />
        </>
      )}
      <div
        className={`fullscreen-toast ${showFullscreenToast ? "visible" : ""}`}
        role="status"
        aria-live="polite"
      >
        App best viewed in fullscreen. Double-click to go fullscreen.
      </div>
      {settingsOpen && (
        <SettingsModal
          onClose={closeSettings}
          telemetryOnline={Boolean(online)}
        />
      )}
      {settings.flashMode && (
        <div
          className={`control-flash-overlay ${flashModeActive ? "active" : ""}`}
          aria-hidden="true"
        />
      )}
    </main>
  );
}

const TopBar = React.memo(function TopBar({
  online,
  telemetryStatus,
  telemetry,
  weather,
  clock,
  updateInfo,
}) {
  const [clockTime, meridiem] = clock.time.split(" ");
  const topTelemetryStats = [
    ["CLASS", formatCarClass(telemetry?.carClass)],
    ["PI", formatPerformanceIndex(telemetry?.carPerformanceIndex)],
    ["DRIVE", formatDrivetrain(telemetry?.drivetrainType)],
  ];

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
        {topTelemetryStats.map(([label, value]) => (
          <div className="assist" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
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
  const rpmReadout = Math.max(0, Math.round(telemetry.rpm || 0))
    .toString()
    .padStart(4, "0");
  const rpmColor =
    liveRpmRatio < 0.45
      ? "#4adfff"
      : liveRpmRatio < 0.72
        ? "#35e887"
        : liveRpmRatio < 0.88
          ? "#ffd43b"
          : "#ff3150";
  const rpmGlow = clamp((liveRpmRatio - 0.42) / 0.58, 0, 1);
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
              style={{
                "--rpm-color": rpmColor,
                "--rpm-glow": rpmGlow,
              }}
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

const BoostPressurePanel = React.memo(function BoostPressurePanel({ telemetry }) {
  const learnedPeakPsiRef = useRef(15);
  const carKeyRef = useRef("");
  const rawBoostBar = Number(telemetry.boostBar);
  const rawBoostPsi = Number(telemetry.boostPsi);
  const boostBar = Number.isFinite(rawBoostBar)
    ? rawBoostBar
    : Number.isFinite(rawBoostPsi)
      ? rawBoostPsi / 14.5038
      : 0;
  const boostPsi = Number.isFinite(rawBoostPsi) ? rawBoostPsi : boostBar * 14.5038;
  const pressurePsi = Math.max(0, boostPsi);
  const carKey =
    telemetry.carOrdinal ??
    telemetry.CarOrdinal ??
    telemetry.carId ??
    telemetry.CarId ??
    telemetry.performanceIndex ??
    telemetry.PerformanceIndex ??
    "";

  if (carKeyRef.current !== String(carKey)) {
    carKeyRef.current = String(carKey);
    learnedPeakPsiRef.current = 15;
  }

  if (pressurePsi > learnedPeakPsiRef.current * 0.96) {
    learnedPeakPsiRef.current = Math.max(15, pressurePsi * 1.18);
  } else if (pressurePsi < 0.2 && Number(telemetry.isRaceOn) === 0) {
    learnedPeakPsiRef.current = 15;
  }

  const scaleMaxPsi = learnedPeakPsiRef.current;
  const boostRatio = clamp(pressurePsi / scaleMaxPsi, 0, 1);
  const pressureLevel =
    boostRatio < 0.33 ? "LOW" : boostRatio < 0.67 ? "MID" : "MAX";
  const pressureLevelColor =
    pressureLevel === "LOW"
      ? "#25d97f"
      : pressureLevel === "MID"
        ? "#ffd43b"
        : "#ff3150";

  return (
    <section
      className="glass-panel right-power-panel boost-pressure-panel"
      aria-label="Boost pressure"
    >
      <div className="right-power-title">
        <h3>BOOST</h3>
      </div>
      <div
        className="boost-pressure-body"
        style={{
          "--boost-fill": `${boostRatio * 100}%`,
          "--boost-level-color": pressureLevelColor,
          "--boost-glow": `${Math.round(18 + boostRatio * 46)}%`,
        }}
      >
        <div className="boost-value-group">
          <div className="boost-live-value">
            <strong>{pressurePsi.toFixed(1)}</strong>
            <small>PSI</small>
          </div>
        </div>
        <div className={`boost-pressure-level ${pressureLevel.toLowerCase()}`}>
          <strong>{pressureLevel}</strong>
        </div>
        <div className="boost-pressure-meter" aria-hidden="true">
          <i />
        </div>
      </div>
    </section>
  );
});

function RaceTimingPanel({ telemetry }) {
  const hasRaceTiming = isTelemetryRaceActive(telemetry);
  const timingStats = [
    ["POSITION", hasRaceTiming ? formatRaceNumber(telemetry.racePosition) : "--"],
    ["LAP", hasRaceTiming ? formatRaceNumber(telemetry.lapNumber) : "--"],
    ["RACE TIME", hasRaceTiming ? formatLapTime(telemetry.currentRaceTime) : "--:--.---"],
    ["CURRENT LAP", hasRaceTiming ? formatLapTime(telemetry.currentLap) : "--:--.---"],
    ["LAST LAP", hasRaceTiming ? formatLapTime(telemetry.lastLap) : "--:--.---"],
    ["BEST LAP", hasRaceTiming ? formatLapTime(telemetry.bestLap) : "--:--.---"],
  ];

  return (
    <div className="race-timing-state" aria-label="Race telemetry">
      {timingStats.map(([label, value]) => (
        <div className="race-timing-tile" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

const MusicPanel = React.memo(function MusicPanel({
  telemetry,
  onOpenSettings,
  onMusicSnapshot,
  telemetryOnline = false,
}) {
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
        const analyzeMusic =
          settings.demoDriveMode && !telemetryOnline && youtubeMusicPlaying;
        const response = await fetch(
          `/api/youtube-music/status${analyzeMusic ? "?analyze=1" : ""}`,
        );
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
      settings.demoDriveMode && !telemetryOnline && youtubeMusicPlaying
        ? 140
        : youtubeMusicPlaying || youtubeWindowVisible
          ? 1000
          : 2500;
    const id = setInterval(refreshYouTube, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [
    musicProvider,
    settings.demoDriveMode,
    telemetryOnline,
    volumeOpen,
    youtubeMusicPlaying,
    youtubeWindowVisible,
  ]);

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
  const isCredit = musicProvider === "himans";
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
  const nextProvider = isYouTube ? "himans" : isCredit ? "spotify" : "youtube";
  const providerLabel = isYouTube
    ? "YOUTUBE"
    : isCredit
      ? "RACE"
      : "SPOTIFY";
  const providerToggleLabel = isYouTube
    ? "Show credit"
    : isCredit
      ? "Switch to Spotify"
      : "Switch to YouTube";

  useEffect(() => {
    onMusicSnapshot?.({
      provider: isYouTube ? "youtube" : isCredit ? "race" : "spotify",
      playing: providerPlaying,
      progress,
      duration,
      title,
      artist,
      audio: isYouTube ? youtubeTrack?.audio : null,
      updatedAt: Date.now(),
    });
  }, [
    artist,
    duration,
    isCredit,
    isYouTube,
    onMusicSnapshot,
    progress,
    providerPlaying,
    title,
    youtubeTrack?.audio,
  ]);

  return (
    <section
      className={`glass-panel music-panel ${isYouTube ? "youtube-mode" : ""} ${isCredit ? "credit-mode" : ""}`}
    >
      <div className="panel-title">
        {isYouTube ? (
          <Youtube className="provider-icon youtube-provider-icon" />
        ) : isCredit ? (
          null
        ) : (
          <img className="spotify-logo" src={spotifyLogo} alt="" />
        )}
        <h2>{providerLabel}</h2>
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
          aria-label={providerToggleLabel}
          title={providerToggleLabel}
          onClick={() => setMusicProvider(nextProvider)}
          disabled={isYouTube && youtubeMusicPlaying}
        >
          {isYouTube ? (
            <Radio />
          ) : isCredit ? (
            <img className="provider-toggle-logo" src={spotifyLogo} alt="" />
          ) : (
            <Youtube />
          )}
        </button>
        <button
          className="settings-trigger"
          type="button"
          aria-label="Open settings"
          title="Open settings"
          onClick={onOpenSettings}
        >
          <Settings />
        </button>
      </div>
      {isCredit ? (
        <RaceTimingPanel telemetry={telemetry} />
      ) : (
        <>
      <div className="track-row">
        <div
          className={`album-art ${image ? "" : "is-placeholder"} ${isYouTube ? "is-youtube" : "is-spotify"}`}
          style={image ? { backgroundImage: `url(${image})` } : undefined}
        >
          {!image && <span>{isYouTube ? "@boring_coder" : "STARBOY"}</span>}
        </div>
        <div className="track-copy">
          <strong>{title}</strong>
          <span>{artist}</span>
        </div>
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
              <div
                className="youtube-volume-popover"
                style={{
                  "--volume-fill": `${youtubeMuted ? 0 : youtubeVolume}%`,
                }}
              >
                <div className="youtube-volume-readout">
                  <strong>{youtubeMuted ? 0 : youtubeVolume}%</strong>
                  <span>{youtubeMuted ? "MUTED" : "VOL"}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={youtubeMuted ? 0 : youtubeVolume}
                  aria-label="YouTube Music volume level"
                  onChange={(event) =>
                    setYouTubeVolume(event.target.value, false)
                  }
                />
                <div className="youtube-volume-steps">
                  <button
                    type="button"
                    aria-label="Lower YouTube Music volume"
                    onClick={() => setYouTubeVolume(youtubeVolume - 10, false)}
                  >
                    <Minus />
                  </button>
                  <button
                    type="button"
                    aria-label="Raise YouTube Music volume"
                    onClick={() => setYouTubeVolume(youtubeVolume + 10, false)}
                  >
                    <Plus />
                  </button>
                </div>
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
        </>
      )}
    </section>
  );
});

function SettingsModal({ onClose, telemetryOnline = false }) {
  const settings = useSettings();
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [networkInfo, setNetworkInfo] = useState(null);
  const [urlCopied, setUrlCopied] = useState(false);
  const spotifyConfigured = Boolean(draft.spotifyClientId?.trim());
  const spotifyLoggedIn = hasSpotifyLogin();
  const dashboardUrl = networkInfo?.lanUrl || networkInfo?.localUrl || "";

  useEffect(() => {
    setDraft(settings);
    rendererDeveloperMode = Boolean(settings.developerMode);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/network")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) setNetworkInfo(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function updateField(key, value) {
    setSaved(false);
    setSettingsError("");
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function copyDashboardUrl() {
    if (!dashboardUrl) return;
    try {
      await navigator.clipboard.writeText(dashboardUrl);
      setUrlCopied(true);
      window.setTimeout(() => setUrlCopied(false), 1600);
    } catch {
      setSettingsError("Could not copy the dashboard URL.");
    }
  }

  function portValue(value) {
    const port = Number(String(value || "").trim());
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  }

  function validatePorts() {
    const udpPort = portValue(draft.forzaUdpPort || DEFAULT_SETTINGS.forzaUdpPort);
    const telemetryPort = portValue(
      draft.telemetryWsPort || DEFAULT_SETTINGS.telemetryWsPort,
    );
    const dashboardPort = portValue(
      draft.dashboardPort || DEFAULT_SETTINGS.dashboardPort,
    );
    const forwardPort1 = portValue(
      draft.forzaUdpForwardPort || DEFAULT_SETTINGS.forzaUdpForwardPort,
    );
    const forwardPort2 = portValue(
      draft.forzaUdpForwardPort2 || DEFAULT_SETTINGS.forzaUdpForwardPort2,
    );

    if (!udpPort || !telemetryPort || !dashboardPort) {
      return "Ports must be numbers between 1 and 65535.";
    }

    if (dashboardPort === telemetryPort) {
      return "Dashboard port and Telemetry WS port must be different.";
    }

    if (dashboardPort === udpPort) {
      return "Dashboard port and Forza UDP port must be different.";
    }

    if (telemetryPort === udpPort) {
      return "Telemetry WS port and Forza UDP port must be different.";
    }

    if (!draft.udpForwardingEnabled) return "";

    if (!forwardPort1 || !forwardPort2) {
      return "UDP forward ports must be numbers between 1 and 65535.";
    }

    if (forwardPort1 === forwardPort2) {
      return "UDP forward ports must be different.";
    }

    if (forwardPort1 === udpPort || forwardPort2 === udpPort) {
      return "UDP forward ports cannot match the Forza UDP input port.";
    }

    if (forwardPort1 === dashboardPort || forwardPort2 === dashboardPort) {
      return "UDP forward ports cannot match the Dashboard port.";
    }

    if (forwardPort1 === telemetryPort || forwardPort2 === telemetryPort) {
      return "UDP forward ports cannot match the Telemetry WS port.";
    }

    return "";
  }

  function save() {
    const portError = validatePorts();
    if (portError) {
      setSettingsError(portError);
      setSaved(false);
      return;
    }

    saveSettings({
      ...DEFAULT_SETTINGS,
      ...draft,
      weatherRegion:
        draft.weatherRegion.trim() || DEFAULT_SETTINGS.weatherRegion,
      dashboardPort:
        draft.dashboardPort.trim() || DEFAULT_SETTINGS.dashboardPort,
      forzaUdpPort: draft.forzaUdpPort.trim() || DEFAULT_SETTINGS.forzaUdpPort,
      udpForwardingEnabled: Boolean(draft.udpForwardingEnabled),
      forzaUdpForwardPort:
        draft.forzaUdpForwardPort.trim() ||
        DEFAULT_SETTINGS.forzaUdpForwardPort,
      forzaUdpForwardPort2:
        draft.forzaUdpForwardPort2.trim() ||
        DEFAULT_SETTINGS.forzaUdpForwardPort2,
      telemetryWsPort:
        draft.telemetryWsPort.trim() || DEFAULT_SETTINGS.telemetryWsPort,
      lanAccessEnabled: Boolean(draft.lanAccessEnabled),
      developerMode: Boolean(draft.developerMode),
      spotifyClientId: draft.spotifyClientId.trim(),
      demoDriveMode: telemetryOnline ? false : Boolean(draft.demoDriveMode),
      uiFpsLimit: ["30", "60", "120"].includes(String(draft.uiFpsLimit))
        ? String(draft.uiFpsLimit)
        : DEFAULT_SETTINGS.uiFpsLimit,
      mapQuality: draft.mapQuality === "full" ? "full" : "optimized",
      dashboardTheme:
        draft.dashboardTheme === "top-only" ? "top-only" : "full",
      flashMode: Boolean(draft.flashMode),
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
          <div className="settings-title">
            <h2>SETTINGS</h2>
            <span>v{APP_VERSION}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close settings">
            x
          </button>
        </div>
        <div className="settings-sections">
          <div className="settings-section">
            <h3>Editable</h3>
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
                <span>UDP Forward Port</span>
                <input
                  inputMode="numeric"
                  disabled={!draft.udpForwardingEnabled}
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
                  disabled={!draft.udpForwardingEnabled}
                  value={draft.forzaUdpForwardPort2}
                  onChange={(event) =>
                    updateField("forzaUdpForwardPort2", event.target.value)
                  }
                />
              </label>
            </div>
          </div>

          <div className="settings-section">
            <h3>Display</h3>
            <div className="settings-grid">
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
              <label>
                <span>UI FPS Limit</span>
                <select
                  value={String(draft.uiFpsLimit || DEFAULT_SETTINGS.uiFpsLimit)}
                  onChange={(event) => updateField("uiFpsLimit", event.target.value)}
                >
                  <option value="30">30 FPS</option>
                  <option value="60">60 FPS</option>
                  <option value="120">120 FPS</option>
                </select>
              </label>
              <label>
                <span>Map Quality</span>
                <select
                  value={draft.mapQuality || DEFAULT_SETTINGS.mapQuality}
                  onChange={(event) => updateField("mapQuality", event.target.value)}
                >
                  <option value="optimized">Optimized / Low Load</option>
                  <option value="full">Full Quality</option>
                </select>
              </label>
              <label>
                <span>Theme</span>
                <select
                  value={draft.dashboardTheme || DEFAULT_SETTINGS.dashboardTheme}
                  onChange={(event) =>
                    updateField("dashboardTheme", event.target.value)
                  }
                >
                  <option value="full">Full Theme</option>
                  <option value="top-only">Navigation Only</option>
                </select>
              </label>
            </div>
          </div>

          <div className="settings-section">
            <h3>Toggles</h3>
            <div className="settings-grid settings-toggle-grid">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(draft.udpForwardingEnabled)}
                  onChange={(event) =>
                    updateField("udpForwardingEnabled", event.target.checked)
                  }
                />
                <span>
                  <strong>UDP Forwarding</strong>
                  <em>Mirror telemetry to forward ports</em>
                </span>
                <i aria-hidden="true" />
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={draft.lanAccessEnabled !== false}
                  onChange={(event) =>
                    updateField("lanAccessEnabled", event.target.checked)
                  }
                />
                <span>
                  <strong>LAN Dashboard Access</strong>
                  <em>Allow phones, tablets, and other local devices</em>
                </span>
                <i aria-hidden="true" />
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(draft.developerMode)}
                  onChange={(event) =>
                    updateField("developerMode", event.target.checked)
                  }
                />
                <span>
                  <strong>Developer Mode</strong>
                  <em>Write frontend and backend diagnostic logs</em>
                </span>
                <i aria-hidden="true" />
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(draft.demoDriveMode)}
                  disabled={telemetryOnline}
                  onChange={(event) =>
                    updateField("demoDriveMode", event.target.checked)
                  }
                />
                <span>
                  <strong>Demo Drive Mode</strong>
                  <em>{telemetryOnline ? "Disabled while telemetry is live" : "Animate the dash without game data"}</em>
                </span>
                <i aria-hidden="true" />
              </label>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(draft.flashMode)}
                  onChange={(event) =>
                    updateField("flashMode", event.target.checked)
                  }
                />
                <span>
                  <strong>Flash Mode</strong>
                  <em>Pulse on grip loss or gear limit</em>
                </span>
                <i aria-hidden="true" />
              </label>
            </div>
          </div>
        </div>
        {settingsError && <p className="settings-error">{settingsError}</p>}
        <div className="settings-note settings-url-row">
          <span>Dashboard URL</span>
          <code>{draft.lanAccessEnabled === false ? "LAN access disabled" : dashboardUrl || "Loading..."}</code>
          <button
            type="button"
            onClick={copyDashboardUrl}
            disabled={draft.lanAccessEnabled === false || !dashboardUrl}
          >
            {urlCopied ? "Copied" : "Copy"}
          </button>
          {!networkInfo?.lanUrl && draft.lanAccessEnabled !== false && dashboardUrl && (
            <em>Local only: no LAN IP detected</em>
          )}
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

const BottomSystems = React.memo(function BottomSystems({
  telemetry,
  inputTelemetry,
}) {
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
      <InputBarsSection telemetry={inputTelemetry || telemetry} />
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
  const status = gripIndex < 40 ? "LOST" : gripIndex < 85 ? "SLIPPING" : "PERFECT";
  const statusClass = gripIndex < 40 ? "danger" : gripIndex < 85 ? "warn" : "good";
  const statusDescription =
    status === "PERFECT"
      ? "OPTIMAL TRACTION"
      : status === "SLIPPING"
        ? "TIRES NEAR LIMIT"
        : "TRACTION LOST";
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
            <div
              className={`grip-slip-row ${value >= 65 ? "danger" : value >= 35 ? "warn" : ""}`}
              key={label}
              style={{ "--slip": `${value}%` }}
            >
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
        <em>{statusDescription}</em>
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
                <stop offset="0%" stopColor="#ff1234" stopOpacity={0.5} />
                <stop offset="92%" stopColor="#ff1234" stopOpacity={0.06} />
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
              stroke="#ff1234"
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
