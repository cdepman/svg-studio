// Pencil tool: raw pointer points -> a smooth, CLOSED, FILLED region -> a
// normalized Motif. We use perfect-freehand's `getStrokePoints` to streamline
// the centerline (no hand-rolled smoothing), then build a closed quadratic path
// from it and FILL the interior (plus a same-color round stroke so thin shapes
// still have body). This fills the object you draw, not just the pen ribbon.
//
// A drawn shape is NOT a special case — it becomes a Motif exactly like an
// imported SVG (centered on its bbox via anchorX/anchorY). PRD §5, §13, §14.
import { getStrokePoints } from "perfect-freehand";
import type { Box, Center, Motif } from "../types";

export interface PencilSettings {
  /** Brush width in SCREEN px (converted to world units at draw time). */
  size: number;
  /** 0..100 — maps to perfect-freehand streamline + smoothing. PRD §11. */
  smoothing: number;
  fillColor: string;
}

export const DEFAULT_PENCIL: PencilSettings = {
  size: 18,
  smoothing: 55,
  fillColor: "#7c93ff",
};

/** Map the single 0..100 smoothing control to perfect-freehand options. PRD §11. */
function strokeOptions(size: number, smoothing: number) {
  const t = Math.max(0, Math.min(1, smoothing / 100));
  return {
    size,
    // more = more aggressively follows a smoothed path / rounder corners
    streamline: 0.2 + t * 0.65,
    smoothing: 0.3 + t * 0.65,
    thinning: 0, // V1: uniform width (no pressure)
    simulatePressure: false,
    last: true,
  };
}

const avg = (a: number, b: number) => (a + b) / 2;
const f = (n: number) => Math.round(n * 100) / 100;

/** Streamlined centerline points for the stroke (perfect-freehand smoothing). */
function centerline(worldPoints: Center[], worldSize: number, smoothing: number): number[][] {
  return getStrokePoints(
    worldPoints.map((p) => [p.x, p.y]),
    strokeOptions(worldSize, smoothing)
  ).map((s) => s.point);
}

/** Canonical perfect-freehand outline -> quadratic SVG path (closed). */
export function svgPathFromStroke(points: number[][]): string {
  const len = points.length;
  if (len < 4) return "";
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let d = `M${f(a[0])},${f(a[1])} Q${f(b[0])},${f(b[1])} ${f(avg(b[0], c[0]))},${f(avg(b[1], c[1]))} T`;
  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${f(avg(a[0], b[0]))},${f(avg(a[1], b[1]))} `;
  }
  return d + "Z";
}

function pointsBox(points: number[][], pad: number): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad };
}

/** Live-preview path `d` for the in-progress stroke (world coords). */
export function pencilPreviewPath(
  worldPoints: Center[],
  worldSize: number,
  smoothing: number
): string {
  if (worldPoints.length < 2) return "";
  return svgPathFromStroke(centerline(worldPoints, worldSize, smoothing));
}

/** Smallest bbox dimension (world units) below which a stroke is discarded. PRD §18. */
const MIN_SIZE = 4;

export const boxCenter = (b: Box): Center => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

export function unionBox(a: Box, b: Box): Box {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export interface FilledStroke {
  /** `<path …>` markup: closed region, literal fill + same-color round stroke
   *  (no currentColor — PRD §12). */
  pathHtml: string;
  /** The stroke's bbox (centerline padded by half the brush width), world coords. */
  box: Box;
}

/**
 * One finished stroke as a CLOSED FILLED path + its world bbox, or null if too
 * small (a stray click). `worldSize` is the brush width already in world units.
 * The region you drew is filled — not just the pen ribbon. Multiple strokes
 * compose one motif by concatenating pathHtml and unioning boxes. PRD §12, §13.
 */
export function strokeToFilledPath(
  worldPoints: Center[],
  worldSize: number,
  smoothing: number,
  fillColor: string
): FilledStroke | null {
  if (worldPoints.length < 2) return null;
  const cl = centerline(worldPoints, worldSize, smoothing);
  const d = svgPathFromStroke(cl);
  if (!d) return null;
  const box = pointsBox(cl, worldSize / 2);
  if (box.width < MIN_SIZE && box.height < MIN_SIZE) return null;
  // Fill the interior; the same-color round stroke gives thin shapes body and
  // smooth edges. Single literal color, no currentColor.
  const pathHtml =
    `<path d="${d}" fill="${fillColor}" stroke="${fillColor}" stroke-width="${f(worldSize)}" ` +
    `stroke-linejoin="round" stroke-linecap="round" />`;
  return { pathHtml, box };
}

export interface DrawnMotif {
  motif: Motif;
  /** World position of the shape's visual center — the new layer's center. */
  worldCenter: Center;
}

/** Convenience: a single stroke straight into a normalized Motif. */
export function createDrawnMotif(
  worldPoints: Center[],
  worldSize: number,
  smoothing: number,
  fillColor: string
): DrawnMotif | null {
  const sp = strokeToFilledPath(worldPoints, worldSize, smoothing, fillColor);
  if (!sp) return null;
  const c = boxCenter(sp.box);
  return {
    motif: { innerHtml: sp.pathHtml, anchorX: c.x, anchorY: c.y, box: sp.box, weight: 1, simplified: false },
    worldCenter: c,
  };
}
