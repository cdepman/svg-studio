// A motif's addressable sub-parts. An imported SVG is flattened to its paintable
// leaves; each leaf keeps its ancestor transforms baked into `baseMarkup` (so it
// renders identically) and gains non-destructive, editable state: a `transform`
// (move/rotate/scale about its own center), a `fill` override and `visible`. The
// motif's rendered `innerHtml` is always derived from the parts (defs preamble +
// visible, transformed, recolored parts), so every existing consumer (LayerArt,
// export, thumbnail) is unchanged.
import { recolorMarkup } from "./recolor";
import { IDENTITY_PART_TRANSFORM, type Box, type Motif, type MotifPart, type PartTransform } from "../types";

const SVG_NS = "http://www.w3.org/2000/svg";
const PAINTABLE = "path,rect,circle,ellipse,line,polyline,polygon";
const NON_RENDERED_ANCESTOR = "defs,clipPath,mask,symbol,marker,pattern,linearGradient,radialGradient";

let partCounter = 0;
export function newPartId(): string {
  partCounter += 1;
  return `part-${partCounter}`;
}

const titleCase = (tag: string) => tag.charAt(0).toUpperCase() + tag.slice(1);
const n = (v: number) => Number(v.toFixed(4));
const escAttr = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");

function isIdentity(t: PartTransform): boolean {
  return t.tx === 0 && t.ty === 0 && t.rotation === 0 && t.scale === 1;
}

/** SVG transform for a part: move, then rotate/scale about the part's center. */
export function partTransformAttr(t: PartTransform, cx: number, cy: number): string | null {
  if (isIdentity(t)) return null;
  return (
    `translate(${n(t.tx)} ${n(t.ty)}) ` +
    `translate(${n(cx)} ${n(cy)}) rotate(${n(t.rotation)}) scale(${n(t.scale)}) ` +
    `translate(${n(-cx)} ${n(-cy)})`
  );
}

/** Rendered markup for one part: base geometry + color override + transform. */
export function renderPart(part: MotifPart): string {
  const inner = part.fill ? recolorMarkup(part.baseMarkup, part.fill) : part.baseMarkup;
  const t = partTransformAttr(part.transform, part.cx, part.cy);
  return t ? `<g transform="${t}">${inner}</g>` : inner;
}

/** Serialize a motif's render markup: defs preamble + visible parts, in order. */
export function serializeMotif(motif: Motif): string {
  if (!motif.parts) return motif.innerHtml;
  const body = motif.parts.filter((p) => p.visible).map(renderPart).join("\n");
  return (motif.defs ?? "") + body;
}

/** Replace a motif's parts and re-derive its rendered `innerHtml`. */
export function motifWithParts(motif: Motif, parts: MotifPart[]): Motif {
  const next = { ...motif, parts };
  return { ...next, innerHtml: serializeMotif(next) };
}

/** Update one part by id (returns a new motif with derived innerHtml). */
export function updatePart(motif: Motif, partId: string, patch: (p: MotifPart) => MotifPart): Motif {
  if (!motif.parts) return motif;
  return motifWithParts(
    motif,
    motif.parts.map((p) => (p.id === partId ? patch(p) : p))
  );
}

export function setPartVisible(motif: Motif, partId: string, visible: boolean): Motif {
  return updatePart(motif, partId, (p) => ({ ...p, visible }));
}

export function setPartFill(motif: Motif, partId: string, fill: string): Motif {
  return updatePart(motif, partId, (p) => ({ ...p, fill }));
}

export function setPartTransform(motif: Motif, partId: string, transform: PartTransform): Motif {
  return updatePart(motif, partId, (p) => ({ ...p, transform }));
}

/** Copy a part (new id, given transform) inserted just above the original. */
export function duplicatePart(motif: Motif, partId: string, newId: string, transform?: PartTransform): Motif {
  if (!motif.parts) return motif;
  const idx = motif.parts.findIndex((p) => p.id === partId);
  if (idx < 0) return motif;
  const src = motif.parts[idx];
  const copy: MotifPart = { ...src, id: newId, transform: transform ?? { ...src.transform } };
  const parts = motif.parts.slice();
  parts.splice(idx + 1, 0, copy);
  return motifWithParts(motif, parts);
}

/** Reorder a part to sit just before `targetId` (paint order). */
export function reorderParts(motif: Motif, draggedId: string, targetId: string): Motif {
  if (!motif.parts || draggedId === targetId) return motif;
  const parts = motif.parts.slice();
  const from = parts.findIndex((p) => p.id === draggedId);
  const to = parts.findIndex((p) => p.id === targetId);
  if (from < 0 || to < 0) return motif;
  const [item] = parts.splice(from, 1);
  parts.splice(to, 0, item);
  return motifWithParts(motif, parts);
}

