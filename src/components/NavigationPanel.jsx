import React, { useEffect, useRef, useState } from "react";
import { MapPin, Timer } from "lucide-react";
import optimizedMap from "../assets/map-nav.jpg";
import "./NavigationPanel.css";

const FH6_MAP_IMAGE_SIZE = 6144;
const FH6_MAP_FACTOR_X = -3.5131;
const FH6_MAP_OFFSET_X = -172.55;
const FH6_MAP_FACTOR_Y = 3.512;
const FH6_MAP_OFFSET_Y = 12.86;
const GPS_MAP_ZOOM = 1.82;
const GPS_MAP_CENTER_OFFSET_X = 0;
const GPS_MAP_CENTER_OFFSET_Y = 0;
const MAP_STATE_KEY = "forzadash_last_map_state";
const MAP_POSITION_SMOOTHING = 0.24;
const MAP_ROTATION_SMOOTHING = 0.18;
const COMPASS_DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const GPS_MAP_STYLE = {
  background: "#02080c",
  road: "#edf7fb",
  roadGlow: "#25c8ff",
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(current, target, amount) {
  return current + (target - current) * amount;
}

function lerpAngle(current, target, amount) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * amount;
}

function worldToMapPoint(telemetry) {
  const worldX = Number(telemetry.positionX);
  const worldY = Number(telemetry.positionZ);

  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  if (telemetry.status !== "DEMO" && Number(telemetry.isRaceOn) === 0)
    return null;

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
  } catch {}
}

function telemetrySourceKey(telemetry) {
  return `${telemetry?.status || ""}:${telemetry?.isRaceOn ?? ""}:${telemetry?.lastSender || ""}`;
}

function headingFromYaw(yaw) {
  if (!Number.isFinite(yaw)) {
    return {
      label: "--",
      degrees: 0,
      degreesLabel: "---",
    };
  }

  const degrees = ((yaw * 180) / Math.PI + 360) % 360;
  const directionIndex =
    Math.round(degrees / (360 / COMPASS_DIRECTIONS.length)) %
    COMPASS_DIRECTIONS.length;

  return {
    label: COMPASS_DIRECTIONS[directionIndex],
    degrees,
    degreesLabel: `${Math.round(degrees).toString().padStart(3, "0")} DEG`,
  };
}

export default React.memo(function NavigationPanel({
  telemetry,
  online,
  mapQuality = "full",
}) {
  const [fullQualityMap, setFullQualityMap] = useState(null);
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
  const displayMapStateRef = useRef(null);
  const sourceKeyRef = useRef(telemetrySourceKey(telemetry));

  const point = worldToMapPoint(telemetry);
  const liveYaw = Number(telemetry.yaw);
  const liveSpeed = Math.round(Number(telemetry.speedKmh) || 0);
  const liveHasPosition = Boolean(point);
  const currentSourceKey = telemetrySourceKey(telemetry);

  if (currentSourceKey !== sourceKeyRef.current) {
    sourceKeyRef.current = currentSourceKey;
    displayMapStateRef.current = null;
    if (telemetry.status === "DEMO") {
      lastMapStateRef.current = {
        point: null,
        yaw: 0,
        speed: 0,
        hasPosition: false,
      };
    }
  }

  if (liveHasPosition) {
    lastMapStateRef.current = {
      point,
      yaw: Number.isFinite(liveYaw) ? liveYaw : lastMapStateRef.current.yaw,
      speed: liveSpeed,
      hasPosition: true,
    };

    if (telemetry.status !== "DEMO") {
      storeMapState(lastMapStateRef.current);
    }
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

  if (!displayMapStateRef.current) {
    displayMapStateRef.current = {
      x: mapX,
      y: mapY,
      yaw,
    };
  } else {
    displayMapStateRef.current = {
      x: lerp(displayMapStateRef.current.x, mapX, MAP_POSITION_SMOOTHING),
      y: lerp(displayMapStateRef.current.y, mapY, MAP_POSITION_SMOOTHING),
      yaw: lerpAngle(displayMapStateRef.current.yaw, yaw, MAP_ROTATION_SMOOTHING),
    };
  }

  const displayMapX = clamp(displayMapStateRef.current.x, 0, FH6_MAP_IMAGE_SIZE);
  const displayMapY = clamp(displayMapStateRef.current.y, 0, FH6_MAP_IMAGE_SIZE);
  const displayYaw = displayMapStateRef.current.yaw;

  const centeredMapX = clamp(
    displayMapX + GPS_MAP_CENTER_OFFSET_X,
    0,
    FH6_MAP_IMAGE_SIZE,
  );

  const centeredMapY = clamp(
    displayMapY + GPS_MAP_CENTER_OFFSET_Y,
    0,
    FH6_MAP_IMAGE_SIZE,
  );

  const mapRotation = Number.isFinite(displayYaw) ? -displayYaw : 0;

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
  const mapImage =
    mapQuality === "full" && fullQualityMap ? fullQualityMap : optimizedMap;
  const heading = headingFromYaw(displayYaw);

  useEffect(() => {
    let cancelled = false;
    if (mapQuality !== "full" || fullQualityMap) return undefined;

    import("../assets/map-full.jpg")
      .then((module) => {
        if (!cancelled) setFullQualityMap(module.default);
      })
      .catch(() => {
        if (!cancelled) setFullQualityMap(null);
      });

    return () => {
      cancelled = true;
    };
  }, [fullQualityMap, mapQuality]);

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
            transform: `rotate(${mapRotation}rad) scale(var(--gps-map-zoom, ${GPS_MAP_ZOOM}))`,
            "--map-x": `${centeredMapX}px`,
            "--map-y": `${centeredMapY}px`,
          }}
        >
          <img
            src={mapImage}
            alt=""
            style={{
              transform: `translate(-${centeredMapX}px, -${centeredMapY}px)`,
            }}
          />
        </div>

        <div
          className={`live-map-marker ${online && hasPosition ? "active" : ""}`}
          style={{ transform: "translate(-50%, -56%)" }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24">
            <path d="M11.7 1.6 21.9 22.1 12.1 17.4 3 22.3 11.7 1.6Z" />
          </svg>
        </div>

        <div className="live-map-vignette" />
        <div className="live-map-dots" />

        <div className="navigation-stats">
          <span className="navigation-muted">
            <Timer size={16} /> {driveMinutes} min
          </span>

          <span className="navigation-heading" aria-label={`Heading ${heading.degreesLabel}`}>
            {heading.label}
          </span>

          <span className="navigation-muted">
            <MapPin size={15} /> {drivenKm} km
          </span>
        </div>
      </div>
    </section>
  );
});
