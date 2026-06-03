// The <svg>, pan/zoom group, the layer stack, and the selection UI.
//
// There is no center handle: you MOVE a layer by grabbing its artwork and
// dragging (onLayerPointerDown -> useMoveDrag). The only on-canvas widget is the
// selection gizmo: a frame around the union of the selected layers, with corner
// resize handles and a duplicate button.
import { useEffect, useRef, useState } from "react";
import { GIZMO_DUP_GAP, GIZMO_HANDLE, isHeavy } from "../config";
import { LayerArt } from "./LayerArt";
import type { Scene } from "./useScene";
import type { GBounds } from "./selectionBounds";
import type { WorldRect } from "../App";
import type { Center, Layer, Viewport } from "../types";

const CORNERS = ["tl", "tr", "bl", "br"] as const;
const CORNER_CURSOR: Record<string, string> = {
  tl: "nwse-resize",
  br: "nwse-resize",
  tr: "nesw-resize",
  bl: "nesw-resize",
};

interface CanvasProps {
  layers: Layer[];
  selectedIds: Set<string>;
  /** Selection gizmo bounds (union of selected, editable layers), or null. */
  gizmo: GBounds | null;
  motionCss: string;
  motionPath: { start: Center; end: Center; closed: boolean } | null;
  drawingMotionPath: boolean;
  animationsMoving: boolean;
  viewport: Viewport;
  dragging: boolean;
  scene: Scene;
  /** Grab a layer's artwork: select-if-needed and begin a move. */
  onLayerPointerDown: (e: React.PointerEvent, id: string, additive: boolean) => void;
  onMarqueeSelect: (rect: WorldRect, additive: boolean) => void;
  onMotionPathCommit: (end: Center) => void;
  onResizePointerDown: (e: React.PointerEvent) => void;
  onDuplicateSelected: () => void;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  panBy: (dx: number, dy: number) => void;
}

