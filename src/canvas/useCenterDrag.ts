// Pointer + rAF loop for the center handle. PRD §7, §10.
//
// One rAF, one pending event, at most one scheduled frame. NEVER queue a
// callback per move event. NEVER write React state inside apply(). State writes
// happen only on pointerup (commit), which is the boundary the architecture
// depends on. PRD §4, §10.
import { useCallback, useRef } from "react";
import type { Scene } from "./useScene";

export interface CenterDragOptions {
  /** Discrete, low-frequency React commit at gesture start (e.g. dragging=true). */
  onStart: () => void;
  /** Single React state write at gesture end: commit the center (and dragging=false). */
  onCommit: (x: number, y: number) => void;
}

export function useCenterDrag(scene: Scene, opts: CenterDragOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const loop = useRef({ pending: null as PointerEvent | null, queued: false });

  const apply = useCallback(() => {
    loop.current.queued = false;
    const e = loop.current.pending;
    if (!e) return;
    const { x, y } = scene.screenToWorld(e.clientX, e.clientY);
    scene.applyCenter(x, y); // imperative only — no React state here
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
      // Restore instance hit-testing.
      const root = scene.repeatRootRef.current;
      if (root) root.style.pointerEvents = "";
      const { x, y } = scene.screenToWorld(e.clientX, e.clientY);
      optsRef.current.onCommit(x, y); // single React commit; no visual jump
    },
    [onMove, scene]
  );

  // Attach via React onPointerDown on the (generous) hit target.
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      // Pointer capture keeps the drag alive even if the cursor leaves the
      // element. PRD §7.
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      // Stop instances stealing pointer events from the handle during the drag.
      const root = scene.repeatRootRef.current;
      if (root) root.style.pointerEvents = "none";
      optsRef.current.onStart();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [onMove, onUp, scene]
  );

  return onPointerDown;
}
