// File read -> sanitize -> read/derive box -> anchor-normalize -> weight. PRD §6.
// The single getBBox call in the whole app lives here and happens once, at
// import, never during drag.
import type { Box, Motif } from "../types";
import { sanitizeSvg } from "./sanitize";
import { defsFromSvg, partsFromSvg, serializeMotif } from "./parts";

const SVG_NS = "http://www.w3.org/2000/svg";

function parseViewBox(svgEl: SVGSVGElement): Box | null {
  const vb = svgEl.getAttribute("viewBox");
  if (!vb) return null;
  const parts = vb.split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function parseWidthHeight(svgEl: SVGSVGElement): Box | null {
  const w = parseFloat(svgEl.getAttribute("width") ?? "");
  const h = parseFloat(svgEl.getAttribute("height") ?? "");
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { x: 0, y: 0, width: w, height: h };
}

/** Mount once off-screen to read intrinsic geometry. Only used when no box exists. */
function bboxFromContent(innerHtml: string): Box {
  const tmp = document.createElementNS(SVG_NS, "svg");
  tmp.setAttribute("style", "position:absolute;left:-99999px;top:-99999px;");
  const g = document.createElementNS(SVG_NS, "g");
  g.innerHTML = innerHtml;
  tmp.appendChild(g);
  document.body.appendChild(tmp);
  try {
    const bb = g.getBBox();
    return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
  } catch {
    return { x: 0, y: 0, width: 100, height: 100 };
  } finally {
    tmp.remove();
  }
}

export function importSvgFromText(raw: string): Motif {
  const { clean, simplified } = sanitizeSvg(raw);

  const doc = new DOMParser().parseFromString(clean, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl || doc.querySelector("parsererror")) {
    throw new Error("Could not parse this file as SVG.");
  }

  // Flatten into addressable parts; `innerHtml` is derived from them (defs
  // preamble + parts) so it renders identically but each piece is editable.
  const parts = partsFromSvg(svgEl as SVGSVGElement);
  const defs = defsFromSvg(svgEl as SVGSVGElement);
  const innerHtml = parts.length > 0 ? serializeMotif({ innerHtml: "", parts, defs } as Motif) : svgEl.innerHTML;
  const box =
    parseViewBox(svgEl as SVGSVGElement) ??
    parseWidthHeight(svgEl as SVGSVGElement) ??
    bboxFromContent(svgEl.innerHTML);

  const weight = parts.length;

  return {
    innerHtml,
    parts: parts.length > 0 ? parts : undefined,
    defs: defs || undefined,
    anchorX: box.x + box.width / 2,
    anchorY: box.y + box.height / 2,
    box,
    weight,
    simplified,
  };
}

export function importSvgFromFile(file: File): Promise<Motif> {
  return file.text().then(importSvgFromText);
}
