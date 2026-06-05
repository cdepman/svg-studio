// Concurrent, looping ambient effects realized as injected CSS @keyframes —
// mirrors centerPath.ts. Each enabled effect adds one rule + keyframes per layer;
// per-copy phase ("stagger") is carried by per-instance CSS vars (negative
// animation-delay) so the effect travels around the ring. All effects compose
// (they animate different nested wrapper <g>s, one transform property each) and
// play/pause via animation-play-state, identical to the center-path motion.
import type { CSSProperties } from "react";
import { maxAbsScale } from "../canvas/repeatMath";
import { motionClassName } from "./centerPath";
import type { Layer, LayerEffects, RepeatParams } from "../types";

export function anyEffectEnabled(e?: LayerEffects): boolean {
  return (
    !!e &&
    (e.individualSpin.enabled ||
      e.compositeSpin.enabled ||
      e.scalePulse.enabled ||
      e.radialPulse.enabled ||
      !!e.wave?.enabled)
  );
}

/** A layer animates (needs the wrapper structure) if it has a center path OR any effect. */
export function isLayerAnimated(layer: Layer): boolean {
  return !!layer.animation?.enabled || anyEffectEnabled(layer.effects);
}

const num = (n: number) => (Object.is(Math.round(n * 1e4) / 1e4, -0) ? "0" : String(Math.round(n * 1e4) / 1e4));

/** Per-copy phase offset: copy i lags by i/count of the full cycle (negative so
 *  the loop starts already advanced — no startup dead time). */
function staggerDelay(stagger: boolean, periodSeconds: number, count: number, i: number): number {
  if (!stagger || count <= 0) return 0;
  return -((i % count) / count) * periodSeconds;
}

const GOLDEN_ANGLE = 2.399963229728653;

/** Phase a travelling wave around the ring. Frequency is cycles around the full circle;
 *  the optional golden-angle offset makes per-copy motion feel organic instead of locked. */
function waveDelay(
  periodSeconds: number,
  count: number,
  i: number,
  frequency: number,
  stagger: boolean
): number {
  if (count <= 0) return 0;
  const ringPhase = ((i % count) / count) * Math.max(0, frequency);
  const organicPhase = stagger ? (i * GOLDEN_ANGLE) / (Math.PI * 2) : 0;
  const phase = ((ringPhase + organicPhase) % 1 + 1) % 1;
  return -phase * periodSeconds;
}

/** Extra world-px reach the effects add, so seam/tuck and export bounds cover the
 *  animated extremes. Spin rotates a copy about its own center → no extra reach. */
export function effectsReachPaddingForGeometry(
  params: RepeatParams,
  motifBox: { width: number; height: number },
  effects?: LayerEffects
): number {
  if (!effects) return 0;
  const halfDiag = 0.5 * Math.hypot(motifBox.width, motifBox.height) * maxAbsScale(params);
  const pulse = effects.scalePulse.enabled ? effects.scalePulse.amount * halfDiag : 0;
  const radial = effects.radialPulse.enabled ? effects.radialPulse.amount : 0;
  const wave = effects.wave?.enabled ? effects.wave.amount : 0;
  return pulse + radial + wave;
}

export function effectsReachPadding(layer: Layer): number {
  return effectsReachPaddingForGeometry(layer.params, layer.motif.box, layer.effects);
}

/** Per-copy CSS vars (stagger delays + the scale-adjusted radial amount). */
function effectVars(layer: Layer, i: number): Record<string, string> | null {
  const e = layer.effects;
  if (!anyEffectEnabled(e) || !e) return null;
  const count = layer.params.count;
  const vars: Record<string, string> = {};
  if (e.individualSpin.enabled) {
    vars["--spin-delay"] = `${num(staggerDelay(e.individualSpin.stagger, e.individualSpin.periodSeconds, count, i))}s`;
  }
  if (e.scalePulse.enabled) {
    vars["--pulse-delay"] = `${num(staggerDelay(e.scalePulse.stagger, e.scalePulse.periodSeconds, count, i))}s`;
  }
  if (e.radialPulse.enabled) {
    vars["--radial-delay"] = `${num(staggerDelay(e.radialPulse.stagger, e.radialPulse.periodSeconds, count, i))}s`;
    // The radial wrapper lives inside repeat-scale(layer.scale), so divide to read as world px.
    vars["--radial-amt"] = `${num(e.radialPulse.amount / (layer.scale || 1))}px`;
  }
  if (e.wave?.enabled) {
    vars["--wave-delay"] = `${num(waveDelay(e.wave.periodSeconds, count, i, e.wave.frequency, e.wave.stagger))}s`;
    // The wave wrapper lives inside repeat-scale(layer.scale), so divide to read as world px.
    vars["--wave-amt"] = `${num(e.wave.amount / (layer.scale || 1))}px`;
  }
  return vars;
}

