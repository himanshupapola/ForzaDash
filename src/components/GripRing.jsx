import React from "react";

export default function GripRing({ value = 0 }) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const dots = 74;
  const filledDots = Math.round((percent / 100) * dots);

  return (
    <div className="grip-ring-shell">
      <svg className="grip-ring" viewBox="0 0 140 140" aria-hidden="true">
        {Array.from({ length: dots }).map((_, index) => {
          const angle = (index / dots) * Math.PI * 2 - Math.PI / 2;
          const x = 70 + Math.cos(angle) * 56;
          const y = 70 + Math.sin(angle) * 56;
          const rotation = (angle * 180) / Math.PI + 90;

          return (
            <rect
              key={index}
              className={index < filledDots ? "grip-ring-dot active" : "grip-ring-dot"}
              x={x - 1.2}
              y={y - 3.2}
              width="3.4"
              height="10.4"
              rx="0.3"
              transform={`rotate(${rotation} ${x} ${y})`}
            />
          );
        })}
      </svg>

      <div className="grip-ring-label">
        <strong>
          {percent}
          <small>%</small>
        </strong>
        <span>GRIP</span>
      </div>
    </div>
  );
}