// Move-by-grabbing-the-artwork. There is no center handle anymore: a pointerdown
// on a selected layer's artwork starts this drag, which moves every grabbed
// layer's center by the same delta. PRD §12, §15.
//
// Same shape as the old center drag: one rAF, one pending event, imperative
// per-frame, a single React commit on release. Targets are resolved at grab
// time from `scene.allSpecsRef` (so a freshly-clicked, not-yet-committed-as-
// selected layer can still be moved this gesture).
import { useCallback, useEffect, useRef } from "react";
import { boundsReach } from "./repeatMath";
import { CANCEL_GESTURE_EVENT } from "../config";
import type { Scene } from "./useScene";
import type { Center } from "../types";

interface MoveTarget {
  repeatRoot: SVGGElement | null;
  startCenter: Center;
  reach: number; // baseReach * scale, for the live gizmo union
}

export interface MoveDragOptions {
  onStart: () => void;
  /** Commit the gesture's total delta to every grabbed layer's center. */
  onCommit: (ids: string[], delta: Center) => void;
  /** Option/touch-modifier at grab: duplicate the grabbed layers and move copies. */
  onDuplicate?: (ids: string[]) => string[];
  /** Gesture aborted mid-flight (e.g. a pinch-zoom began) — nothing committed. */
  onCancel?: () => void;
}

export function useMoveDrag(scene: Scene, opts: MoveDragOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const loop = useRef({ pending: null as PointerEvent | null, queued: false });
  const gesture = useRef<{
    ids: string[];
    startWorld: Center;
    targets: MoveTarget[];
    resolveTargets: boolean;
  } | null>(null);

  const targetsFor = (ids: string[]): MoveTarget[] => {
    const specs = scene.allSpecsRef.current;
    return ids
      .map((id) => specs.get(id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({
        repeatRoot: scene.resolveRepeatRoot(s.id),
        startCenter: s.center,
        reach: boundsReach(s.params, s.motifBox) * s.scale,
      }));
  };

  const paintGizmo = (dx: number, dy: number) => {
    const g = gesture.current;
    if (!g) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of g.targets) {
      const cx = t.startCenter.x + dx;
      const cy = t.startCenter.y + dy;
      minX = Math.min(minX, cx - t.reach);
      minY = Math.min(minY, cy - t.reach);
      maxX = Math.max(maxX, cx + t.reach);
      maxY = Math.max(maxY, cy + t.reach);
    }
    if (Number.isFinite(minX)) {
      scene.applyGizmo({
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        hw: (maxX - minX) / 2,
        hh: (maxY - minY) / 2,
      });
    }
  };

  const apply = useCallback(() => {
    loop.current.queued = false;
    const g = gesture.current;
    const e = loop.current.pending;
    if (!g || !e) return;
    if (g.resolveTargets) {
      const resolved = targetsFor(g.ids);
      if (resolved.length > 0) {
        g.targets = resolved;
        g.resolveTargets = false;
      }
    }
    const w = scene.screenToWorld(e.clientX, e.clientY);
    const dx = w.x - g.startWorld.x;
    const dy = w.y - g.startWorld.y;
    for (const t of g.targets) {
      t.repeatRoot?.setAttribute(
        "transform",
        `translate(${t.startCenter.x + dx},${t.startCenter.y + dy})`
      );
    }
    paintGizmo(dx, dy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  const onMove = useCallback(
    (e: PointerEvent) => {
      loop.current.pending = e;
      if (!loop.current.queued) {
        loop.current.queued = true;
        requestAnimationFrame(apply);
      }
    },
    [apply]
  );

  const onUp = useCallback(
    (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const lr = scene.layersRootRef.current;
      if (lr) lr.style.pointerEvents = "";
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      const w = scene.screenToWorld(e.clientX, e.clientY);
      optsRef.current.onCommit(g.ids, { x: w.x - g.startWorld.x, y: w.y - g.startWorld.y });
    },
    [onMove, scene]
  );

  // Abort the in-flight move: snap every grabbed layer back to its start, drop
  // the listeners, and commit nothing. Fired when a pinch-zoom interrupts a drag.
  const cancel = useCallback(() => {
    const g = gesture.current;
    if (!g) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    for (const t of g.targets) t.repeatRoot?.setAttribute("transform", `translate(${t.startCenter.x},${t.startCenter.y})`);
    paintGizmo(0, 0);
    const lr = scene.layersRootRef.current;
    if (lr) lr.style.pointerEvents = "";
    gesture.current = null;
    optsRef.current.onCancel?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMove, onUp, scene]);

  useEffect(() => {
    window.addEventListener(CANCEL_GESTURE_EVENT, cancel);
    return () => window.removeEventListener(CANCEL_GESTURE_EVENT, cancel);
  }, [cancel]);

  /** Begin moving the given layer ids from a pointerdown on the canvas/artwork. */
  const beginMove = useCallback(
    (e: React.PointerEvent, ids: string[], duplicate = e.altKey) => {
      const moveIds = duplicate ? optsRef.current.onDuplicate?.(ids) ?? ids : ids;
      const targets = duplicate ? [] : targetsFor(moveIds);
      if (!duplicate && targets.length === 0) return;
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      gesture.current = {
        ids: moveIds,
        startWorld: scene.screenToWorld(e.clientX, e.clientY),
        targets,
        resolveTargets: duplicate,
      };
      const lr = scene.layersRootRef.current;
      if (lr) lr.style.pointerEvents = "none";
      optsRef.current.onStart();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onMove, onUp, scene]
  );

  return beginMove;
}
