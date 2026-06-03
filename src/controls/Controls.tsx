// The parameter panel. Edits the SELECTED layer, or ALL selected layers in
// synchrony. PRD §13 + synchronized manipulation.
//
// Continuous sliders apply a RELATIVE DELTA (current - drag-start value) to every
// selected layer, preserving the differences between them. They stay uncontrolled
// and use native input/change listeners so a slider drag triggers ZERO React
// renders. Discrete controls (count, orientation, mirror, seam) set an ABSOLUTE
// value on every selected layer.
import { useEffect, useRef } from "react";
import type { CenterPathAnimation, Layer, OrientationMode, RepeatParams } from "../types";
import type { NumericParamKey } from "../canvas/useScene";

interface ControlsProps {
  /** Representative layer for display + slider defaults + discrete values. */
  primary: Layer | null;
  /** Number of selected, editable layers (>1 means synchronized editing). */
  selectionCount: number;
  /** True when "all layers" is the active selection. */
  allSelected: boolean;
  /** At least one selected layer is editable (visible + unlocked). */
  editable: boolean;
  primaryParamsRef: React.MutableRefObject<RepeatParams | null>;
  applyParamDelta: (key: NumericParamKey, delta: number) => void;
  onCommitDelta: (key: NumericParamKey, delta: number) => void;
  onCommitAbsolute: (partial: Partial<RepeatParams>) => void;
  setDragging: (d: boolean) => void;
  onToggleVisible: () => void;
  onToggleLocked: () => void;
  animationEditable: boolean;
  drawingMotionPath: boolean;
  animationPlaying: boolean;
  onBeginAnimateCenter: () => void;
  onTogglePlayback: () => void;
  onDeleteAnimation: () => void;
  onUpdateAnimation: (patch: (animation: CenterPathAnimation) => CenterPathAnimation) => void;
}

interface SliderDef {
  k: NumericParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}