/** The part's current fill override, or its imported color. */
export function partColor(part: MotifPart): string | null {
  if (part.fill) return part.fill;
  const m = part.baseMarkup.match(/fill="([^"]+)"/) ?? part.baseMarkup.match(/fill\s*:\s*([^;"'}]+)/);
  return m && m[1].trim().toLowerCase() !== "none" ? m[1].trim() : null;
}

/**
 * Recolor an entire motif to one color: every part gets the override (and the
 * defs preamble is recolored for gradient refs). Used by the layer-level swatch.
 */
export function recolorMotif(motif: Motif, color: string): Motif {
  if (motif.parts) {
    return motifWithParts(
      { ...motif, defs: motif.defs ? recolorMarkup(motif.defs, color) : motif.defs },
      motif.parts.map((p) => ({ ...p, fill: color }))
    );
  }
  return { ...motif, innerHtml: recolorMarkup(motif.innerHtml, color) };
}

/** A single part wrapping arbitrary markup (drawn shapes). */
export function singlePart(markup: string, name: string, box: Box): MotifPart {
  return {
    id: newPartId(),
    name,
    baseMarkup: markup,
    cx: box.x + box.width / 2,
    cy: box.y + box.height / 2,
    w: box.width,
    h: box.height,
    transform: { ...IDENTITY_PART_TRANSFORM },
    visible: true,
  };
}

/** Append a part (a freshly drawn stroke added to an existing layer). */
export function appendPart(motif: Motif, part: MotifPart): Motif {
  return motifWithParts(motif, [...(motif.parts ?? []), part]);
}

/**
 * Flatten an <svg> element into paintable-leaf parts. Each part's `baseMarkup`
 * wraps the leaf in its ancestor <g> transforms (innermost first) so the
 * cumulative transform — and thus the visual result and paint order — is
 * preserved. Part centers are measured in one offscreen mount.
 */
export function partsFromSvg(svgEl: SVGSVGElement): MotifPart[] {
  const leaves = Array.from(svgEl.querySelectorAll(PAINTABLE)).filter((el) => !el.closest(NON_RENDERED_ANCESTOR));
  const parts: MotifPart[] = leaves.map((el, i) => {
    let markup = el.outerHTML;
    let groupName: string | null = null;
    let node: Element | null = el.parentElement;
    while (node && node !== svgEl) {
      if (node.tagName.toLowerCase() === "g") {
        if (!groupName) groupName = node.getAttribute("id");
        const attrs = Array.from(node.attributes)
          .filter((attr) => attr.name !== "id")
          .map((attr) => `${attr.name}="${escAttr(attr.value)}"`)
          .join(" ");
        if (attrs) markup = `<g ${attrs}>${markup}</g>`;
      }
      node = node.parentElement;
    }
    const name = el.getAttribute("id") || groupName || `${titleCase(el.tagName)} ${i + 1}`;
    return {
      id: newPartId(),
      name,
      baseMarkup: markup,
      cx: 0,
      cy: 0,
      w: 0,
      h: 0,
      transform: { ...IDENTITY_PART_TRANSFORM },
      visible: true,
    };
  });
  measurePartCenters(parts);
  return parts;
}

/** Mount each part once offscreen to read its intrinsic center (rotate pivot). */
function measurePartCenters(parts: MotifPart[]): void {
  if (typeof document === "undefined" || parts.length === 0) return;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("style", "position:absolute;left:-99999px;top:-99999px;");
  const groups = parts.map((p) => {
    const g = document.createElementNS(SVG_NS, "g");
    g.innerHTML = p.baseMarkup;
    svg.appendChild(g);
    return g;
  });
  document.body.appendChild(svg);
  try {
    parts.forEach((p, i) => {
      try {
        const b = groups[i].getBBox();
        p.cx = b.x + b.width / 2;
        p.cy = b.y + b.height / 2;
        p.w = b.width;
        p.h = b.height;
      } catch {
        /* no layout (jsdom): leave at origin */
      }
    });
  } finally {
    svg.remove();
  }
}

/** Capture top-level non-paintable preamble (defs/gradients) to preserve refs. */
export function defsFromSvg(svgEl: SVGSVGElement): string {
  return Array.from(svgEl.children)
    .filter((c) => c.tagName.toLowerCase() === "defs")
    .map((c) => c.outerHTML)
    .join("");
}
