// One layer's artwork: its motif def and instances. When tuck is on, the ring is
// drawn as two complementary half-disks (see seamHalves) so the cyclic-overlap
// seam is hidden with no double-blend. When off (or in the drag proxy), it's a
// single normal pass.
//
// React.memo + a stable `layer` reference means a commit that changes ONE layer
// re-renders only that layer. A center/slider drag mutates the DOM imperatively
// and re-renders nothing here. PRD §11, §15.
import { memo } from "react";
import {
  instanceOpacity,
  instanceTransform,
  paintOrder,
  seamHalves,
  subsetIndices,
} from "./repeatMath";
import { PROXY_CAP } from "../config";
import type { Layer } from "../types";

interface LayerArtProps {
  layer: Layer;
  /** Render only a representative subset (drag-time fidelity fallback). PRD §9. */
  proxy: boolean;
}

function LayerArtImpl({ layer, proxy }: LayerArtProps) {
  const p = layer.params;
  const motifId = `motif-${layer.id}`;
  const oppClipId = `seam-opp-${layer.id}`;
  const seamClipId = `seam-half-${layer.id}`;

  const showTuck = p.tuck && !proxy;
  const halves = showTuck ? seamHalves(p, layer.motif.box) : null;

  // `alt` tags the second (seam-half) pass so the two passes are distinguishable;
  // both carry `instance` so the imperative sweep updates them together.
  const Use = (i: number, alt = false) => (
    <use
      key={i}
      data-i={i}
      className={alt ? "instance alt" : "instance"}
      href={`#${motifId}`}
      transform={instanceTransform(p, i)}
      opacity={instanceOpacity(p, i)}
    />
  );

  return (
    <g className="layer" data-layer-id={layer.id}>
      <defs>
        {/* Motif anchored so its center sits at local (0,0). */}
        <g
          id={motifId}
          transform={`translate(${-layer.motif.anchorX},${-layer.motif.anchorY})`}
          dangerouslySetInnerHTML={{ __html: layer.motif.innerHtml }}
        />
        {halves && (
          <>
            <clipPath id={oppClipId} clipPathUnits="userSpaceOnUse">
              <path data-seam-opp-for={layer.id} d={halves.oppHalfD} />
            </clipPath>
            <clipPath id={seamClipId} clipPathUnits="userSpaceOnUse">
              <path data-seam-half-for={layer.id} d={halves.seamHalfD} />
            </clipPath>
          </>
        )}
      </defs>

      {/* repeat-root: its transform changes during this layer's center drag. */}
      <g className="repeat-root" transform={`translate(${layer.center.x},${layer.center.y})`}>
        {halves ? (
          <>
            {/* Half opposite the seam: normal order (its seam is excluded here). */}
            <g clipPath={`url(#${oppClipId})`}>{halves.oppOrder.map((i) => Use(i))}</g>
            {/* Half containing the seam: order rotated 180° (its seam is on the
                far side, excluded here). Complementary clips => no double-blend. */}
            <g clipPath={`url(#${seamClipId})`}>{halves.seamOrder.map((i) => Use(i, true))}</g>
          </>
        ) : (
          (proxy ? subsetIndices(p.count, PROXY_CAP) : paintOrder(p.count, p.paintOffset)).map((i) => Use(i))
        )}
      </g>
    </g>
  );
}

export const LayerArt = memo(LayerArtImpl);
