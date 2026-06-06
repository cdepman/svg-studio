// Pan/zoom state and screen<->world mapping. PRD §5.
// The svg fills its container with no viewBox, so 1 user unit = 1 CSS px before
// the pan/zoom group's transform. Pan/zoom may use React state for the spike: a
// re-render per wheel tick only changes the group transform, not instance geometry.
import { useCallback, useState } from "react";
import { clamp } from "./repeatMath";
import type { Viewport } from "../types";

const MIN_S = 0.1;
const MAX_S = 12;

export interface ViewportApi {
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
  /** Zoom anchored at an svg-local point (the point under the cursor stays put). */
  zoomAt: (lx: number, ly: number, deltaY: number) => void;
  /** Zoom by a scale factor anchored at an svg-local point. */
  zoomBy: (lx: number, ly: number, factor: number) => void;
  /** Pan by a screen-pixel delta (already in svg-local px). */
  panBy: (dx: number, dy: number) => void;
}

export function useViewport(initial: Viewport): ViewportApi {
  const [viewport, setViewport] = useState<Viewport>(initial);

  const zoomBy = useCallback((lx: number, ly: number, factor: number) => {
    setViewport((v) => {
      const newS = clamp(v.s * factor, MIN_S, MAX_S);
      if (newS === v.s) return v;
      // Keep the world point under the cursor fixed: world = (local - t)/s.
      const worldX = (lx - v.tx) / v.s;
      const worldY = (ly - v.ty) / v.s;
      return {
        s: newS,
        tx: lx - worldX * newS,
        ty: ly - worldY * newS,
      };
    });
  }, []);

  const zoomAt = useCallback((lx: number, ly: number, deltaY: number) => {
    zoomBy(lx, ly, Math.exp(-deltaY * 0.0015));
  }, [zoomBy]);

  const panBy = useCallback((dx: number, dy: number) => {
    setViewport((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  }, []);

  return { viewport, setViewport, zoomAt, zoomBy, panBy };
}
