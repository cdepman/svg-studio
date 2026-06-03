// The imperative side of the DOM ownership boundary. PRD §12.
//
//   React owns STRUCTURE + COMMITTED values. This module owns CONTINUOUS
//   in-gesture deltas: during a drag it mutates the SELECTED layers' DOM
//   attributes directly and React does NOT re-render.
//
// Selection can be a single layer OR all layers (synchronized manipulation).
// Either way the imperative code operates over a "drag target" set that App
// keeps current. Center drags and slider drags both apply a RELATIVE DELTA to
// every target, preserving the differences between layers.
import { useCallback, useMemo, useRef } from "react";
import {
  boundsReach,
  instanceOpacity,
  instanceTransform,
  seamHalves,
} from "./repeatMath";
import type { Box, Center, RepeatParams } from "../types";

/** A layer eligible for synchronized manipulation (visible + unlocked). */
export interface DragTargetSpec {
  id: string;
  params: RepeatParams;
  center: Center;
  motifBox: Box;
}

export interface ResolvedTarget {
  repeatRoot: SVGGElement | null;
  selBox: SVGGElement | null;
  startCenter: Center;
}

export type NumericParamKey =
  | "angleOffset"
  | "radiusOffset"
  | "sourceRotation"
  | "scaleStep"
  | "opacityStep";

export interface Scene {
  svgRef: React.RefObject<SVGSVGElement>;
  panZoomRef: React.RefObject<SVGGElement>;
  layersRootRef: React.RefObject<SVGGElement>;
  /** The single combined center handle (renders above all artwork). */
  centerUiRootRef: React.RefObject<SVGGElement>;

  /** App keeps this current: the editable, currently-selected layers. */
  dragTargetsRef: React.MutableRefObject<DragTargetSpec[]>;
  /** Committed position of the combined handle (single center or centroid). */
  handlePosRef: React.MutableRefObject<Center>;
  /** Primary selected layer id, for single-layer commits/queries in App. */
  selectedLayerIdRef: React.MutableRefObject<string | null>;

  screenToWorld: (clientX: number, clientY: number) => Center;

  /** Resolve DOM nodes for the current drag targets (called at pointerdown). */
  collectDragTargets: () => ResolvedTarget[];

  /**
   * Apply a relative delta to one numeric param across every drag target,
   * imperatively (instances + seam wedge + selection box). O(N·L) per frame,
   * no React render. PRD §12, §15.
   */
  applyParamDelta: (key: NumericParamKey, delta: number) => void;
}

export function useScene(): Scene {
  const svgRef = useRef<SVGSVGElement>(null);
  const panZoomRef = useRef<SVGGElement>(null);
  const layersRootRef = useRef<SVGGElement>(null);
  const centerUiRootRef = useRef<SVGGElement>(null);
  const dragTargetsRef = useRef<DragTargetSpec[]>([]);
  const handlePosRef = useRef<Center>({ x: 0, y: 0 });
  const selectedLayerIdRef = useRef<string | null>(null);

  const screenToWorld = useCallback((clientX: number, clientY: number): Center => {
    const g = panZoomRef.current;
    let ctm: DOMMatrix | null = null;
    try {
      ctm = g?.getScreenCTM() ?? null;
    } catch {
      ctm = null;
    }
    if (!ctm || typeof DOMPoint === "undefined") return { x: clientX, y: clientY };
    const world = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: world.x, y: world.y };
  }, []);

  const repeatRootOf = useCallback((id: string): SVGGElement | null => {
    return (
      layersRootRef.current?.querySelector<SVGGElement>(
        `.layer[data-layer-id="${CSS.escape(id)}"] .repeat-root`
      ) ?? null
    );
  }, []);
  const selBoxOf = useCallback((id: string): SVGGElement | null => {
    return (
      svgRef.current?.querySelector<SVGGElement>(
        `.sel-box[data-sel-for="${CSS.escape(id)}"]`
      ) ?? null
    );
  }, []);
  const seamClipsOf = useCallback(
    (id: string): { opp: SVGPathElement | null; seam: SVGPathElement | null } => {
      const svg = svgRef.current;
      const esc = CSS.escape(id);
      return {
        opp: svg?.querySelector<SVGPathElement>(`path[data-seam-opp-for="${esc}"]`) ?? null,
        seam: svg?.querySelector<SVGPathElement>(`path[data-seam-half-for="${esc}"]`) ?? null,
      };
    },
    []
  );

  const collectDragTargets = useCallback((): ResolvedTarget[] => {
    return dragTargetsRef.current.map((t) => ({
      repeatRoot: repeatRootOf(t.id),
      selBox: selBoxOf(t.id),
      startCenter: t.center,
    }));
  }, [repeatRootOf, selBoxOf]);

  const applyParamDelta = useCallback(
    (key: NumericParamKey, delta: number) => {
      for (const t of dragTargetsRef.current) {
        const p: RepeatParams = { ...t.params, [key]: t.params[key] + delta };
        const root = repeatRootOf(t.id);
        if (root) {
          root.querySelectorAll<SVGUseElement>("use.instance").forEach((u) => {
            const i = Number(u.dataset.i);
            u.setAttribute("transform", instanceTransform(p, i));
            u.setAttribute("opacity", String(instanceOpacity(p, i)));
          });
        }
        // Rotate/scale both seam half-clips live (they depend on angle/radius).
        const clips = seamClipsOf(t.id);
        if (clips.opp || clips.seam) {
          const h = seamHalves(p, t.motifBox);
          clips.opp?.setAttribute("d", h.oppHalfD);
          clips.seam?.setAttribute("d", h.seamHalfD);
        }
        const box = selBoxOf(t.id)?.querySelector("rect");
        if (box) {
          const r = boundsReach(p, t.motifBox);
          box.setAttribute("x", String(-r));
          box.setAttribute("y", String(-r));
          box.setAttribute("width", String(2 * r));
          box.setAttribute("height", String(2 * r));
        }
      }
    },
    [repeatRootOf, seamClipsOf, selBoxOf]
  );

  return useMemo(
    () => ({
      svgRef,
      panZoomRef,
      layersRootRef,
      centerUiRootRef,
      dragTargetsRef,
      handlePosRef,
      selectedLayerIdRef,
      screenToWorld,
      collectDragTargets,
      applyParamDelta,
    }),
    [screenToWorld, collectDragTargets, applyParamDelta]
  );
}
