// The <svg>, pan/zoom group, the layer stack, and the selection UI.
//
// Selection UI (above all artwork, PRD §11):
//   - a dashed bounding box per selected EDITABLE layer (visible + unlocked),
//     so the canvas shows what's selected; and
//   - one combined center handle. Dragging it applies a relative delta to every
//     selected layer (one layer, or all, in synchrony).
import { useEffect, useRef, useState } from "react";
import { HANDLE_HIT_R, HANDLE_R, isHeavy } from "../config";
import { LayerArt } from "./LayerArt";
import type { Scene } from "./useScene";
import type { WorldRect } from "../App";
import type { Center, Layer, Viewport } from "../types";

export interface SelectionBox {
  id: string;
  center: Center;
  reach: number;
}

interface CanvasProps {
  layers: Layer[];
  selectedIds: Set<string>;
  /** Dashed boxes for selected, editable layers. */
  boxes: SelectionBox[];
  /** Combined handle position, or null if nothing editable is selected. */
  handlePos: Center | null;
  viewport: Viewport;
  dragging: boolean;
  scene: Scene;
  onSelect: (id: string, additive: boolean) => void;
  onMarqueeSelect: (rect: WorldRect, additive: boolean) => void;
  onCenterPointerDown: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  panBy: (dx: number, dy: number) => void;
}

export function Canvas({
  layers,
  selectedIds,
  boxes,
  handlePos,
  viewport,
  dragging,
  scene,
  onSelect,
  onMarqueeSelect,
  onCenterPointerDown,
  onWheel,
  panBy,
}: CanvasProps) {
  const { s, tx, ty } = viewport;
  const inv = 1 / s;

  const spaceHeld = useRef(false);
  const panState = useRef({ active: false, lastX: 0, lastY: 0 });
  // Marquee selection. Mode is tracked on a ref (per-frame), rect in state so
  // the dashed box renders; LayerArt is memoized so this re-render is cheap.
  const mode = useRef<"pan" | "marquee" | null>(null);
  const marqueeStart = useRef<Center>({ x: 0, y: 0 });
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
    // The center handle (selection-ui) owns its own pointerdown.
    if ((e.target as Element).closest?.(".center-ui-root")) return;

    // Click on a layer's artwork selects it (locked artwork isn't selectable).
    const el = (e.target as Element).closest?.(".layer[data-layer-id]");
    const id = el?.getAttribute("data-layer-id");
    if (id) {
      const layer = layers.find((l) => l.id === id);
      if (layer && !layer.locked) onSelect(id, e.shiftKey);
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
    mode.current = null;
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
          {/* A dashed box per selected, editable layer. */}
          {boxes.map((b) => (
            <g key={b.id} className="sel-box" data-sel-for={b.id} transform={`translate(${b.center.x},${b.center.y})`}>
              <rect x={-b.reach} y={-b.reach} width={2 * b.reach} height={2 * b.reach} fill="none" />
            </g>
          ))}

          {/* Single combined center handle. */}
          {handlePos && (
            <g
              ref={scene.centerUiRootRef}
              className="center-ui-root"
              transform={`translate(${handlePos.x},${handlePos.y})`}
            >
              <line className="center-cross" x1={-HANDLE_R * inv} y1={0} x2={HANDLE_R * inv} y2={0} strokeWidth={1.5 * inv} />
              <line className="center-cross" x1={0} y1={-HANDLE_R * inv} x2={0} y2={HANDLE_R * inv} strokeWidth={1.5 * inv} />
              <circle className="center-handle" r={HANDLE_R * inv} strokeWidth={2 * inv} />
              <circle className="center-hit" r={HANDLE_HIT_R * inv} onPointerDown={onCenterPointerDown} />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}
