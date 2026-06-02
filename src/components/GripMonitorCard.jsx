import React from "react";
import GripRing from "./GripRing";
import "./GripMonitorCard.css";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getTelemetryValue(telemetry, keys, fallback = null) {
  for (const key of keys) {
    if (telemetry?.[key] != null) return telemetry[key];
  }
  return fallback;
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

export default function GripMonitorCard({ telemetry = {} }) {
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

  const gripIndex = slipToGripIndex(slipValues, telemetry);

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
        <div className={`grip-index ${statusClass}`}>
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
