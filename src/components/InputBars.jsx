import React from "react";
import "./InputBars.css";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function number(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

function InputRow({ label, value, color, max }) {
  const percent = clamp(((Number(value) || 0) / max) * 100, 0, 100);

  return (
    <div className="input-row" style={{ "--bar": color, "--value": `${percent}%` }}>
      <div className="input-name">
        <span>{label}</span>
        <em />
      </div>
      <div className="input-segments">
        <i />
      </div>
      <strong>{number(percent).padStart(2, "0")}%</strong>
    </div>
  );
}

export default React.memo(function InputBars({ telemetry = {} }) {
  const rows = [
    ["THROTTLE", "THR", telemetry.throttle, "#25eaff", 255],
    ["BRAKE", "BRK", telemetry.brake, "#ff3d4f", 255],
    ["CLUTCH", "CLT", telemetry.clutch, "#ffd633", 255],
    ["HANDBRAKE", "HND", telemetry.handBrake, "#ff8a1f", 255],
  ];

  const steer = clamp(telemetry.steer ?? 0, -127, 127);
  const steerPercent = Math.abs(steer / 127) * 100;
  const steerLabel = `${number(steerPercent)}%`;
  const steerPos = 50 + (steer / 127) * 50;

  return (
    <div className="glass-panel system-card input-card">
      <div className="input-list">
        {rows.map(([label, , value, color, max]) => (
          <InputRow key={label} label={label} value={value} color={color} max={max} />
        ))}

        <div
          className="input-row steer-row"
          style={{
            "--bar": "#9b5cff",
            "--steer": `${steerPos}%`,
            "--steer-fill": `${steerPercent / 2}%`,
            "--steer-start": steer < 0 ? `${50 - steerPercent / 2}%` : "50%",
          }}
        >
          <div className="input-name">
            <span>STEERING</span>
            <em />
          </div>

          <div className="steer-track">
            <b className="steer-arrow left">◀</b>
            <i />
            <b className="steer-arrow right">▶</b>
          </div>

          <strong>{steerLabel}</strong>
        </div>
      </div>
    </div>
  );
});
