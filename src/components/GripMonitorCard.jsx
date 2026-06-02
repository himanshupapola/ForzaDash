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

  const avgSlip = slipValues.reduce((sum, value) => sum + value, 0) / slipValues.length;
  const gripIndex = clamp(Math.round(100 - avgSlip * 80), 0, 100);

  const status = gripIndex < 40 ? "LOST" : gripIndex < 85 ? "SLIPPING" : "PERFECT";
  const statusClass = gripIndex < 40 ? "danger" : gripIndex < 85 ? "warn" : "good";

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
        <em>{status === "PERFECT" ? "OPTIMAL TRACTION" : "TRACTION ACTIVE"}</em>
      </div>
    </div>
  );
}
