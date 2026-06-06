// On-canvas gizmo for ONE component (copy) of a radial repeat. It frames the
// edited petal with a bounding box that hugs it, with corner handles to resize
// and a knob to rotate — exactly like the composite selection gizmo, but the
// edits are symmetric: move => radius+angle (the grabbed copy follows the
// cursor, all copies move), resize => sourceScale (every copy grows on its own
// center), rotate => sourceRotation (every copy spins on its own center).
//
// During a drag we update every copy via scene.applyParamDeltas AND re-lay this
// overlay imperatively (zero React renders), committing once on pointerup.
import { useRef } from "react";
import { angleStep, instanceTransform } from "./repeatMath";
import type { Scene } from "./useScene";
import type { Center, Layer, RepeatParams } from "../types";

const CORNERS = ["tl", "tr", "bl", "br"] as const;
const CORNER_CURSOR: Record<string, string> = {
  tl: "nwse-resize",
  br: "nwse-resize",
  tr: "nesw-resize",
  bl: "nesw-resize",
};

interface ComponentEditLayerProps {
  layer: Layer;
  index: number;
  scene: Scene;
  /** 1 / viewport scale, for screen-constant handles. */
  inv: number;
  onCommit: (partial: Partial<RepeatParams>) => void;
  /** Double-tap the frame to drill into the copy's sub-parts. */
  onDrill: () => void;
  setDragging: (d: boolean) => void;
  handlePx: number;
  rotateGapPx: number;
}

type Mode = "move" | "resize" | "rotate";

