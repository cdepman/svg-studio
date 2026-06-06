// Rotation gesture around a pivot. Reused for two things via the param key:
//   • the gizmo's rotate knob → "angleOffset" (rotate the whole composite)
//   • a component's rotate knob → "sourceRotation" (spin one copy on its center)
//
// Both are "+delta degrees to the param", applied imperatively per frame through
// the shared param-delta path (zero React renders mid-drag), committed once on
// release. The angle delta is accumulated across frames so it wraps cleanly past
// ±180°.
import { useCallback, useEffect, useRef } from "react";
import { CANCEL_GESTURE_EVENT } from "../config";
import type { NumericParamKey, Scene } from "./useScene";
import type { Center } from "../types";

const norm180 = (d: number) => {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x <= -180) x += 360;
  return x;
};

export interface RotateDragOptions {
  /** World pivot the rotation is measured around (resolved at grab time). */
  getPivot: () => Center;
  key: NumericParamKey;
  onStart: () => void;
  onCommit: (key: NumericParamKey, delta: number) => void;
  /** Gesture aborted mid-flight (e.g. a pinch-zoom began) — nothing committed. */
  onCancel?: () => void;
}

export function useRotateDrag(scene: Scene, opts: RotateDragOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const loop = useRef({ pending: null as PointerEvent | null, queued: false });
  const gesture = useRef<{ pivot: Center; last: number; accum: number } | null>(null);

  const angleAt = (clientX: number, clientY: number, pivot: Center) => {
    const w = scene.screenToWorld(clientX, clientY);
    return (Math.atan2(w.y - pivot.y, w.x - pivot.x) * 180) / Math.PI;
  };

  const apply = useCallback(() => {
    loop.current.queued = false;
    const g = gesture.current;
    const e = loop.current.pending;
    if (!g || !e) return;
    const a = angleAt(e.clientX, e.clientY, g.pivot);
    g.accum += norm180(a - g.last);
    g.last = a;
    scene.applyParamDelta(optsRef.current.key, g.accum);
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
      g.accum += norm180(angleAt(e.clientX, e.clientY, g.pivot) - g.last);
      optsRef.current.onCommit(optsRef.current.key, g.accum);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [onMove, scene]
  );

  // Abort the rotation (snap the param back to its start, commit nothing).
  // Fired when a pinch-zoom interrupts the drag.
  const cancel = useCallback(() => {
    const g = gesture.current;
    if (!g) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    scene.applyParamDelta(optsRef.current.key, 0);
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
      const pivot = optsRef.current.getPivot();
      gesture.current = { pivot, last: angleAt(e.clientX, e.clientY, pivot), accum: 0 };
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
