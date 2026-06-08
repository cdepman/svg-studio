// Pencil tool: raw pointer points -> a smoothed SVG centerline path. Open
// strokes stay as stroked paths; snapped/closed strokes become filled shapes.
//
// A drawn shape is NOT a special case — it becomes a Motif exactly like an
// imported SVG (centered on its bbox via anchorX/anchorY). PRD §5, §13, §14.
import { getStrokePoints } from "perfect-freehand";
import { singlePart } from "./parts";
import type { Box, Center, Motif } from "../types";

export interface PencilPoint extends Center {
  /** 0..1 pointer pressure, defaulting to 0.5 when unavailable. */
  pressure: number;
}

export interface PencilSettings {
  /** Brush width in SCREEN px (converted to world units at draw time). */
  size: number;
  /** 0..100 — maps to perfect-freehand streamline + smoothing. PRD §11. */
  smoothing: number;
  /** 0..100 — 0 ignores pressure; 100 gives a strong width response. */
  pressure: number;
}

export const DEFAULT_PENCIL: PencilSettings = {
  size: 2,
  smoothing: 70,
  pressure: 0,
};

/** The default fill for new shapes; user-changeable via the color swatch. */
export const DEFAULT_FILL = "#7c93ff";

/** Map the single 0..100 smoothing control to perfect-freehand options. PRD §11. */
function strokeOptions(size: number, smoothing: number, pressure = 0) {
  const t = Math.max(0, Math.min(1, smoothing / 100));
  const p = Math.max(0, Math.min(1, pressure / 100));
  return {
    size,
    // more = more aggressively follows a smoothed path / rounder corners
    streamline: 0.2 + t * 0.65,
    smoothing: 0.3 + t * 0.65,
    thinning: p * 0.75,
    simulatePressure: false,
    last: true,
  };
}

function pressurePoints(worldPoints: readonly (Center | PencilPoint)[], pressureSensitivity: number): [number, number, number][] {
  const usePressure = pressureSensitivity > 0;
  return worldPoints.map((p) => [p.x, p.y, usePressure ? ("pressure" in p ? p.pressure : 0.5) : 0.5]);
}

const f = (n: number) => Math.round(n * 100) / 100;

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const triArea = (a: number[], b: number[], c: number[]) =>
  Math.abs((a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])) / 2);

function simplifyCenterline(points: number[][], worldSize: number, smoothing: number, closed: boolean): number[][] {
  if (points.length <= 3) return points;
  const t = Math.max(0, Math.min(1, smoothing / 100));
  const minGap = Math.max(1, worldSize * (0.5 + t * 0.9));
  const tolerance = Math.max(2.5, worldSize * (1.8 + t * 3.2));
  const threshold = tolerance * tolerance * 0.5;
  const maxPoints = Math.round(48 - t * 32);

  const compact: number[][] = [];
  for (const p of points) {
    const prev = compact[compact.length - 1];
    if (!prev || dist(prev, p) >= minGap) compact.push(p);
  }
  if (compact.length <= 3) return compact;

  const pts = closed && dist(compact[0], compact[compact.length - 1]) < Math.max(worldSize * 3, 6)
    ? compact.slice(0, -1)
    : compact.slice();
  const minPoints = closed ? 4 : 2;

  while (pts.length > minPoints) {
    let bestIdx = -1;
    let bestArea = Infinity;
    const start = closed ? 0 : 1;
    const end = closed ? pts.length : pts.length - 1;
    for (let i = start; i < end; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      const area = triArea(prev, cur, next);
      if (area < bestArea) {
        bestArea = area;
        bestIdx = i;
      }
    }
    if (bestIdx < 0 || (bestArea >= threshold && pts.length <= maxPoints)) break;
    pts.splice(bestIdx, 1);
  }

  return closed ? [...pts, pts[0]] : pts;
}

function centerline(worldPoints: readonly (Center | PencilPoint)[], worldSize: number, smoothing: number, pressure = 0, closed = false): number[][] {
  const raw = getStrokePoints(
    pressurePoints(worldPoints, pressure),
    strokeOptions(worldSize, smoothing, pressure)
  ).map((s) => s.point);
  return simplifyCenterline(raw, worldSize, smoothing, closed);
}

