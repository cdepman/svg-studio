// The parameter panel — the only "inspector". It edits the single repeat. PRD §13.
//
// Continuous sliders MUST be uncontrolled during drag (defaultValue + ref, never
// a value prop bound to state). On `input` we write the live DOM imperatively
// (recompute the N instance transforms); on `change` (release) we commit to React
// state. A controlled input would fight the imperative updates and force a
// re-render per tick — exactly the failure this architecture avoids. PRD §10.
//
// We attach native `input`/`change` listeners (not React's onChange) because
// React normalizes range onChange to fire continuously; the native `change`
// event is what gives us true release semantics. The live value readout is also
// updated imperatively, so a slider drag triggers ZERO React renders.
import { useEffect, useRef } from "react";
import type { OrientationMode, RepeatParams } from "../types";

interface ControlsProps {
  params: RepeatParams;
  /** Latest committed params, for merging the single live value during a drag. */
  paramsRef: React.MutableRefObject<RepeatParams>;
  applyInstances: (p: RepeatParams) => void;
  onCommit: (partial: Partial<RepeatParams>) => void;
  setDragging: (d: boolean) => void;
}

type NumericKey =
  | "angleOffset"
  | "radiusOffset"
  | "sourceRotation"
  | "scaleStep"
  | "opacityStep";

interface SliderDef {
  k: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}

function ContinuousSlider({
  def,
  paramsRef,
  applyInstances,
  onCommit,
  setDragging,
}: {
  def: SliderDef;
} & Omit<ControlsProps, "params">) {
  const inputRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLSpanElement>(null);
  const initial = paramsRef.current[def.k];

  useEffect(() => {
    const el = inputRef.current!;
    const onInput = () => {
      const v = parseFloat(el.value);
      if (outRef.current) outRef.current.textContent = def.fmt(v);
      // Merge the live value over latest committed params; write N transforms.
      applyInstances({ ...paramsRef.current, [def.k]: v });
    };
    const onChange = () => {
      onCommit({ [def.k]: parseFloat(el.value) });
      setDragging(false);
    };
    const onDown = () => setDragging(true);
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    el.addEventListener("pointerdown", onDown);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
      el.removeEventListener("pointerdown", onDown);
    };
  }, [def, paramsRef, applyInstances, onCommit, setDragging]);

  return (
    <label className="ctrl">
      <span className="ctrl-label">
        {def.label}
        <span className="ctrl-val" ref={outRef}>
          {def.fmt(initial)}
        </span>
      </span>
      <input
        ref={inputRef}
        type="range"
        min={def.min}
        max={def.max}
        step={def.step}
        defaultValue={initial}
      />
    </label>
  );
}

const CORE_SLIDERS: SliderDef[] = [
  { k: "angleOffset", label: "Angle offset", min: -180, max: 180, step: 1, fmt: (v) => `${v}°` },
  { k: "radiusOffset", label: "Radius offset", min: 0, max: 600, step: 1, fmt: (v) => `${v}` },
  { k: "sourceRotation", label: "Source rotation", min: -180, max: 180, step: 1, fmt: (v) => `${v}°` },
];

const SECONDARY_SLIDERS: SliderDef[] = [
  { k: "scaleStep", label: "Scale step", min: -0.2, max: 0.2, step: 0.005, fmt: (v) => v.toFixed(3) },
  { k: "opacityStep", label: "Opacity step", min: -0.2, max: 0.2, step: 0.005, fmt: (v) => v.toFixed(3) },
];

export function Controls({
  params,
  paramsRef,
  applyInstances,
  onCommit,
  setDragging,
}: ControlsProps) {
  const sliderProps = { paramsRef, applyInstances, onCommit, setDragging };

  return (
    <div className="controls">
      {/* Count is STRUCTURAL: it changes the number of <use> nodes, so it goes
          through React state and a re-render. Discrete and low frequency — it
          does not need 60fps. PRD §4. */}
      <label className="ctrl">
        <span className="ctrl-label">
          Count<span className="ctrl-val">{params.count}</span>
        </span>
        <input
          type="range"
          min={1}
          max={128}
          step={1}
          value={params.count}
          onChange={(e) => onCommit({ count: parseInt(e.target.value, 10) })}
        />
      </label>

      {CORE_SLIDERS.map((def) => (
        <ContinuousSlider key={def.k} def={def} {...sliderProps} />
      ))}

      <fieldset className="ctrl orientation">
        <legend>Orientation mode</legend>
        {(
          [
            ["rotateWithCircle", "Rotate with circle"],
            ["keepUpright", "Keep upright"],
          ] as [OrientationMode, string][]
        ).map(([value, label]) => (
          <label key={value} className="radio">
            <input
              type="radio"
              name="orientationMode"
              checked={params.orientationMode === value}
              onChange={() => onCommit({ orientationMode: value })}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <label className="radio">
        <input
          type="checkbox"
          checked={params.mirrorAlternates}
          onChange={(e) => onCommit({ mirrorAlternates: e.target.checked })}
        />
        Mirror alternates
      </label>

      {/* Seam handling. All of these are structural (z-order / clip geometry), so
          like Count they commit immediately through React — low frequency, no
          need for the uncontrolled-slider treatment. The seam is conserved:
          "Seam position" relocates it, "Tuck" hides it. */}
      <fieldset className="ctrl seam">
        <legend>Seam</legend>
        <label className="ctrl">
          <span className="ctrl-label">
            Seam position<span className="ctrl-val">{params.paintOffset}</span>
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0, params.count - 1)}
            step={1}
            value={Math.min(params.paintOffset, Math.max(0, params.count - 1))}
            onChange={(e) => onCommit({ paintOffset: parseInt(e.target.value, 10) })}
          />
        </label>
        <label className="radio">
          <input
            type="checkbox"
            checked={params.tuck}
            onChange={(e) => onCommit({ tuck: e.target.checked })}
          />
          Tuck final repeat
        </label>
        <label className="ctrl">
          <span className="ctrl-label">
            Seam blend (k)<span className="ctrl-val">{params.seamBlend}</span>
          </span>
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={params.seamBlend}
            disabled={!params.tuck}
            onChange={(e) => onCommit({ seamBlend: parseInt(e.target.value, 10) })}
          />
        </label>
      </fieldset>

      <hr />
      <div className="secondary-note">Secondary</div>
      {SECONDARY_SLIDERS.map((def) => (
        <ContinuousSlider key={def.k} def={def} {...sliderProps} />
      ))}
    </div>
  );
}
