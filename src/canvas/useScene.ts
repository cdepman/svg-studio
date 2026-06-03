// The imperative side of the DOM ownership boundary. PRD §12.
//
//   React owns STRUCTURE + COMMITTED values. This module owns CONTINUOUS
//   in-gesture deltas: during a drag it mutates the SELECTED layers' DOM
//   attributes directly and React does NOT re-render.
//
// The selection is shown by ONE union "gizmo" (frame + resize handles + a
// duplicate button). Center drags, param drags, and resizes all update it
// imperatively.
import { useCallback, useMemo, useRef } from "react";
import {
  boundsReach,
  instanceOpacity,
  instanceLocalTransform,
  instanceSpokeTransform,
  instanceTransform,
  seamHalves,
} from "./repeatMath";
import { GIZMO_DUP_GAP, GIZMO_HANDLE } from "../config";
import {
  animationReachPaddingForGeometry,
  instanceMotionVectorForGeometry,
  referenceInstancePointForGeometry,
} from "../motion/centerPath";
import type { GBounds } from "./selectionBounds";
import type { Box, Center, LayerAnimation, RepeatParams } from "../types";

/** CSS.escape, with a fallback for environments that lack it (e.g. jsdom). Layer
 *  ids are already selector-safe, so the identity fallback is fine. */
const cssEscape = (s: string): string =>
  typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s;

/** A layer eligible for synchronized manipulation (visible + unlocked). */
export interface DragTargetSpec {
  id: string;
  params: RepeatParams;
  center: Center;
  scale: number;
  motifBox: Box;
  animation?: LayerAnimation;
}

export interface ResolvedTarget {
  id: string;
  repeatRoot: SVGGElement | null;
  repeatScale: SVGGElement | null;
  startCenter: Center;
  startScale: number;
  /** Unscaled artwork half-extent, for live union recompute during resize. */
  baseReach: number;
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
  /** The selection gizmo group (frame + handles + duplicate button). */
  gizmoRef: React.RefObject<SVGGElement>;

  dragTargetsRef: React.MutableRefObject<DragTargetSpec[]>;
  /** Specs for ALL editable layers (by id), so a move can target any grabbed
   *  layer — not just the currently-selected ones. */
  allSpecsRef: React.MutableRefObject<Map<string, DragTargetSpec>>;
  selectedLayerIdRef: React.MutableRefObject<string | null>;
  /** 1 / viewport scale, so screen-sized handles can be drawn in world units. */
  invSRef: React.MutableRefObject<number>;

  screenToWorld: (clientX: number, clientY: number) => Center;
  /** Resolve a layer's repeat-root <g> by id (exists for every visible layer). */
  resolveRepeatRoot: (id: string) => SVGGElement | null;

  collectDragTargets: () => ResolvedTarget[];
  applyParamDelta: (key: NumericParamKey, delta: number) => void;
  /** Re-lay the gizmo frame/handles/button from union bounds (imperative). */
  applyGizmo: (b: GBounds) => void;
}

