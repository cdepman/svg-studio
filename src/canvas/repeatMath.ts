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
  return `${instanceSpokeTransform(p, i)} ${instanceLocalTransform(p, i)}`;
}

export function instanceSpokeTransform(p: RepeatParams, i: number): string {
  const angle = p.angleOffset + i * angleStep(p.count);
  return `rotate(${f(angle)}) translate(${f(p.radiusOffset)},0)`;
}

export function instanceLocalTransform(p: RepeatParams, i: number): string {
  const angle = p.angleOffset + i * angleStep(p.count);
  const scale = (1 + i * p.scaleStep) * p.sourceScale; // scaleStep can be negative

  const localOrientation =
    p.orientationMode === "rotateWithCircle"
      ? // copy faces outward along its spoke
        `rotate(${f(p.sourceRotation)})`
      : // cancel the spoke angle: identical screen orientation for every copy
        `rotate(${f(p.sourceRotation - angle)})`;

  return `${localOrientation} scale(${f(scale)})`;
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

/** Largest |scale| across copies — used to size the wedge so it covers every
 *  (possibly scaled) petal. */
export function maxAbsScale(p: RepeatParams): number {
  let m = 1;
  for (let i = 0; i < p.count; i++) m = Math.max(m, Math.abs(1 + i * p.scaleStep));
  return m * Math.abs(p.sourceScale);
}

/** Half-extent of a layer's artwork from its center: the farthest a (possibly
 *  scaled) copy reaches. Used for the on-canvas selection bounding box and
 *  export bounds. Depends on radius + motif size + scale — NOT the center. */
export function boundsReach(p: RepeatParams, box: Box): number {
  return p.radiusOffset + 0.5 * Math.hypot(box.width, box.height) * maxAbsScale(p);
}

/** How far a copy reaches inward from its placement point (the anchor sits at
 *  radiusOffset). When this exceeds radiusOffset, copies overlap the layer
 *  center and reach into the opposite half of the ring. */
export function motifInnerReach(p: RepeatParams, box: Box): number {
  return 0.5 * Math.hypot(box.width, box.height) * maxAbsScale(p);
}

/** The seam-tuck split clips the ring into two complementary half-disks centred
 *  on the layer center. That's only valid when copies stay on their own side —
 *  i.e. don't reach past the center. For tightly-packed rings (small radius,
 *  large motif) the copies cross over, so the pie-sector clip would cut a chunk
 *  out of the ring; in that case tuck must be skipped (single normal pass). */
export function motifCrossesCenter(p: RepeatParams, box: Box): boolean {
  return motifInnerReach(p, box) > p.radiusOffset;
}


function sectorPath(fromDeg: number, toDeg: number, reach: number): string {
  const samples = Math.max(2, Math.ceil(Math.abs(toDeg - fromDeg) / 4));
  const pts: string[] = ["0,0"];
  for (let s = 0; s <= samples; s++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * s) / samples) * Math.PI) / 180;
    pts.push(`${f(reach * Math.cos(a))},${f(reach * Math.sin(a))}`);
  }
  return `M ${pts.join(" L ")} Z`;
}

export interface SeamHalves {
  /** Clip `d` for the half opposite the seam (excludes the seam angle). */
  oppHalfD: string;
  /** Clip `d` for the half containing the seam (excludes the rotated seam). */
  seamHalfD: string;
  /** Paint order for the opposite half (normal; its seam is at `seamAngle`). */
  oppOrder: number[];
  /** Paint order for the seam half (rotated 180°; its seam is on the far side). */
  seamOrder: number[];
}

/**
 * The seam is unavoidable in ANY single global paint order (the card-loop
 * paradox), so we don't use one. We split the ring into two complementary
 * half-disks:
 *
 *  - the half OPPOSITE the chosen seam is drawn in the normal order, whose own
 *    discontinuity sits at `seamAngle` — outside this half, so invisible here;
 *  - the half CONTAINING the seam is drawn in an order rotated by ~N/2, whose
 *    discontinuity sits at `seamAngle + 180°` — outside this half too.
 *
 * The clips are complementary, so every pixel is painted exactly once (no
 * double-blend), and the two boundaries sit 90° from either discontinuity, where
 * the two orders agree on every overlap — so the join is seamless. There is NO
 * depth parameter: the only choice is where to put the (hidden) split.
 *
 * Depends only on params + box, never the center.
 */
export function seamHalves(p: RepeatParams, box: Box, extraReach = 0): SeamHalves {
  const step = angleStep(p.count);
  const F = ((Math.round(p.paintOffset) % p.count) + p.count) % p.count;
  // The fault line is the gap between the last- and first-painted copy.
  const seamAngle = p.angleOffset + F * step - step / 2;
  const half = Math.round(p.count / 2);
  const reach = boundsReach(p, box) + Math.max(0, extraReach) + 8;

  return {
    oppHalfD: sectorPath(seamAngle + 90, seamAngle + 270, reach),
    seamHalfD: sectorPath(seamAngle - 90, seamAngle + 90, reach),
    oppOrder: paintOrder(p.count, F),
    seamOrder: paintOrder(p.count, (F + half) % p.count),
  };
}