function ContinuousSlider({
  def,
  primaryParamsRef,
  applyParamDelta,
  onCommitDelta,
  setDragging,
}: {
  def: SliderDef;
  primaryParamsRef: React.MutableRefObject<RepeatParams | null>;
  applyParamDelta: (key: NumericParamKey, delta: number) => void;
  onCommitDelta: (key: NumericParamKey, delta: number) => void;
  setDragging: (d: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLSpanElement>(null);
  const startRef = useRef(0);
  const initial = primaryParamsRef.current ? primaryParamsRef.current[def.k] : 0;

  useEffect(() => {
    const el = inputRef.current!;
    const onDown = () => {
      startRef.current = primaryParamsRef.current
        ? primaryParamsRef.current[def.k]
        : parseFloat(el.value);
      setDragging(true);
    };
    const onInput = () => {
      const v = parseFloat(el.value);
      if (outRef.current) outRef.current.textContent = def.fmt(v);
      applyParamDelta(def.k, v - startRef.current); // relative delta to all
    };
    const onChange = () => {
      onCommitDelta(def.k, parseFloat(el.value) - startRef.current);
      setDragging(false);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", onChange);
    };
  }, [def, primaryParamsRef, applyParamDelta, onCommitDelta, setDragging]);

  return (
    <label className="ctrl">
      <span className="ctrl-label">
        {def.label}
        <span className="ctrl-val" ref={outRef}>
          {def.fmt(initial)}
        </span>
      </span>
      <input ref={inputRef} type="range" min={def.min} max={def.max} step={def.step} defaultValue={initial} />
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
  primary,
  selectionCount,
  allSelected,
  editable,
  primaryParamsRef,
  applyParamDelta,
  onCommitDelta,
  onCommitAbsolute,
  setDragging,
  onToggleVisible,
  onToggleLocked,
  animationEditable,
  drawingMotionPath,
  animationPlaying,
  onBeginAnimateCenter,
  onTogglePlayback,
  onDeleteAnimation,
  onUpdateAnimation,
}: ControlsProps) {
  if (!primary) {
    return (
      <div className="controls">
        <div className="controls-empty">No layer selected.</div>
      </div>
    );
  }

  const status = !primary.visible ? "Hidden" : primary.locked ? "Locked" : null;
  const title = allSelected
    ? `All layers (${selectionCount})`
    : selectionCount > 1
    ? `${selectionCount} layers`
    : primary.name;
  const sliderProps = { primaryParamsRef, applyParamDelta, onCommitDelta, setDragging };
  const p = primary.params;
  const animation = primary.animation?.type === "centerPath" ? primary.animation : null;
  // The key remounts uncontrolled sliders when the representative changes.
  const bodyKey = allSelected ? "__all__" : primary.id;

  return (
    <div className="controls">
      <div className="controls-head">
        <div className="editing-row">
          <span className="editing-label">Editing</span>
          <span className="editing-name" title={title}>
            {title}
          </span>
        </div>
        <div className="editing-toggles">
          <button className="mini" onClick={onToggleVisible} title="Toggle visibility">
            {primary.visible ? "👁" : "🙈"}
          </button>
          <button className="mini" onClick={onToggleLocked} title="Toggle lock">
            {primary.locked ? "🔒" : "🔓"}
          </button>
          {status && <span className="editing-status">{status}</span>}
          {selectionCount > 1 && <span className="editing-status sync">sync</span>}
        </div>
      </div>

      <fieldset className="controls-body" disabled={!editable} key={bodyKey}>
        {/* Count is per-layer structure; across a multi-selection the layers can
            have different counts, so don't pretend there's one value — disable it
            and blank the readout. Edit count one layer at a time. */}
        <label className="ctrl">
          <span className="ctrl-label">
            Count<span className="ctrl-val">{selectionCount > 1 ? "—" : p.count}</span>
          </span>
          <input
            type="range"
            min={1}
            max={128}
            step={1}
            value={p.count}
            disabled={selectionCount > 1}
            onChange={(e) => onCommitAbsolute({ count: parseInt(e.target.value, 10) })}
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
                checked={p.orientationMode === value}
                onChange={() => onCommitAbsolute({ orientationMode: value })}
              />
              {label}
            </label>
          ))}
        </fieldset>

        <label className="radio">
          <input
            type="checkbox"
            checked={p.mirrorAlternates}
            onChange={(e) => onCommitAbsolute({ mirrorAlternates: e.target.checked })}
          />
          Mirror alternates
        </label>

        <fieldset className="ctrl seam">
          <legend>Seam</legend>
          <label className="radio">
            <input type="checkbox" checked={p.tuck} onChange={(e) => onCommitAbsolute({ tuck: e.target.checked })} />
            Hide seam (automatic)
          </label>
          {/* Only knob: where the hidden split sits. Depth is no longer a thing —
              the two-half-disk render is seamless at any overlap. */}
          <label className="ctrl">
            <span className="ctrl-label">
              Seam position<span className="ctrl-val">{p.paintOffset}</span>
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, p.count - 1)}
              step={1}
              value={Math.min(p.paintOffset, Math.max(0, p.count - 1))}
              disabled={!p.tuck}
              onChange={(e) => onCommitAbsolute({ paintOffset: parseInt(e.target.value, 10) })}
            />
          </label>
        </fieldset>

        <hr />
        <div className="secondary-note">Secondary</div>
        {SECONDARY_SLIDERS.map((def) => (
          <ContinuousSlider key={def.k} def={def} {...sliderProps} />
        ))}

        <hr />
        <fieldset className="ctrl animation-ctrl" disabled={!animationEditable}>
          <legend>Animation</legend>
          <div className="animation-actions">
            <button type="button" onClick={onBeginAnimateCenter} className={drawingMotionPath ? "active" : ""}>
              {animation ? "Draw/Edit Path" : "Animate Center"}
            </button>
            <button type="button" onClick={onTogglePlayback} disabled={!animation}>
              {animationPlaying ? "Pause" : "Play"}
            </button>
          </div>

          {animation && (
            <>
              <label className="radio">
                <input
                  type="checkbox"
                  checked={animation.enabled}
                  onChange={(e) =>
                    onUpdateAnimation((a) => ({ ...a, enabled: e.target.checked }))
                  }
                />
                Enabled
              </label>
              <label className="ctrl">
                <span className="ctrl-label">
                  Duration<span className="ctrl-val">{animation.durationSeconds.toFixed(1)}s</span>
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={20}
                  step={0.5}
                  value={animation.durationSeconds}
                  onChange={(e) =>
                    onUpdateAnimation((a) => ({ ...a, durationSeconds: parseFloat(e.target.value) }))
                  }
                />
              </label>
              <label className="ctrl">
                <span className="ctrl-label">
                  Delay<span className="ctrl-val">{animation.delaySeconds.toFixed(1)}s</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={animation.delaySeconds}
                  onChange={(e) =>
                    onUpdateAnimation((a) => ({ ...a, delaySeconds: parseFloat(e.target.value) }))
                  }
                />
              </label>
              <label className="ctrl">
                <span className="ctrl-label">Easing</span>
                <select
                  value={animation.easing}
                  onChange={(e) =>
                    onUpdateAnimation((a) => ({
                      ...a,
                      easing: e.target.value as CenterPathAnimation["easing"],
                    }))
                  }
                >
                  <option value="linear">linear</option>
                  <option value="ease-in-out">ease-in-out</option>
                  <option value="ease-in">ease-in</option>
                  <option value="ease-out">ease-out</option>
                </select>
              </label>
              <fieldset className="ctrl">
                <legend>Direction</legend>
                {(["out", "out-and-back", "loop"] as CenterPathAnimation["direction"][]).map((value) => (
                  <label key={value} className="radio">
                    <input
                      type="radio"
                      name="centerPathDirection"
                      checked={animation.direction === value}
                      onChange={() =>
                        onUpdateAnimation((a) => {
                          const closed = value === "loop" ? true : a.closed;
                          return {
                            ...a,
                            direction: value,
                            closed,
                            path: { ...a.path, closed },
                          };
                        })
                      }
                    />
                    {value}
                  </label>
                ))}
              </fieldset>
              <fieldset className="ctrl">
                <legend>Orientation</legend>
                {(["fixed", "followPath"] as CenterPathAnimation["orientationMode"][]).map((value) => (
                  <label key={value} className="radio">
                    <input
                      type="radio"
                      name="centerPathOrientation"
                      checked={animation.orientationMode === value}
                      onChange={() => onUpdateAnimation((a) => ({ ...a, orientationMode: value }))}
                    />
                    {value === "fixed" ? "Fixed" : "Follow path"}
                  </label>
                ))}
              </fieldset>
              <label className="radio">
                <input
                  type="checkbox"
                  checked={animation.closed}
                  onChange={(e) =>
                    onUpdateAnimation((a) => ({
                      ...a,
                      closed: e.target.checked,
                      path: { ...a.path, closed: e.target.checked },
                      direction: e.target.checked
                        ? a.direction
                        : a.direction === "loop"
                        ? "out-and-back"
                        : a.direction,
                    }))
                  }
                />
                Closed path
              </label>
              <button type="button" className="danger" onClick={onDeleteAnimation}>
                Delete animation
              </button>
            </>
          )}
        </fieldset>
      </fieldset>
    </div>
  );
}
