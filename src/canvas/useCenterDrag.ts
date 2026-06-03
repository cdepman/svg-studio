// Pointer + rAF loop for the center handle. PRD §12, §15.
//
// One rAF, one pending event, at most one scheduled frame. NEVER write React
// state inside apply(). State writes happen only on pointerup.
//
// The handle applies a RELATIVE DELTA to every selected layer, so a single
// handle moves one layer or all layers in synchrony while preserving the
// differences between their centers. Targets are resolved ONCE at pointerdown
// and cached, so per-frame work is one setAttribute per moved node.
import { useCallback, useRef } from "react";
import type { ResolvedTarget, Scene } from "./useScene";
import type { Center } from "../types";

export interface CenterDragOptions {
  onStart: () => void;
  /** Commit the gesture's total delta to every selected layer's center. */
  onCommit: (delta: Center) => void;
}

export function useCenterDrag(scene: Scene, opts: CenterDragOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const loop = useRef({ pending: null as PointerEvent | null, queued: false });
  const gesture = useRef<{
    startWorld: Center;
    targets: ResolvedTarget[];
    handle: SVGGElement | null;
    handleStart: Center;
    lastDelta: Center;
  } | null>(null);

  const apply = useCallback(() => {
    loop.current.queued = false;
    const g = gesture.current;
    const e = loop.current.pending;
    if (!g || !e) return;
    const w = scene.screenToWorld(e.clientX, e.clientY);
    const dx = w.x - g.startWorld.x;
    const dy = w.y - g.startWorld.y;
    g.lastDelta = { x: dx, y: dy };
    for (const t of g.targets) {
      const tf = `translate(${t.startCenter.x + dx},${t.startCenter.y + dy})`;
      t.repeatRoot?.setAttribute("transform", tf);
      t.selBox?.setAttribute("transform", tf);
    }
    g.handle?.setAttribute(
      "transform",
      `translate(${g.handleStart.x + dx},${g.handleStart.y + dy})`
    );
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
      const w = scene.screenToWorld(e.clientX, e.clientY);
      const delta = g
        ? { x: w.x - g.startWorld.x, y: w.y - g.startWorld.y }
        : { x: 0, y: 0 };
      gesture.current = null;
      optsRef.current.onCommit(delta); // single React commit; no visual jump
    },
    [onMove, scene]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      gesture.current = {
        startWorld: scene.screenToWorld(e.clientX, e.clientY),
        targets: scene.collectDragTargets(),
        handle: scene.centerUiRootRef.current,
        handleStart: { ...scene.handlePosRef.current },
        lastDelta: { x: 0, y: 0 },
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