export function instanceEffectStyle(layer: Layer, i: number): CSSProperties | undefined {
  const vars = effectVars(layer, i);
  return vars ? (vars as CSSProperties) : undefined;
}

export function instanceEffectStyleText(layer: Layer, i: number): string {
  const vars = effectVars(layer, i);
  if (!vars) return "";
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return body ? ` style="${body}"` : "";
}

const playState = (playing: boolean) => (playing ? "running" : "paused");
const spinDir = (d: "cw" | "ccw") => (d === "cw" ? "normal" : "reverse");

export function effectsCss(layer: Layer, playing: boolean): string {
  const e = layer.effects;
  if (!anyEffectEnabled(e) || !e) return "";
  const klass = motionClassName(layer.id);
  const out: string[] = [];

  if (e.individualSpin.enabled) {
    const dur = Math.max(0.01, e.individualSpin.periodSeconds);
    out.push(`.${klass} .instance-spin-wrapper {
  animation: ${klass}-spin ${num(dur)}s linear var(--spin-delay, 0s) infinite;
  animation-direction: ${spinDir(e.individualSpin.direction)};
  animation-play-state: ${playState(playing)};
}
@keyframes ${klass}-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`);
  }

  if (e.compositeSpin.enabled) {
    const dur = Math.max(0.01, e.compositeSpin.periodSeconds);
    out.push(`.${klass}-composite {
  animation: ${klass}-composite-spin ${num(dur)}s linear 0s infinite;
  animation-direction: ${spinDir(e.compositeSpin.direction)};
  animation-play-state: ${playState(playing)};
}
@keyframes ${klass}-composite-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`);
  }

  if (e.scalePulse.enabled) {
    const dur = Math.max(0.01, e.scalePulse.periodSeconds);
    const trough = Math.max(0.01, 1 - e.scalePulse.amount);
    const peak = 1 + e.scalePulse.amount;
    out.push(`.${klass} .instance-pulse-wrapper {
  animation: ${klass}-pulse ${num(dur)}s ease-in-out var(--pulse-delay, 0s) infinite;
  animation-play-state: ${playState(playing)};
}
@keyframes ${klass}-pulse {
  0%, 100% { transform: scale(1); }
  25% { transform: scale(${num(peak)}); }
  50% { transform: scale(1); }
  75% { transform: scale(${num(trough)}); }
}`);
  }

  if (e.radialPulse.enabled) {
    const dur = Math.max(0.01, e.radialPulse.periodSeconds);
    out.push(`.${klass} .instance-radial-wrapper {
  animation: ${klass}-radial ${num(dur)}s ease-in-out var(--radial-delay, 0s) infinite;
  animation-play-state: ${playState(playing)};
}
@keyframes ${klass}-radial {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(var(--radial-amt, 0px)); }
}`);
  }

  if (e.wave?.enabled) {
    const dur = Math.max(0.01, e.wave.periodSeconds);
    out.push(`.${klass} .instance-wave-wrapper {
  animation: ${klass}-wave ${num(dur)}s ease-in-out var(--wave-delay, 0s) infinite;
  animation-direction: ${spinDir(e.wave.direction)};
  animation-play-state: ${playState(playing)};
}
@keyframes ${klass}-wave {
  0%, 100% { transform: translateY(0); }
  25% { transform: translateY(var(--wave-amt, 0px)); }
  50% { transform: translateY(0); }
  75% { transform: translateY(calc(var(--wave-amt, 0px) * -1)); }
}`);
  }

  return out.join("\n");
}

export function effectsStyles(layers: Layer[], playing: boolean | ((layer: Layer) => boolean)): string {
  const isPlaying = typeof playing === "function" ? playing : () => playing;
  return layers.map((l) => effectsCss(l, isPlaying(l))).filter(Boolean).join("\n");
}
