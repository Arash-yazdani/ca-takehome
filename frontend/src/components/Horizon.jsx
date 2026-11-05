import { useEffect, useRef, useState } from "react";

// A planet horizon: the orange arc fills left to right as tasks are completed.
const START = [0, 190];
const CONTROL = [600, -70];
const END = [1200, 190];
const CURVE = `M ${START} Q ${CONTROL} ${END}`;

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// De Casteljau split: the part of the curve up to t is itself a quadratic Bezier.
function curveUpTo(t) {
  const control = lerp(START, CONTROL, t);
  const tip = lerp(control, lerp(CONTROL, END, t), t);
  return { path: `M ${START} Q ${control} ${tip}`, tip };
}

// Moves the shown value to its target over 500ms, so the arc and its tip travel along the curve together.
function useTween(target) {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    const started = performance.now();
    let frame;
    const step = (now) => {
      const t = Math.min((now - started) / 500, 1);
      current.current = from + (target - from) * (1 - (1 - t) ** 3); // ease out
      setValue(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
}

export default function Horizon({ total, completed, pending }) {
  const percent = total ? Math.floor((completed / total) * 100) : 0; // 199 of 200 must not read as 100%
  const shown = useTween(percent);
  const { path, tip } = curveUpTo(shown / 100);

  return (
    <section className="horizon" aria-label="Task statistics">
      <div className="horizon-arc">
        <div className="atmosphere">
          <div className="planet" />
        </div>
        <div className="planet" />
        <div className="sun" />
        <svg viewBox="0 0 1200 190" preserveAspectRatio="none" role="img" aria-label={`${percent}% of tasks completed`}>
          <defs>
            {/* The same curve in 0-1 units, so the clip scales with the box. */}
            <clipPath id="planet-clip" clipPathUnits="objectBoundingBox">
              <path d="M 0 1 Q 0.5 -0.368 1 1 Z" />
            </clipPath>
          </defs>
          <path d={CURVE} className="arc-track" vectorEffect="non-scaling-stroke" />
          {shown > 0 && <path d={path} className="arc-fill" vectorEffect="non-scaling-stroke" />}
        </svg>
        {shown > 0 && <span className="arc-tip" style={{ left: `${(tip[0] / 1200) * 100}%`, top: `${(tip[1] / 190) * 100}%` }} />}
      </div>
      <dl className="stats">
        <div>
          <dt>Total</dt>
          <dd>{total}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{completed}</dd>
        </div>
        <div>
          <dt>Pending</dt>
          <dd>{pending}</dd>
        </div>
      </dl>
    </section>
  );
}
