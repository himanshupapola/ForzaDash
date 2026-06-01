import React, { useEffect, useRef, useState } from "react";
import "./InputBars.css";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function number(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

function useSmoothedNumber(target, responsiveness = 9, rateLimit = 180) {
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
      const next =
        current +
        clamp((nextTarget - current) * alpha, -rateLimit * dt, rateLimit * dt);
      valueRef.current = Math.abs(nextTarget - next) < 0.03 ? nextTarget : next;
      forceFrame((frame) => frame + 1);
      if (valueRef.current !== nextTarget) frameId = requestAnimationFrame(tick);
    }
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [rateLimit, responsiveness, target]);

  return valueRef.current;
}

function InputRow({ label, value, color, max }) {
  const percent = clamp(((Number(value) || 0) / max) * 100, 0, 100);
  const smoothPercent = useSmoothedNumber(percent);

  return (
    <div className="input-row" style={{ "--bar": color, "--value": `${smoothPercent}%` }}>
      <div className="input-name">
        <span>{label}</span>
        <em />
      </div>
      <div className="input-segments">
        <i />
      </div>
      <strong>{number(smoothPercent).padStart(2, "0")}%</strong>
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
