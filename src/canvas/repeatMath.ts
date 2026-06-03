// PURE functions only. This is the one place correctness matters independent of
// rendering, so it stays free of DOM and React and is unit-tested. PRD §3, §8.
import type { Box, RepeatParams } from "../types";

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Compact number formatter so transform strings stay readable (and -0 -> 0). */
function f(n: number): string {
  const r = Math.round(n * 1e4) / 1e4;
  return Object.is(r, -0) ? "0" : String(r);
}

export function angleStep(count: number): number {
  return 360 / count;
}

/**
 * The full transform string for copy `i` of the repeat, relative to the
 * repeat-root local origin (which carries translate(cx,cy)). Instances never
 * reference the center. PRD §8.
 */
export function instanceTransform(p: RepeatParams, i: number): string {
  const angle = p.angleOffset + i * angleStep(p.count);
  const scale = 1 + i * p.scaleStep; // scaleStep can be negative
  const mirror = p.mirrorAlternates && i % 2 === 1 ? -1 : 1;

  // Place onto the spoke, then apply the copy's own orientation as a final
  // local rotation, then mirror/scale.
  const placement = `rotate(${f(angle)}) translate(${f(p.radiusOffset)},0)`;

  const localOrientation =
    p.orientationMode === "rotateWithCircle"
      ? // copy faces outward along its spoke
        `rotate(${f(p.sourceRotation)})`
      : // cancel the spoke angle: identical screen orientation for every copy
        `rotate(${f(p.sourceRotation - angle)})`;

  const scaleStr = `scale(${f(mirror * scale)},${f(scale)})`;

  return `${placement} ${localOrientation} ${scaleStr}`;
}

export function instanceOpacity(p: RepeatParams, i: number): number {
  return clamp(1 + i * p.opacityStep, 0, 1);
}

/** range(n) -> [0, 1, ..., n-1] */
export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/**
 * A representative, evenly-spaced subset of instance indices for the drag-time
 * fidelity fallback. Preserves the gestalt of the pattern while dragging. PRD §9.
 */
export function subsetIndices(count: number, cap: number): number[] {
  if (count <= cap) return range(count);
  const out: number[] = [];
  for (let k = 0; k < cap; k++) {
    const i = Math.round((k * count) / cap);
    if (out[out.length - 1] !== i) out.push(i);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seam handling
//
// Copies paint 0..N-1 and in SVG later = on top, so the over/under relationship
// is consistent the whole way around EXCEPT the wrap, where the last-painted
// copy sits over the first — the spiral "wants" the opposite. That single
// inconsistent adjacency is the seam. It is conserved: you can move it or hide
// it, never delete it.
// ---------------------------------------------------------------------------

/**
 * The order copies are painted (= z-order), rotated by paintOffset. The seam
 * falls between the last entry and the first. Each entry is a true copy index,
 * so geometry is unchanged — only z-order moves. Relocating the seam. PRD seam.
 */
export function paintOrder(count: number, paintOffset: number): number[] {
  const off = ((Math.round(paintOffset) % count) + count) % count;
  const out: number[] = [];
  for (let k = 0; k < count; k++) out.push((off + k) % count);
  return out;
}

/** The first `seamBlend` painted copies — the ones redrawn (tucked) over the
 *  last-painted copies inside the wedge. Clamped to [1, count]. */
export function tuckIndices(
  count: number,
  paintOffset: number,
  seamBlend: number
): number[] {
  const k = clamp(Math.round(seamBlend), 1, count);
  return paintOrder(count, paintOffset).slice(0, k);
}

/** Largest |scale| across copies — used to size the wedge so it covers every
 *  (possibly scaled) petal. */
export function maxAbsScale(p: RepeatParams): number {
  let m = 1;
  for (let i = 0; i < p.count; i++) m = Math.max(m, Math.abs(1 + i * p.scaleStep));
  return m;
}

/** Outer radius the seam wedge must reach to clip every petal. Depends on
 *  radius + motif size + scale — NOT the center. */
export function seamReach(p: RepeatParams, box: Box): number {
  return p.radiusOffset + Math.hypot(box.width, box.height) * maxAbsScale(p) + 24;
}

/**
 * Clip-path geometry for the tuck, in repeat-root LOCAL coordinates (origin at
 * the center). A pie sector straddling the seam: from `seamBlend` steps clockwise
 * of the first-painted copy (covering its lap over the last-painted copies) to
 * just past that copy's spoke (so the over/under flip is cut mid-petal, where it
 * isn't legible — not in the gap, which would just relocate the seam).
 *
 * Outer edge sampled as a polygon to dodge SVG arc-flag ambiguity. Depends only
 * on count/angle/paintOffset/seamBlend/radius/scale, never center, so it travels
 * with translate(cx,cy) and costs nothing during a center drag.
 */
export function seamWedgePath(p: RepeatParams, reach: number): string {
  const step = angleStep(p.count);
  const seamAngle = p.angleOffset + p.paintOffset * step; // first-painted copy's spoke
  const from = seamAngle - clamp(Math.round(p.seamBlend), 1, p.count) * step;
  const to = seamAngle + step / 2;
  const samples = Math.max(2, Math.ceil(Math.abs(to - from) / 4));
  const pts: string[] = ["0,0"];
  for (let s = 0; s <= samples; s++) {
    const a = ((from + ((to - from) * s) / samples) * Math.PI) / 180;
    pts.push(`${f(reach * Math.cos(a))},${f(reach * Math.sin(a))}`);
  }
  return `M ${pts.join(" L ")} Z`;
}