export function Canvas({
  layers,
  selectedIds,
  gizmo,
  motionCss,
  motionPath,
  drawingMotionPath,
  animationsMoving,
  viewport,
  dragging,
  scene,
  onLayerPointerDown,
  onMarqueeSelect,
  onMotionPathCommit,
  onResizePointerDown,
  onDuplicateSelected,
  onWheel,
  panBy,
}: CanvasProps) {
  const { s, tx, ty } = viewport;
  const inv = 1 / s;

  const spaceHeld = useRef(false);
  const panState = useRef({ active: false, lastX: 0, lastY: 0 });
  const motionLineRef = useRef<SVGLineElement>(null);
  const motionEndRef = useRef<SVGCircleElement>(null);
  // Marquee selection. Mode is tracked on a ref (per-frame), rect in state so
  // the dashed box renders; LayerArt is memoized so this re-render is cheap.
  const mode = useRef<"pan" | "marquee" | "motion-path" | null>(null);
  const marqueeStart = useRef<Center>({ x: 0, y: 0 });
  const motionDrag = useRef({ pending: null as PointerEvent | null, queued: false });
  const [marquee, setMarquee] = useState<WorldRect | null>(null);

  const normRect = (a: Center, b: Center): WorldRect => ({
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const paintMotionEnd = (point: Center) => {
    motionLineRef.current?.setAttribute("x2", String(point.x));
    motionLineRef.current?.setAttribute("y2", String(point.y));
    motionEndRef.current?.setAttribute("cx", String(point.x));
    motionEndRef.current?.setAttribute("cy", String(point.y));
  };

  const applyMotionDrag = () => {
    motionDrag.current.queued = false;
    const e = motionDrag.current.pending;
    if (!e) return;
    paintMotionEnd(scene.screenToWorld(e.clientX, e.clientY));
  };

  const motionMove = (e: PointerEvent) => {
    motionDrag.current.pending = e;
    if (!motionDrag.current.queued) {
      motionDrag.current.queued = true;
      requestAnimationFrame(applyMotionDrag);
    }
  };

  const motionUp = (e: PointerEvent) => {
    window.removeEventListener("pointermove", motionMove);
    window.removeEventListener("pointerup", motionUp);
    const point = scene.screenToWorld(e.clientX, e.clientY);
    paintMotionEnd(point);
    mode.current = null;
    onMotionPathCommit(point);
  };

  const beginMotionDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    mode.current = "motion-path";
    const point = scene.screenToWorld(e.clientX, e.clientY);
    paintMotionEnd(point);
    window.addEventListener("pointermove", motionMove);
    window.addEventListener("pointerup", motionUp);
  };

  const onSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const wantPan = e.button === 1 || (e.button === 0 && spaceHeld.current);
    if (wantPan) {
      e.preventDefault();
      mode.current = "pan";
      panState.current = { active: true, lastX: e.clientX, lastY: e.clientY };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    // The gizmo (resize handles + duplicate button) owns its own pointerdowns.
    if ((e.target as Element).closest?.(".gizmo, .motion-path-ui")) return;

    if (drawingMotionPath && motionPath) {
      beginMotionDrag(e);
      return;
    }

    // Grab on a layer's artwork: select-if-needed and begin a move (locked
    // artwork is inert).
    const el = (e.target as Element).closest?.(".layer[data-layer-id]");
    const id = el?.getAttribute("data-layer-id");
    if (id) {
      const layer = layers.find((l) => l.id === id);
      if (layer && !layer.locked) onLayerPointerDown(e, id, e.shiftKey);
      return;
    }

    // Empty canvas: begin a marquee.
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    mode.current = "marquee";
    const w = scene.screenToWorld(e.clientX, e.clientY);
    marqueeStart.current = w;
    setMarquee(normRect(w, w));
  };
  const onSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode.current === "pan") {
      panBy(e.clientX - panState.current.lastX, e.clientY - panState.current.lastY);
      panState.current.lastX = e.clientX;
      panState.current.lastY = e.clientY;
    } else if (mode.current === "marquee") {
      setMarquee(normRect(marqueeStart.current, scene.screenToWorld(e.clientX, e.clientY)));
    }
  };
  const onSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (mode.current === "marquee") {
      const rect = normRect(marqueeStart.current, scene.screenToWorld(e.clientX, e.clientY));
      onMarqueeSelect(rect, e.shiftKey);
      setMarquee(null);
    }
    if (mode.current !== "motion-path") mode.current = null;
    panState.current.active = false;
  };
  const endPan = () => {
    if (mode.current === "marquee") setMarquee(null);
    mode.current = null;
    panState.current.active = false;
  };

  return (
    <svg
      ref={scene.svgRef}
      className="canvas"
      onWheel={onWheel}
      onPointerDown={onSvgPointerDown}
      onPointerMove={onSvgPointerMove}
      onPointerUp={onSvgPointerUp}
      onPointerLeave={endPan}
    >
      {motionCss && <style>{motionCss}</style>}
      <g ref={scene.panZoomRef} transform={`translate(${tx},${ty}) scale(${s})`}>
        <g ref={scene.layersRootRef} className="layers-root">
          {layers
            .filter((l) => l.visible)
            .map((l) => (
              <LayerArt
                key={l.id}
                layer={l}
                // Proxy only the layers being dragged in a heavy scene.
                proxy={dragging && selectedIds.has(l.id) && isHeavy(l.params.count, l.motif.weight)}
                animationsMoving={animationsMoving}
              />
            ))}
        </g>

        <g className="selection-ui">
          {marquee && (
            <rect
              className="marquee"
              x={marquee.minX}
              y={marquee.minY}
              width={marquee.maxX - marquee.minX}
              height={marquee.maxY - marquee.minY}
            />
          )}
          {motionPath && (
            <g className="motion-path-ui">
              <line
                ref={motionLineRef}
                className={motionPath.closed ? "motion-path-line closed" : "motion-path-line"}
                x1={motionPath.start.x}
                y1={motionPath.start.y}
                x2={motionPath.end.x}
                y2={motionPath.end.y}
              />
              <circle
                className="motion-path-start"
                cx={motionPath.start.x}
                cy={motionPath.start.y}
                r={7 * inv}
              />
              <circle
                ref={motionEndRef}
                className="motion-path-end"
                cx={motionPath.end.x}
                cy={motionPath.end.y}
                r={9 * inv}
                onPointerDown={beginMotionDrag}
              />
            </g>
          )}
          {/* Selection gizmo: union frame + corner resize handles + a duplicate
              button. The "meta tool" on the edge of the selection. */}
          {gizmo && (
            <g ref={scene.gizmoRef} className="gizmo" transform={`translate(${gizmo.cx},${gizmo.cy})`}>
              <rect
                className="gizmo-frame"
                x={-gizmo.hw}
                y={-gizmo.hh}
                width={2 * gizmo.hw}
                height={2 * gizmo.hh}
                fill="none"
              />
              {CORNERS.map((c) => {
                const sx = c.includes("r") ? 1 : -1;
                const sy = c.includes("b") ? 1 : -1;
                const hs = GIZMO_HANDLE * inv;
                return (
                  <rect
                    key={c}
                    className="gizmo-handle"
                    data-corner={c}
                    x={sx * gizmo.hw - hs / 2}
                    y={sy * gizmo.hh - hs / 2}
                    width={hs}
                    height={hs}
                    style={{ cursor: CORNER_CURSOR[c] }}
                    onPointerDown={onResizePointerDown}
                  />
                );
              })}
              {/* Duplicate button (top-right), drawn in screen px via scale(inv). */}
              <g
                className="gizmo-dup"
                transform={`translate(${gizmo.hw + GIZMO_DUP_GAP * inv},${-gizmo.hh}) scale(${inv})`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicateSelected();
                }}
              >
                <title>Duplicate selection</title>
                <circle r={11} />
                <path className="gizmo-plus" d="M -5 0 H 5 M 0 -5 V 5" />
              </g>
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}
