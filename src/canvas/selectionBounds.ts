// Pure bounds math for the selection gizmo. Kept separate so App and the canvas
// hooks share one definition.
import { boundsReach } from "./repeatMath";
import type { Box, Center, Layer, RepeatParams } from "../types";

/** Gizmo bounds in world coords: center + half-extents. */
export interface GBounds {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

/** A layer's on-canvas artwork half-extent (radius reach × its uniform scale). */
export function layerReach(params: RepeatParams, box: Box, scale: number): number {
  return boundsReach(params, box) * scale;
}

/** Union AABB of the given layers' artwork boxes, or null if empty. */
export function unionBounds(layers: Layer[]): GBounds | null {
  if (layers.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of layers) {
    const r = layerReach(l.params, l.motif.box, l.scale);
    minX = Math.min(minX, l.center.x - r);
    minY = Math.min(minY, l.center.y - r);
    maxX = Math.max(maxX, l.center.x + r);
    maxY = Math.max(maxY, l.center.y + r);
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    hw: (maxX - minX) / 2,
    hh: (maxY - minY) / 2,
  };
}

export type { Center };
