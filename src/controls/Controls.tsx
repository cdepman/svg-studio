// Right inspector (design re-skin). Swaps by mode:
//   Design  → Repeat + Orientation + Seam + Secondary
//   Animate → Motion + Playback, with a collapsible "Layer properties" (repeat).
//
// Continuous sliders apply a RELATIVE DELTA and stay uncontrolled during a drag
// (native input/change listeners) so a slider drag triggers ZERO React renders.
import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icons";
import type { CenterPathAnimation, Layer, LayerEffects, OrientationMode, RepeatParams } from "../types";
import type { NumericParamKey } from "../canvas/useScene";

const DEFAULT_EFFECTS: LayerEffects = {
  individualSpin: { enabled: false, periodSeconds: 6, direction: "cw", stagger: false },
  compositeSpin: { enabled: false, periodSeconds: 12, direction: "cw" },
  scalePulse: { enabled: false, periodSeconds: 3, amount: 0.2, stagger: false },
  radialPulse: { enabled: false, periodSeconds: 3, amount: 40, stagger: false },
};

interface ControlsProps {
  mode: "design" | "animate";
  primary: Layer | null;
  selectionCount: number;
  allSelected: boolean;
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
  onUpdateEffects: (patch: (e: LayerEffects) => LayerEffects) => void;
}

const pct = (v: number, min: number, max: number) => ((v - min) / (max - min)) * 100;
const fillStyle = (v: number, min: number, max: number) =>
  ({ ["--fill" as string]: `${pct(v, min, max)}%` } as React.CSSProperties);

interface SliderDef {
  k: NumericParamKey;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}

