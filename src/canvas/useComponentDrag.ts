// Drag a single component (one copy) of a radial repeat. Moving it updates the
// layer's radius (radial part) and angle offset (tangential part) so the WHOLE
// ring follows in symmetry, with the grabbed copy staying under the cursor.
// Single-layer operation (component edit focuses one layer).
import { useCallback, useRef } from "react";
import type { Scene } from "./useScene";
import type { Center } from "../types";

export interface ComponentSpec {
  center: Center;
  scale: number;
  index: number;
  count: number;
  baseRadius: number;
  baseAngleOffset: number;
}

export interface ComponentDragOptions {
  getComponent: () => ComponentSpec | null;
  onStart: () => void;
  onCommit: (radiusOffset: number, angleOffset: number) => void;
}

export function useComponentDrag(scene: Scene, opts: ComponentDragOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const loop = useRef({ pending: null as PointerEvent | null, queued: false });
  const gesture = useRef<{ spec: ComponentSpec; radius: number; angleOffset: number } | null>(null);

  const compute = (clientX: number, clientY: number) => {
    const g = gesture.current!;
    const w = scene.screenToWorld(clientX, clientY);
    const dx = w.x - g.spec.center.x;
    const dy = w.y - g.spec.center.y;
    const radius = Math.hypot(dx, dy) / g.spec.scale;
    const step = 360 / g.spec.count;
    const angleForI = (Math.atan2(dy, dx) * 180) / Math.PI;
    const angleOffset = angleForI - g.spec.index * step;
    return { w, radius, angleOffset };
  };

  const apply = useCallback(() => {
    loop.current.queued = false;
    const g = gesture.current;
    const e = loop.current.pending;
    if (!g || !e) return;
    const { w, radius, angleOffset } = compute(e.clientX, e.clientY);
    g.radius = radius;
    g.angleOffset = angleOffset;
    scene.applyParamDeltas({
      radiusOffset: radius - g.spec.baseRadius,
      angleOffset: angleOffset - g.spec.baseAngleOffset,
    });
    // the grabbed component sits under the cursor; move its overlay there
    scene.componentUiRef.current?.setAttribute("transform", `translate(${w.x},${w.y})`);
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
      const { radius, angleOffset } = compute(e.clientX, e.clientY);
      optsRef.current.onCommit(radius, angleOffset);
    },
    [onMove, scene]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const spec = optsRef.current.getComponent();
      if (!spec) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      gesture.current = { spec, radius: spec.baseRadius, angleOffset: spec.baseAngleOffset };
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
