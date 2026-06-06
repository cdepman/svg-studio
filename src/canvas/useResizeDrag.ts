// Pointer + rAF loop for the gizmo's resize handles. Same shape as useCenterDrag:
// imperative per-frame, single React commit on release.
//
// Resize is a UNIFORM SCALE about the selection's union center: each selected
// layer's `repeat-scale` is set to startScale × f, where f is the ratio of the
// pointer's distance from the anchor now vs. at grab. Centers don't move, so
// concentric mandalas scale together; offset layers scale in place. The scale
// lives on `repeat-scale` (inside `repeat-root`), so the center-drag path is
// untouched.
import { useCallback, useEffect, useRef } from "react";
import { CANCEL_GESTURE_EVENT } from "../config";
import type { ResolvedTarget, Scene } from "./useScene";
import type { Center } from "../types";

const MIN_F = 0.05;
const MAX_F = 40;

export interface ResizeDragOptions {
  onStart: () => void;
  /** Commit the gesture's scale factor to the (now) selected layers. */
  onCommit: (factor: number) => void;
  /** Option/Alt at grab: duplicate the selection and select the copies, so the
   *  resize continues on the NEW layers while the originals stay put. */
  onDuplicate: () => void;
  isDuplicateModifierActive?: () => boolean;
  /** Gesture aborted mid-flight (e.g. a pinch-zoom began) — nothing committed. */
  onCancel?: () => void;
}

export function useResizeDrag(scene: Scene, opts: ResizeDragOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const loop = useRef({ pending: null as PointerEvent | null, queued: false });
  const gesture = useRef<{
    anchor: Center;
    startDist: number;
    targets: ResolvedTarget[];
    /** false until the duplicated copies have rendered and been resolved. */
    resolved: boolean;
    factor: number;
  } | null>(null);

  const factorFor = (clientX: number, clientY: number): number => {
    const g = gesture.current!;
    const w = scene.screenToWorld(clientX, clientY);
    const dist = Math.hypot(w.x - g.anchor.x, w.y - g.anchor.y);
    return Math.min(MAX_F, Math.max(MIN_F, dist / g.startDist));
  };

  const apply = useCallback(() => {
    loop.current.queued = false;
    const g = gesture.current;
    const e = loop.current.pending;
    if (!g || !e) return;
    // For an Option-duplicate, the copies render after pointerdown commits, so
    // we resolve the resize targets (their repeat-scale nodes) on the first frame.
    if (!g.resolved) {
      g.targets = scene.collectDragTargets();
      g.resolved = true;
    }
    const f = factorFor(e.clientX, e.clientY);
    g.factor = f;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of g.targets) {
      t.repeatScale?.setAttribute("transform", `scale(${t.startScale * f})`);
      const r = t.baseReach * t.startScale * f;
      minX = Math.min(minX, t.startCenter.x - r);
      minY = Math.min(minY, t.startCenter.y - r);
      maxX = Math.max(maxX, t.startCenter.x + r);
      maxY = Math.max(maxY, t.startCenter.y + r);
    }
    if (Number.isFinite(minX)) {
      scene.applyGizmo({
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        hw: (maxX - minX) / 2,
        hh: (maxY - minY) / 2,
      });
    }
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
      const f = gesture.current ? factorFor(e.clientX, e.clientY) : 1;
      gesture.current = null;
      optsRef.current.onCommit(f);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [onMove, scene]
  );

  // Abort the resize (restore each layer to its start scale + gizmo, commit
  // nothing). Fired when a pinch-zoom interrupts the drag.
  const cancel = useCallback(() => {
    const g = gesture.current;
    if (!g) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of g.targets) {
      t.repeatScale?.setAttribute("transform", `scale(${t.startScale})`);
      const r = t.baseReach * t.startScale;
      minX = Math.min(minX, t.startCenter.x - r);
      minY = Math.min(minY, t.startCenter.y - r);
      maxX = Math.max(maxX, t.startCenter.x + r);
      maxY = Math.max(maxY, t.startCenter.y + r);
    }
    if (Number.isFinite(minX)) {
      scene.applyGizmo({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, hw: (maxX - minX) / 2, hh: (maxY - minY) / 2 });
    }
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

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      const targets = scene.collectDragTargets();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const t of targets) {
        const r = t.baseReach * t.startScale;
        minX = Math.min(minX, t.startCenter.x - r);
        minY = Math.min(minY, t.startCenter.y - r);
        maxX = Math.max(maxX, t.startCenter.x + r);
        maxY = Math.max(maxY, t.startCenter.y + r);
      }
      const anchor: Center = Number.isFinite(minX)
        ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
        : { x: 0, y: 0 };
      const start = scene.screenToWorld(e.clientX, e.clientY);
      // Anchor/startDist come from the current selection's union; the duplicated
      // copies share the same centers + scales, so the union is identical.
      const duplicate = e.altKey || !!optsRef.current.isDuplicateModifierActive?.();
      if (duplicate) optsRef.current.onDuplicate();
      gesture.current = {
        anchor,
        startDist: Math.max(1e-3, Math.hypot(start.x - anchor.x, start.y - anchor.y)),
        targets: duplicate ? [] : targets,
        resolved: !duplicate,
        factor: 1,
      };
      const lr = scene.layersRootRef.current;
      if (lr) lr.style.pointerEvents = "none";
      optsRef.current.onStart();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onMove, onUp, scene]
  );

  return onPointerDown;
}