export function useScene(): Scene {
  const svgRef = useRef<SVGSVGElement>(null);
  const panZoomRef = useRef<SVGGElement>(null);
  const layersRootRef = useRef<SVGGElement>(null);
  const gizmoRef = useRef<SVGGElement>(null);
  const dragTargetsRef = useRef<DragTargetSpec[]>([]);
  const allSpecsRef = useRef<Map<string, DragTargetSpec>>(new Map());
  const selectedLayerIdRef = useRef<string | null>(null);
  const invSRef = useRef(1);

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

  const repeatRootOf = useCallback(
    (id: string): SVGGElement | null =>
      layersRootRef.current?.querySelector<SVGGElement>(
        `.layer[data-layer-id="${cssEscape(id)}"] .layer-center-root`
      ) ?? null,
    []
  );
  const repeatScaleOf = useCallback(
    (id: string): SVGGElement | null =>
      layersRootRef.current?.querySelector<SVGGElement>(
        `.layer[data-layer-id="${cssEscape(id)}"] .repeat-scale`
      ) ?? null,
    []
  );
  const seamClipsOf = useCallback(
    (id: string): { opp: SVGPathElement | null; seam: SVGPathElement | null } => {
      const svg = svgRef.current;
      const esc = cssEscape(id);
      return {
        opp: svg?.querySelector<SVGPathElement>(`path[data-seam-opp-for="${esc}"]`) ?? null,
        seam: svg?.querySelector<SVGPathElement>(`path[data-seam-half-for="${esc}"]`) ?? null,
      };
    },
    []
  );

  const collectDragTargets = useCallback(
    (): ResolvedTarget[] =>
      dragTargetsRef.current.map((t) => ({
        id: t.id,
        repeatRoot: repeatRootOf(t.id),
        repeatScale: repeatScaleOf(t.id),
        startCenter: t.center,
        startScale: t.scale,
        baseReach: boundsReach(t.params, t.motifBox),
      })),
    [repeatRootOf, repeatScaleOf]
  );

  const applyGizmo = useCallback((b: GBounds) => {
    const g = gizmoRef.current;
    if (!g) return;
    const inv = invSRef.current;
    g.setAttribute("transform", `translate(${b.cx},${b.cy})`);
    const frame = g.querySelector(".gizmo-frame");
    frame?.setAttribute("x", String(-b.hw));
    frame?.setAttribute("y", String(-b.hh));
    frame?.setAttribute("width", String(2 * b.hw));
    frame?.setAttribute("height", String(2 * b.hh));
    const hs = GIZMO_HANDLE * inv;
    g.querySelectorAll<SVGRectElement>(".gizmo-handle").forEach((h) => {
      const sx = h.dataset.corner?.includes("r") ? 1 : -1;
      const sy = h.dataset.corner?.includes("b") ? 1 : -1;
      h.setAttribute("x", String(sx * b.hw - hs / 2));
      h.setAttribute("y", String(sy * b.hh - hs / 2));
      h.setAttribute("width", String(hs));
      h.setAttribute("height", String(hs));
    });
    const actions = g.querySelector(".gizmo-action-menu");
    actions?.setAttribute("transform", `translate(${b.hw + GIZMO_DUP_GAP * inv},${-b.hh - GIZMO_DUP_GAP * inv}) scale(${inv})`);
  }, []);

  const applyParamDelta = useCallback(
    (key: NumericParamKey, delta: number) => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const t of dragTargetsRef.current) {
        const p: RepeatParams = { ...t.params, [key]: t.params[key] + delta };
        const root = repeatRootOf(t.id);
        if (root) {
          root.querySelectorAll<SVGGElement>(".instance-placement").forEach((g) => {
            const i = Number(g.dataset.i);
            g.setAttribute("transform", t.animation?.enabled ? instanceSpokeTransform(p, i) : instanceTransform(p, i));
            g.setAttribute("opacity", String(instanceOpacity(p, i)));
            if (t.animation?.enabled) {
              g.querySelector<SVGGElement>(".instance-local-transform")?.setAttribute(
                "transform",
                instanceLocalTransform(p, i)
              );
            }
          });
          if (t.animation?.enabled) {
            const fallbackStart = referenceInstancePointForGeometry(p, t.center, t.scale);
            root.querySelectorAll<SVGGElement>(".instance-motion-wrapper").forEach((g) => {
              const placement = g.querySelector<SVGGElement>(".instance-placement");
              const i = Number(placement?.dataset.i);
              const v = Number.isFinite(i)
                ? instanceMotionVectorForGeometry(p, t.scale, t.animation, fallbackStart, i)
                : null;
              if (!v) return;
              g.style.setProperty("--motion-start-dx", `${v.startDx}px`);
              g.style.setProperty("--motion-start-dy", `${v.startDy}px`);
              g.style.setProperty("--motion-end-dx", `${v.endDx}px`);
              g.style.setProperty("--motion-end-dy", `${v.endDy}px`);
              g.style.setProperty("--motion-dx", `${v.dx}px`);
              g.style.setProperty("--motion-dy", `${v.dy}px`);
              g.style.setProperty("--motion-angle", `${v.angle}deg`);
            });
          }
        }
        const clips = seamClipsOf(t.id);
        if (clips.opp || clips.seam) {
          const fallbackStart = referenceInstancePointForGeometry(p, t.center, t.scale);
          const h = seamHalves(
            p,
            t.motifBox,
            animationReachPaddingForGeometry(p, t.scale, t.animation, fallbackStart)
          );
          clips.opp?.setAttribute("d", h.oppHalfD);
          clips.seam?.setAttribute("d", h.seamHalfD);
        }
        const reach = boundsReach(p, t.motifBox) * t.scale;
        minX = Math.min(minX, t.center.x - reach);
        minY = Math.min(minY, t.center.y - reach);
        maxX = Math.max(maxX, t.center.x + reach);
        maxY = Math.max(maxY, t.center.y + reach);
      }
      if (Number.isFinite(minX)) {
        applyGizmo({
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          hw: (maxX - minX) / 2,
          hh: (maxY - minY) / 2,
        });
      }
    },
    [repeatRootOf, seamClipsOf, applyGizmo]
  );

  return useMemo(
    () => ({
      svgRef,
      panZoomRef,
      layersRootRef,
      gizmoRef,
      dragTargetsRef,
      allSpecsRef,
      selectedLayerIdRef,
      invSRef,
      screenToWorld,
      resolveRepeatRoot: repeatRootOf,
      collectDragTargets,
      applyParamDelta,
      applyGizmo,
    }),
    [screenToWorld, repeatRootOf, collectDragTargets, applyParamDelta, applyGizmo]
  );
}
