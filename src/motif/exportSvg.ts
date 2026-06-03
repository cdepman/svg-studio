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
import {
  animationReachPadding,
  animationPoints,
  centerPathStyles,
  instanceMotionStyleText,
  motionClassName,
  referenceInstancePoint,
} from "../motion/centerPath";
import type { Layer } from "../types";

const EXPORT_MARGIN = 8;

function emptySvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"></svg>\n`;
}

function layerBounds(layer: Layer) {
  const { params, center, motif, scale } = layer;
  const halfDiag = 0.5 * Math.hypot(motif.box.width, motif.box.height) * maxAbsScale(params);
  const reach = (params.radiusOffset + halfDiag) * scale;
  return {
    minX: center.x - reach,
    minY: center.y - reach,
    maxX: center.x + reach,
    maxY: center.y + reach,
  };
}

function animatedLayerBounds(layer: Layer) {
  const b = layerBounds(layer);
  if (!layer.animation || layer.animation.type !== "centerPath") return b;
  const { start, end } = animationPoints(layer.animation, referenceInstancePoint(layer));
  const { params, motif, scale } = layer;
  const halfDiag = 0.5 * Math.hypot(motif.box.width, motif.box.height) * maxAbsScale(params);
  const deltaReach = Math.hypot(end.x - start.x, end.y - start.y);
  const reach = (params.radiusOffset + halfDiag) * scale + deltaReach;
  return {
    minX: Math.min(b.minX, layer.center.x - reach),
    minY: Math.min(b.minY, layer.center.y - reach),
    maxX: Math.max(b.maxX, layer.center.x + reach),
    maxY: Math.max(b.maxY, layer.center.y + reach),
  };
}

function layerMarkup(layer: Layer, animated: boolean): string {
  const { params, center, motif, id } = layer;
  const motifId = `motif-${id}`;
  const useTuck = params.tuck;

  const useEl = (i: number, alt = false) =>
    `          <g class="instance-motion-wrapper motion-wrapper ${motionClassName(id)}"${animated ? instanceMotionStyleText(layer, i) : ""}>
            <g class="instance-placement" transform="${instanceTransform(
              params,
              i
            )}" opacity="${instanceOpacity(params, i)}">
              <g class="instance-follow-wrapper">
                <use${alt ? ' class="alt"' : ""} href="#${motifId}"/>
              </g>
            </g>
          </g>`;

  let defs = "";
  let body: string;
  if (useTuck) {
    // Two complementary half-disks (see seamHalves) — seamless, no double-blend.
    const h = seamHalves(params, motif.box, animated ? animationReachPadding(layer) : 0);
    const oppClip = `seam-opp-${id}`;
    const seamClip = `seam-half-${id}`;
    defs =
      `\n    <clipPath id="${oppClip}" clipPathUnits="userSpaceOnUse"><path d="${h.oppHalfD}"/></clipPath>` +
      `\n    <clipPath id="${seamClip}" clipPathUnits="userSpaceOnUse"><path d="${h.seamHalfD}"/></clipPath>`;
    body =
      `    <g clip-path="url(#${oppClip})">\n${h.oppOrder.map((i) => useEl(i)).join("\n")}\n    </g>\n` +
      `    <g clip-path="url(#${seamClip})">\n${h.seamOrder.map((i) => useEl(i, true)).join("\n")}\n    </g>`;
  } else {
    body = paintOrder(params.count, params.paintOffset).map((i) => useEl(i)).join("\n");
  }

  return `  <defs>
    <g id="${motifId}" transform="translate(${-motif.anchorX},${-motif.anchorY})">${motif.innerHtml}</g>${defs}
  </defs>
  <g class="layer" data-layer-id="${id}">
    <g class="layer-center-root" transform="translate(${center.x},${center.y})">
      <g class="repeat-root">
        <g class="repeat-scale" transform="scale(${layer.scale})">
${body}
        </g>
      </g>
    </g>
  </g>`;
}

function buildSvgFromLayers(layers: Layer[], animated: boolean): string {
  const visible = layers.filter((l) => l.visible);
  if (visible.length === 0) {
    return emptySvg();
  }

  // Union of every visible layer's bounds, with a margin.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of visible) {
    const b = animated ? animatedLayerBounds(l) : layerBounds(l);
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const x = minX - EXPORT_MARGIN;
  const y = minY - EXPORT_MARGIN;
  const w = maxX - minX + EXPORT_MARGIN * 2;
  const h = maxY - minY + EXPORT_MARGIN * 2;

  // Back-to-front = array order.
  const body = visible.map((layer) => layerMarkup(layer, animated)).join("\n");
  const style = animated ? centerPathStyles(visible, true) : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
${style ? `<style>${style}\n</style>\n` : ""}<g transform="translate(${-x},${-y})">
${body}
</g>
</svg>
`;
}

export function buildExportSvg(layers: Layer[]): string {
  return buildSvgFromLayers(layers, false);
}

export function buildAnimatedExportSvg(layers: Layer[]): string {
  return buildSvgFromLayers(layers, true);
}

export function buildExportSvgFromRenderedLayers(layersRoot: SVGGElement | null): string | null {
  if (!layersRoot || typeof XMLSerializer === "undefined") return null;

  const layerNodes = Array.from(layersRoot.children).filter(
    (el): el is SVGGElement =>
      el.namespaceURI === "http://www.w3.org/2000/svg" &&
      el.tagName.toLowerCase() === "g" &&
      el.classList.contains("layer") &&
      el.hasAttribute("data-layer-id")
  );
  if (layerNodes.length === 0) return emptySvg();

  let box: DOMRect;
  try {
    box = layersRoot.getBBox();
  } catch {
    return null;
  }

  const x = box.x - EXPORT_MARGIN;
  const y = box.y - EXPORT_MARGIN;
  const w = Math.max(1, box.width) + EXPORT_MARGIN * 2;
  const h = Math.max(1, box.height) + EXPORT_MARGIN * 2;
  const serializer = new XMLSerializer();
  const body = layerNodes
    .map((node) => serializer.serializeToString(node.cloneNode(true)))
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<g transform="translate(${-x},${-y})">
${body}
</g>
</svg>
`;
}

export function ensureSvgFilename(filename = "radial-repeat.svg") {
  const trimmed = filename.trim();
  const safeName = trimmed.length > 0 ? trimmed : "radial-repeat";
  return safeName.toLowerCase().endsWith(".svg") ? safeName : `${safeName}.svg`;
}

export function downloadSvg(svgText: string, filename = "radial-repeat.svg") {
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = ensureSvgFilename(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
