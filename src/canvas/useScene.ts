// The imperative side of the DOM ownership boundary. PRD §4.
//
//   React owns STRUCTURE and COMMITTED values (the <svg>, the pan/zoom <g>, the
//   motif def, the COUNT of <use> instances, and their committed transforms).
//
//   This module owns CONTINUOUS in-gesture deltas: during a drag it mutates DOM
//   attributes directly and React does NOT re-render. No React state is written
//   on pointermove or slider input — only on pointerup / slider change (release).
//
// Keeping these two responsibilities on the same nodes without fighting is the
// whole architecture. Do not write React state from anything called here.
import { useCallback, useMemo, useRef } from "react";
import {
  instanceOpacity,
  instanceTransform,
  seamReach,
  seamWedgePath,
} from "./repeatMath";
import type { Box, Center, RepeatParams } from "../types";

export interface Scene {
  svgRef: React.RefObject<SVGSVGElement>;
  panZoomRef: React.RefObject<SVGGElement>;
  repeatRootRef: React.RefObject<SVGGElement>;
  centerUiRootRef: React.RefObject<SVGGElement>;
  /** The <path> inside the seam-wedge clipPath (null when tuck is off). */
  seamPathRef: React.RefObject<SVGPathElement>;
  /** Latest motif box, so applyInstances can resize the wedge during a drag. */
  motifBoxRef: React.MutableRefObject<Box>;

  /** Map a client (screen) point to world coords via the live CTM. PRD §5. */
  screenToWorld: (clientX: number, clientY: number) => Center;

  /**
   * Move the center: ONE translate written to both repeat-root and
   * center-ui-root, in lockstep. O(1) per frame regardless of count. PRD §4.
   */
  applyCenter: (x: number, y: number) => void;

  /**
   * Recompute and write the N instance transforms/opacities imperatively for a
   * continuous param drag. O(N) per frame, but no React render. Reads data-i so
   * it works for both the full render and the proxy subset. PRD §4, §9.
   */
  applyInstances: (params: RepeatParams) => void;
}

export function useScene(): Scene {
  const svgRef = useRef<SVGSVGElement>(null);
  const panZoomRef = useRef<SVGGElement>(null);
  const repeatRootRef = useRef<SVGGElement>(null);
  const centerUiRootRef = useRef<SVGGElement>(null);
  const seamPathRef = useRef<SVGPathElement>(null);
  const motifBoxRef = useRef<Box>({ x: 0, y: 0, width: 100, height: 100 });

  const screenToWorld = useCallback((clientX: number, clientY: number): Center => {
    const g = panZoomRef.current;
    const pt = new DOMPoint(clientX, clientY);
    // getScreenCTM is the full chain: svg viewport + pan + zoom. It is robust
    // against the bugs hand-rolled inverse matrices produce. PRD §5.
    const ctm = g?.getScreenCTM();
    if (!ctm) return { x: clientX, y: clientY };
    const world = pt.matrixTransform(ctm.inverse());
    return { x: world.x, y: world.y };
  }, []);

  const applyCenter = useCallback((x: number, y: number) => {
    const t = `translate(${x},${y})`;
    repeatRootRef.current?.setAttribute("transform", t);
    centerUiRootRef.current?.setAttribute("transform", t);
  }, []);

  const applyInstances = useCallback((params: RepeatParams) => {
    const root = repeatRootRef.current;
    if (root) {
      // Both the main copies and any tucked redraws carry .instance + data-i,
      // so this single sweep updates them together.
      const uses = root.querySelectorAll<SVGUseElement>("use.instance");
      uses.forEach((u) => {
        const i = Number(u.dataset.i);
        u.setAttribute("transform", instanceTransform(params, i));
        u.setAttribute("opacity", String(instanceOpacity(params, i)));
      });
    }
    // The seam wedge depends on the same params (count/angle/radius/scale), so
    // it must track a continuous param drag too. Present only when tuck is on.
    const seam = seamPathRef.current;
    if (seam) {
      seam.setAttribute(
        "d",
        seamWedgePath(params, seamReach(params, motifBoxRef.current))
      );
    }
  }, []);

  return useMemo(
    () => ({
      svgRef,
      panZoomRef,
      repeatRootRef,
      centerUiRootRef,
      seamPathRef,
      motifBoxRef,
      screenToWorld,
      applyCenter,
      applyInstances,
    }),
    [screenToWorld, applyCenter, applyInstances]
  );
}