/** Canonical points -> compact cubic SVG path. Closed paths get a trailing Z. */
export function svgPathFromStroke(points: number[][], closed = true): string {
  const len = points.length;
  if (len < 2) return "";
  if (len === 2) {
    const d = `M${f(points[0][0])},${f(points[0][1])} L${f(points[1][0])},${f(points[1][1])}`;
    return closed ? `${d} Z` : d;
  }
  if (len === 3) {
    const d = `M${f(points[0][0])},${f(points[0][1])} Q${f(points[1][0])},${f(points[1][1])} ${f(points[2][0])},${f(points[2][1])}`;
    return closed ? `${d} Z` : d;
  }
  const pts = closed && dist(points[0], points[len - 1]) < 0.001 ? points.slice(0, -1) : points;
  const n = pts.length;
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${f(c1[0])},${f(c1[1])} ${f(c2[0])},${f(c2[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return closed ? `${d} Z` : d;
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

function rawPointSpan(points: readonly (Center | PencilPoint)[]): { width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { width: maxX - minX, height: maxY - minY };
}

/** Live-preview path `d` for the in-progress stroke (world coords). */
export function pencilPreviewPath(
  worldPoints: readonly (Center | PencilPoint)[],
  worldStrokeWidth: number,
  smoothing: number,
  pressure = 0,
  closed = false
): string {
  if (worldPoints.length < 2) return "";
  return svgPathFromStroke(centerline(worldPoints, Math.max(1, worldStrokeWidth), smoothing, pressure, closed), closed);
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
  /** `<path …>` markup. Open strokes are centerline paths; closed strokes are filled regions. */
  pathHtml: string;
  /** The path bbox padded by half the stroke width, world coords. */
  box: Box;
}

/**
 * One finished stroke as a CLOSED FILLED path + its world bbox, or null if too
 * small (a stray click). `worldStrokeWidth` is already in world units.
 */
export function strokeToFilledPath(
  worldPoints: readonly (Center | PencilPoint)[],
  worldStrokeWidth: number,
  smoothing: number,
  fillColor: string,
  strokeColor: string,
  strokeWidth: number,
  pressure = 0,
  closed = false
): FilledStroke | null {
  if (worldPoints.length < 2) return null;
  const raw = rawPointSpan(worldPoints);
  if (raw.width < MIN_SIZE && raw.height < MIN_SIZE) return null;
  const effectiveStrokeWidth = closed ? Math.max(0, strokeWidth) : Math.max(0.5, strokeWidth);
  const smoothingSize = Math.max(1, worldStrokeWidth);
  const points = centerline(worldPoints, smoothingSize, smoothing, pressure, closed);
  const d = svgPathFromStroke(points, closed);
  if (!d) return null;
  const box = pointsBox(points, effectiveStrokeWidth / 2);
  if (box.width < MIN_SIZE && box.height < MIN_SIZE) return null;
  const pathHtml = closed
    ? `<path d="${d}" fill="${fillColor}" stroke="${strokeColor}" stroke-width="${f(effectiveStrokeWidth)}" stroke-linejoin="round" stroke-linecap="round" />`
    : `<path d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${f(effectiveStrokeWidth)}" stroke-linejoin="round" stroke-linecap="round" />`;
  return { pathHtml, box };
}

export interface DrawnMotif {
  motif: Motif;
  /** World position of the shape's visual center — the new layer's center. */
  worldCenter: Center;
}

/** Convenience: a single stroke straight into a normalized Motif. */
export function createDrawnMotif(
  worldPoints: readonly (Center | PencilPoint)[],
  worldStrokeWidth: number,
  smoothing: number,
  fillColor: string,
  strokeColor = fillColor,
  strokeWidth = worldStrokeWidth,
  pressure = 0,
  closed = false
): DrawnMotif | null {
  const sp = strokeToFilledPath(worldPoints, worldStrokeWidth, smoothing, fillColor, strokeColor, strokeWidth, pressure, closed);
  if (!sp) return null;
  const c = boxCenter(sp.box);
  return {
    motif: {
      innerHtml: sp.pathHtml,
      parts: [singlePart(sp.pathHtml, "Shape 1", sp.box)],
      anchorX: c.x,
      anchorY: c.y,
      box: sp.box,
      weight: 1,
      simplified: false,
    },
    worldCenter: c,
  };
}