export function ComponentEditLayer({ layer, index, scene, inv, onCommit, onDrill, setDragging, handlePx, rotateGapPx }: ComponentEditLayerProps) {
  const rootRef = useRef<SVGGElement>(null);
  const angleRef = useRef<SVGTextElement>(null);
  const loop = useRef({ pending: null as PointerEvent | null, queued: false });
  const lastFrameTap = useRef(0);
  const drag = useRef<{
    mode: Mode;
    startP: RepeatParams;
    start: Center;
    pivot: Center;
    latest: Partial<RepeatParams>;
  } | null>(null);

  const p = layer.params;
  const box = layer.motif.box;
  const w = box.width;
  const h = box.height;
  const ls = layer.scale;
  const step = angleStep(p.count);

  // World-size factor of this copy's artwork, to keep handles/gap screen-sized.
  const effScale = Math.max(1e-3, Math.abs(ls * p.sourceScale * (1 + index * p.scaleStep)));
  const hsize = (handlePx * inv) / effScale;
  const gap = (rotateGapPx * inv) / effScale;

  const chainFor = (params: RepeatParams) =>
    `translate(${layer.center.x},${layer.center.y}) scale(${ls}) ${instanceTransform(params, index)}`;

  // The copy's own center (anchor) in world space — the resize/rotate pivot.
  const pivotFor = (params: RepeatParams): Center => {
    const a = ((params.angleOffset + index * step) * Math.PI) / 180;
    return {
      x: layer.center.x + ls * params.radiusOffset * Math.cos(a),
      y: layer.center.y + ls * params.radiusOffset * Math.sin(a),
    };
  };

  const computed = (w0: Center): Partial<RepeatParams> => {
    const d = drag.current!;
    if (d.mode === "move") {
      const dx = w0.x - layer.center.x;
      const dy = w0.y - layer.center.y;
      const radiusOffset = Math.hypot(dx, dy) / ls;
      const angleOffset = (Math.atan2(dy, dx) * 180) / Math.PI - index * step;
      return { radiusOffset, angleOffset };
    }
    if (d.mode === "rotate") {
      const cur = (Math.atan2(w0.y - d.pivot.y, w0.x - d.pivot.x) * 180) / Math.PI;
      const start = (Math.atan2(d.start.y - d.pivot.y, d.start.x - d.pivot.x) * 180) / Math.PI;
      let sr = d.startP.sourceRotation + (cur - start);
      // Soft-snap to 45° increments so cardinal angles are easy to hit.
      const snapped = Math.round(sr / 45) * 45;
      if (Math.abs(sr - snapped) < 7) sr = snapped;
      return { sourceRotation: sr };
    }
    const sd = Math.hypot(d.start.x - d.pivot.x, d.start.y - d.pivot.y);
    const cd = Math.hypot(w0.x - d.pivot.x, w0.y - d.pivot.y);
    const ratio = sd > 1e-6 ? cd / sd : 1;
    return { sourceScale: Math.max(0.05, d.startP.sourceScale * ratio) };
  };

  const apply = () => {
    loop.current.queued = false;
    const d = drag.current;
    const e = loop.current.pending;
    if (!d || !e) return;
    const partial = computed(scene.screenToWorld(e.clientX, e.clientY));
    d.latest = partial;
    const deltas: Partial<Record<keyof RepeatParams, number>> = {};
    for (const k in partial) {
      const key = k as keyof RepeatParams;
      deltas[key] = (partial[key] as number) - (d.startP[key] as number);
    }
    scene.applyParamDeltas(deltas as never);
    rootRef.current?.setAttribute("transform", chainFor({ ...d.startP, ...partial }));
    if (d.mode === "rotate" && angleRef.current && partial.sourceRotation !== undefined) {
      angleRef.current.textContent = `${Math.round(((partial.sourceRotation % 360) + 360) % 360)}°`;
    }
  };

  const onMove = (e: PointerEvent) => {
    loop.current.pending = e;
    if (!loop.current.queued) {
      loop.current.queued = true;
      requestAnimationFrame(apply);
    }
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const lr = scene.layersRootRef.current;
    if (lr) lr.style.pointerEvents = "";
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (angleRef.current) angleRef.current.style.opacity = "0";
    if (d) onCommit(d.latest);
  };

  const begin = (e: React.PointerEvent, mode: Mode) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = {
      mode,
      startP: p,
      start: scene.screenToWorld(e.clientX, e.clientY),
      pivot: pivotFor(p),
      latest: {},
    };
    const lr = scene.layersRootRef.current;
    if (lr) lr.style.pointerEvents = "none";
    if (mode === "rotate" && angleRef.current) {
      angleRef.current.textContent = `${Math.round(((p.sourceRotation % 360) + 360) % 360)}°`;
      angleRef.current.style.opacity = "1";
    }
    setDragging(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Angle readout sits in world space (un-rotated) above the copy's center.
  const pivot = pivotFor(p);
  const angleOffsetY = 0.5 * Math.hypot(w, h) * effScale + 26 * inv;

  return (
    <g className="component-edit">
    <g ref={rootRef} className="component-ui" transform={chainFor(p)}>
      <rect
        className="component-frame"
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        onPointerDown={(e) => {
          const now = typeof performance !== "undefined" ? performance.now() : Date.now();
          if (now - lastFrameTap.current < 350) {
            e.preventDefault();
            e.stopPropagation();
            lastFrameTap.current = 0;
            onDrill();
            return;
          }
          lastFrameTap.current = now;
          begin(e, "move");
        }}
      />
      {CORNERS.map((c) => {
        const sx = c.includes("r") ? 1 : -1;
        const sy = c.includes("b") ? 1 : -1;
        return (
          <rect
            key={c}
            className="component-handle"
            x={(sx * w) / 2 - hsize / 2}
            y={(sy * h) / 2 - hsize / 2}
            width={hsize}
            height={hsize}
            style={{ cursor: CORNER_CURSOR[c] }}
            onPointerDown={(e) => begin(e, "resize")}
          />
        );
      })}
      <g className="component-rotate" onPointerDown={(e) => begin(e, "rotate")}>
        <line className="component-rotate-line" x1={0} y1={-h / 2} x2={0} y2={-h / 2 - gap} />
        <circle className="component-rotate-knob" cx={0} cy={-h / 2 - gap} r={hsize * 0.6} />
      </g>
    </g>
    <text
      ref={angleRef}
      className="component-angle"
      x={pivot.x}
      y={pivot.y - angleOffsetY}
      fontSize={13 * inv}
      style={{ opacity: 0 }}
    >
      0°
    </text>
    </g>
  );
}