/** Relative-delta slider (uncontrolled during drag). */
function DeltaSlider({
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
    const setFill = (v: number) => el.style.setProperty("--fill", `${pct(v, def.min, def.max)}%`);
    const onDown = () => {
      startRef.current = primaryParamsRef.current ? primaryParamsRef.current[def.k] : parseFloat(el.value);
      setDragging(true);
    };
    const onInput = () => {
      const v = parseFloat(el.value);
      setFill(v);
      if (outRef.current) outRef.current.textContent = def.fmt(v);
      applyParamDelta(def.k, v - startRef.current);
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
    <div className="ctl">
      <div className="ctl-row">
        <label className="ctl-label">{def.label}</label>
        <span className="ctl-val" ref={outRef}>{def.fmt(initial)}</span>
      </div>
      <input ref={inputRef} type="range" min={def.min} max={def.max} step={def.step} defaultValue={initial} style={fillStyle(initial, def.min, def.max)} />
    </div>
  );
}

/** Controlled (absolute) slider with a mono value chip. */
function ValueSlider({
  label, value, min, max, step, fmt, disabled, onChange, dim,
}: {
  label: string; value: number; min: number; max: number; step: number;
  fmt?: (v: number) => string; disabled?: boolean; dim?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="ctl">
      <div className="ctl-row">
        <label className="ctl-label">{label}</label>
        <span className="ctl-val">{dim ? "—" : (fmt ? fmt(value) : value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        style={fillStyle(value, min, max)} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

function RadioGroup<T extends string>({ value, options, onChange }: {
  value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <div>
      {options.map(([v, label]) => (
        <div key={v} className={`radio-row${value === v ? " on" : ""}`} onClick={() => onChange(v)}>
          <span className="radio-dot" />
          <span className="radio-label">{label}</span>
        </div>
      ))}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="toggle" onClick={() => onChange(!checked)}>
      <span className="toggle-label">{label}</span>
      <span className={`toggle-track${checked ? " is-on" : ""}`}><span className="toggle-knob" /></span>
    </button>
  );
}

const CORE: SliderDef[] = [
  { k: "angleOffset", label: "Angle offset", min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°` },
  { k: "radiusOffset", label: "Radius offset", min: 0, max: 600, step: 1, fmt: (v) => `${Math.round(v)}` },
  { k: "sourceRotation", label: "Source rotation", min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°` },
];
const SECONDARY: SliderDef[] = [
  { k: "scaleStep", label: "Scale step", min: -0.2, max: 0.2, step: 0.005, fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(3) },
  { k: "opacityStep", label: "Opacity step", min: -0.2, max: 0.2, step: 0.005, fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(3) },
];

export function Controls(props: ControlsProps) {
  const { mode, primary, selectionCount, allSelected, editable } = props;

  if (!primary) {
    return (
      <aside className="inspector">
        <div className="insp-head"><span className="insp-mode-pill"><span className="dot" />{mode}</span></div>
        <div className="empty-note" style={{ paddingTop: 40 }}>Select a layer to edit its settings.</div>
      </aside>
    );
  }

  const title = allSelected ? `All layers (${selectionCount})` : selectionCount > 1 ? `${selectionCount} layers` : primary.name;

  return (
    <aside className="inspector">
      <div className="insp-head">
        <span className="insp-mode-pill"><span className="dot" />{mode}</span>
        <span className="insp-sub"><b>{title}</b></span>
        <div className="panel-head-spacer" />
        <button className="iconbtn" onClick={props.onToggleVisible} title="Toggle visibility">
          {primary.visible ? Icon.eye({ size: 15 }) : Icon.eyeOff({ size: 15 })}
        </button>
        <button className="iconbtn" onClick={props.onToggleLocked} title="Toggle lock">
          {primary.locked ? Icon.lock({ size: 15 }) : Icon.unlock({ size: 15 })}
        </button>
      </div>
      {mode === "design"
        ? <DesignInspector {...props} editable={editable} />
        : <AnimateInspector {...props} editable={editable} />}
    </aside>
  );
}

function RepeatGroups({ collapsibleSecondary, ...props }: ControlsProps & { collapsibleSecondary?: boolean }) {
  const { primary, editable, selectionCount, primaryParamsRef, applyParamDelta, onCommitDelta, onCommitAbsolute, setDragging } = props;
  const p = primary!.params;
  const sliderProps = { primaryParamsRef, applyParamDelta, onCommitDelta, setDragging };
  const bodyKey = props.allSelected ? "__all__" : primary!.id;
  const [secOpen, setSecOpen] = useState(false);
  const multi = selectionCount > 1;

  const secondary = SECONDARY.map((def) => <DeltaSlider key={def.k} def={def} {...sliderProps} />);

  // Radius offset is an absolute world distance, so its useful range scales with
  // the motif's own size — a fixed cap "pops out too quickly" for big imported
  // SVGs and overshoots for tiny ones. Range it off the motif's half-diagonal.
  const motifReach = 0.5 * Math.hypot(primary!.motif.box.width, primary!.motif.box.height);
  const radiusMax = Math.max(480, Math.round(motifReach * 12));
  const core = CORE.map((def) => (def.k === "radiusOffset" ? { ...def, max: radiusMax } : def));

  return (
    <fieldset className="repeat-groups" disabled={!editable} key={bodyKey} style={{ border: "none", margin: 0, padding: 0, minWidth: 0 }}>
      <section className="group">
        <h2 className="group-title">Repeat <span className="gt-line" /></h2>
        <ValueSlider label="Count" value={p.count} min={1} max={128} step={1} dim={multi} disabled={multi}
          onChange={(v) => onCommitAbsolute({ count: Math.round(v) })} />
        {core.map((def) => <DeltaSlider key={def.k} def={def} {...sliderProps} />)}
      </section>

      <section className="group">
        <h2 className="group-title">Orientation <span className="gt-line" /></h2>
        <RadioGroup<OrientationMode> value={p.orientationMode}
          options={[["rotateWithCircle", "Rotate with circle"], ["keepUpright", "Keep upright"]]}
          onChange={(v) => onCommitAbsolute({ orientationMode: v })} />
      </section>

      <section className="group">
        <h2 className="group-title">Seam <span className="gt-line" /></h2>
        <Toggle label="Hide seam (automatic)" checked={p.tuck} onChange={(v) => onCommitAbsolute({ tuck: v })} />
        <div style={{ height: 12 }} />
        <ValueSlider label="Seam position" value={Math.min(p.paintOffset, Math.max(0, p.count - 1))} min={0} max={Math.max(0, p.count - 1)} step={1}
          disabled={!p.tuck} onChange={(v) => onCommitAbsolute({ paintOffset: Math.round(v) })} />
      </section>

      {collapsibleSecondary ? (
        <section className={`group collapsible${secOpen ? "" : " collapsed"}`}>
          <button className="col-head" onClick={() => setSecOpen((o) => !o)}>
            {Icon.chevron({ className: "chev" })}<span className="gt">Secondary</span><span className="gt-line" />
          </button>
          <div className="col-body">{secondary}</div>
        </section>
      ) : (
        <section className="group">
          <h2 className="group-title">Secondary <span className="gt-line" /></h2>
          {secondary}
        </section>
      )}
    </fieldset>
  );
}

function DesignInspector(props: ControlsProps) {
  return (
    <div className="insp-scroll scroll">
      <RepeatGroups {...props} />
    </div>
  );
}

function EffectsSection({ effects, onUpdateEffects }: { effects: LayerEffects; onUpdateEffects: ControlsProps["onUpdateEffects"]; }) {
  const dirOpts: [LayerEffects["individualSpin"]["direction"], string][] = [["cw", "Clockwise"], ["ccw", "Counter-cw"]];
  return (
    <section className="group">
      <h2 className="group-title">Effects <span className="gt-line" /></h2>

      <Toggle label="Spin petals" checked={effects.individualSpin.enabled}
        onChange={(v) => onUpdateEffects((e) => ({ ...e, individualSpin: { ...e.individualSpin, enabled: v } }))} />
      {effects.individualSpin.enabled && (
        <>
          <ValueSlider label="Spin period" value={effects.individualSpin.periodSeconds} min={0.5} max={30} step={0.5} fmt={(v) => `${v.toFixed(1)}s`}
            onChange={(v) => onUpdateEffects((e) => ({ ...e, individualSpin: { ...e.individualSpin, periodSeconds: v } }))} />
          <RadioGroup value={effects.individualSpin.direction} options={dirOpts}
            onChange={(d) => onUpdateEffects((e) => ({ ...e, individualSpin: { ...e.individualSpin, direction: d } }))} />
          <Toggle label="Stagger around ring" checked={effects.individualSpin.stagger}
            onChange={(v) => onUpdateEffects((e) => ({ ...e, individualSpin: { ...e.individualSpin, stagger: v } }))} />
        </>
      )}

      <div style={{ height: 10 }} />
      <Toggle label="Spin whole ring" checked={effects.compositeSpin.enabled}
        onChange={(v) => onUpdateEffects((e) => ({ ...e, compositeSpin: { ...e.compositeSpin, enabled: v } }))} />
      {effects.compositeSpin.enabled && (
        <>
          <ValueSlider label="Ring period" value={effects.compositeSpin.periodSeconds} min={1} max={60} step={0.5} fmt={(v) => `${v.toFixed(1)}s`}
            onChange={(v) => onUpdateEffects((e) => ({ ...e, compositeSpin: { ...e.compositeSpin, periodSeconds: v } }))} />
          <RadioGroup value={effects.compositeSpin.direction} options={dirOpts}
            onChange={(d) => onUpdateEffects((e) => ({ ...e, compositeSpin: { ...e.compositeSpin, direction: d } }))} />
        </>
      )}

      <div style={{ height: 10 }} />
      <Toggle label="Scale pulse" checked={effects.scalePulse.enabled}
        onChange={(v) => onUpdateEffects((e) => ({ ...e, scalePulse: { ...e.scalePulse, enabled: v } }))} />
      {effects.scalePulse.enabled && (
        <>
          <ValueSlider label="Pulse period" value={effects.scalePulse.periodSeconds} min={0.5} max={20} step={0.5} fmt={(v) => `${v.toFixed(1)}s`}
            onChange={(v) => onUpdateEffects((e) => ({ ...e, scalePulse: { ...e.scalePulse, periodSeconds: v } }))} />
          <ValueSlider label="Amount" value={effects.scalePulse.amount} min={0.05} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onUpdateEffects((e) => ({ ...e, scalePulse: { ...e.scalePulse, amount: v } }))} />
          <Toggle label="Stagger around ring" checked={effects.scalePulse.stagger}
            onChange={(v) => onUpdateEffects((e) => ({ ...e, scalePulse: { ...e.scalePulse, stagger: v } }))} />
        </>
      )}

      <div style={{ height: 10 }} />
      <Toggle label="Radial pulse" checked={effects.radialPulse.enabled}
        onChange={(v) => onUpdateEffects((e) => ({ ...e, radialPulse: { ...e.radialPulse, enabled: v } }))} />
      {effects.radialPulse.enabled && (
        <>
          <ValueSlider label="Pulse period" value={effects.radialPulse.periodSeconds} min={0.5} max={20} step={0.5} fmt={(v) => `${v.toFixed(1)}s`}
            onChange={(v) => onUpdateEffects((e) => ({ ...e, radialPulse: { ...e.radialPulse, periodSeconds: v } }))} />
          <ValueSlider label="Amount" value={effects.radialPulse.amount} min={5} max={300} step={5} fmt={(v) => `${Math.round(v)}px`}
            onChange={(v) => onUpdateEffects((e) => ({ ...e, radialPulse: { ...e.radialPulse, amount: v } }))} />
          <Toggle label="Stagger around ring" checked={effects.radialPulse.stagger}
            onChange={(v) => onUpdateEffects((e) => ({ ...e, radialPulse: { ...e.radialPulse, stagger: v } }))} />
        </>
      )}
    </section>
  );
}

function AnimateInspector(props: ControlsProps) {
  const { primary, animationEditable, drawingMotionPath, animationPlaying, onBeginAnimateCenter, onTogglePlayback, onDeleteAnimation, onUpdateAnimation, onUpdateEffects } = props;
  const animation = primary!.animation?.type === "centerPath" ? primary!.animation : null;
  const effects = primary!.effects ?? DEFAULT_EFFECTS;

  return (
    <div className="insp-scroll scroll">
      <section className="group">
        <button className="play-btn" onClick={onTogglePlayback} style={{ marginBottom: 13 }} disabled={!animationEditable}>
          {animationPlaying ? Icon.pause() : Icon.play()} {animationPlaying ? "Pause" : "Preview"}
        </button>
      </section>

      {animation ? (
        <>
          <section className="group">
            <h2 className="group-title">Motion path <span className="gt-line" /></h2>
            <div className="anim-actions" style={{ marginBottom: 15 }}>
              <button className={`btn${drawingMotionPath ? " btn-accent" : ""}`} onClick={onBeginAnimateCenter}>
                {Icon.pen({ size: 15 })} Edit path
              </button>
            </div>
            <ValueSlider label="Duration" value={animation.durationSeconds} min={0.5} max={20} step={0.5} fmt={(v) => `${v.toFixed(1)}s`}
              onChange={(v) => onUpdateAnimation((a) => ({ ...a, durationSeconds: v }))} />
            <ValueSlider label="Delay" value={animation.delaySeconds} min={0} max={10} step={0.5} fmt={(v) => `${v.toFixed(1)}s`}
              onChange={(v) => onUpdateAnimation((a) => ({ ...a, delaySeconds: v }))} />
            <div className="ctl">
              <div className="ctl-row"><label className="ctl-label">Easing</label></div>
              <div className="field-select">
                <select value={animation.easing} onChange={(e) => onUpdateAnimation((a) => ({ ...a, easing: e.target.value as CenterPathAnimation["easing"] }))}>
                  <option value="linear">Linear</option>
                  <option value="ease-in">Ease in</option>
                  <option value="ease-out">Ease out</option>
                  <option value="ease-in-out">Ease in-out</option>
                </select>
                {Icon.chevron({ className: "fs-chev" })}
              </div>
            </div>
            <div style={{ height: 12 }} />
            <RadioGroup<CenterPathAnimation["direction"]> value={animation.direction}
              options={[["out", "Out"], ["out-and-back", "Out and back"], ["loop", "Loop"]]}
              onChange={(value) => onUpdateAnimation((a) => {
                const closed = value === "loop" ? true : a.closed;
                return { ...a, direction: value, closed, path: { ...a.path, closed } };
              })} />
            <div style={{ height: 12 }} />
            <div className="group-title" style={{ marginBottom: 8 }}>Orientation <span className="gt-line" /></div>
            <RadioGroup<CenterPathAnimation["orientationMode"]> value={animation.orientationMode}
              options={[["fixed", "Fixed"], ["followPath", "Follow path"]]}
              onChange={(value) => onUpdateAnimation((a) => ({ ...a, orientationMode: value }))} />
            <div style={{ height: 12 }} />
            <button className="danger-link" onClick={onDeleteAnimation}>Delete motion path</button>
          </section>
        </>
      ) : (
        <section className="group">
          <button className="btn" onClick={onBeginAnimateCenter} disabled={!animationEditable}>
            {Icon.add({ size: 16 })} Add motion path
          </button>
        </section>
      )}

      <EffectsSection effects={effects} onUpdateEffects={onUpdateEffects} />

      <RepeatGroups {...props} collapsibleSecondary />
    </div>
  );
}
