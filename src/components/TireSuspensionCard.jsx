import React from "react";
import "./TireSuspensionCard.css";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function number(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

function parseTireTemp(value) {
  const numeric = Number(String(value).replace(/[^0-9.\-]+/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseSuspensionTravel(value) {
  const numeric = Number(String(value).replace(/[^0-9.\-]+/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeDisplayTireTemp(value) {
  if (!Number.isFinite(value)) return 0;
  if (value > 130) {
    return Math.max(0, (value - 32) * (5 / 9));
  }
  return Math.max(0, value);
}

export default function TireSuspensionCard({
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
          const tempRatio = clamp((normalizeDisplayTireTemp(tireTemp) - 30) / 75, 0, 1);
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
