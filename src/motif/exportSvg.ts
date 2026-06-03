// Resolve visible layers into a fresh, portable SVG, back-to-front. PRD §12, §14.
// Hidden layers are omitted; locked state does not affect export; selection UI
// is never exported.
import {
  instanceOpacity,
  instanceTransform,
  maxAbsScale,
  paintOrder,
  seamHalves,
} from "../canvas/repeatMath";
import type { Layer } from "../types";

function layerBounds(layer: Layer) {
  const { params, center, motif } = layer;
  const halfDiag = 0.5 * Math.hypot(motif.box.width, motif.box.height) * maxAbsScale(params);
  const reach = params.radiusOffset + halfDiag;
  return {
    minX: center.x - reach,
    minY: center.y - reach,
    maxX: center.x + reach,
    maxY: center.y + reach,
  };
}

function layerMarkup(layer: Layer): string {
  const { params, center, motif, id } = layer;
  const motifId = `motif-${id}`;

  const useEl = (i: number) =>
    `      <use href="#${motifId}" transform="${instanceTransform(
      params,
      i
    )}" opacity="${instanceOpacity(params, i)}"/>`;

  let defs = "";
  let body: string;
  if (params.tuck) {
    // Two complementary half-disks (see seamHalves) — seamless, no double-blend.
    const h = seamHalves(params, motif.box);
    const oppClip = `seam-opp-${id}`;
    const seamClip = `seam-half-${id}`;
    defs =
      `\n    <clipPath id="${oppClip}" clipPathUnits="userSpaceOnUse"><path d="${h.oppHalfD}"/></clipPath>` +
      `\n    <clipPath id="${seamClip}" clipPathUnits="userSpaceOnUse"><path d="${h.seamHalfD}"/></clipPath>`;
    body =
      `    <g clip-path="url(#${oppClip})">\n${h.oppOrder.map(useEl).join("\n")}\n    </g>\n` +
      `    <g clip-path="url(#${seamClip})">\n${h.seamOrder.map(useEl).join("\n")}\n    </g>`;
  } else {
    body = paintOrder(params.count, params.paintOffset).map(useEl).join("\n");
  }

  return `  <defs>
    <g id="${motifId}" transform="translate(${-motif.anchorX},${-motif.anchorY})">${motif.innerHtml}</g>${defs}
  </defs>
  <g class="layer" data-layer-id="${id}" transform="translate(${center.x},${center.y})">
${body}
  </g>`;
}

export function buildExportSvg(layers: Layer[]): string {
  const visible = layers.filter((l) => l.visible);
  if (visible.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"></svg>\n`;
  }

  // Union of every visible layer's bounds, with a margin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of visible) {
    const b = layerBounds(l);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const margin = 8;
  const x = minX - margin;
  const y = minY - margin;
  const w = maxX - minX + margin * 2;
  const h = maxY - minY + margin * 2;

  // Back-to-front = array order.
  const body = visible.map(layerMarkup).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">
${body}
</svg>
`;
}

export function downloadSvg(svgText: string, filename = "radial-repeat.svg") {
  const blob = new Blob([svgText], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
