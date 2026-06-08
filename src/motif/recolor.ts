// Recolor a motif to a single fill/stroke color. Imported art is often
// stroke-dominated (heavy outlines, near-black fills) or outline-only
// (fill="none" + a stroke), so recoloring just the fill is invisible — we paint
// both fill and stroke. Colors may live in a `fill=`/`stroke=` attribute, an
// inline `style="fill:...;stroke:..."`, or be absent (paintable elements default
// to a black fill). `fill="none"` / `stroke="none"` are intentional and kept.
import type { Motif } from "../types";

const PAINT_TAGS = "path|rect|circle|ellipse|line|polyline|polygon";

/** The first real (non-"none") value of `prop` (fill|stroke), attr or style, or null. */
function firstPaint(html: string, prop: "fill" | "stroke"): string | null {
  for (const m of html.matchAll(new RegExp(`${prop}="([^"]*)"`, "g"))) {
    if (m[1].trim().toLowerCase() !== "none") return m[1].trim();
  }
  for (const m of html.matchAll(new RegExp(`${prop}\\s*:\\s*([^;"'}]+)`, "g"))) {
    if (m[1].trim().toLowerCase() !== "none") return m[1].trim();
  }
  return null;
}

/** The motif's current color: its fill if any, else its stroke (outline-only art). */
export function motifFillColor(motif: Motif): string | null {
  return firstPaint(motif.innerHtml, "fill") ?? firstPaint(motif.innerHtml, "stroke");
}

/** Recolor one paint property (attribute + inline-style forms), keeping "none". */
function recolorProp(html: string, prop: "fill" | "stroke", color: string): string {
  return html
    .replace(new RegExp(`${prop}="([^"]*)"`, "g"), (m, c) =>
      c.trim().toLowerCase() === "none" ? m : `${prop}="${color}"`
    )
    .replace(new RegExp(`${prop}\\s*:\\s*([^;"'}]+)`, "g"), (m, c) =>
      c.trim().toLowerCase() === "none" ? m : `${prop}:${color}`
    );
}

export function recolorMarkup(html: string, color: string): string {
  let out = recolorProp(html, "fill", color);
  out = recolorProp(out, "stroke", color);
  // Paintable elements with no fill at all render black by default — give them
  // the color too. Idempotent: elements recolored above already carry a fill, so
  // they're skipped. Elements with an explicit fill="none" keep it (stroke-only).
  out = out.replace(
    new RegExp(`<(${PAINT_TAGS})\\b([^>]*?)(/?)>`, "g"),
    (m, tag, attrs, slash) => (/fill\s*[=:]/.test(attrs) ? m : `<${tag}${attrs} fill="${color}"${slash}>`)
  );
  return out;
}

/** Force a paint property to a literal value on every paintable element,
 *  overriding any existing attr/style value (including "none") and adding the
 *  attribute to elements that lack it. Used to author borders (stroke /
 *  stroke-width) independently of the fill override. */
function forceProp(html: string, prop: "fill" | "stroke" | "stroke-width", value: string): string {
  let out = html
    .replace(new RegExp(`${prop}="[^"]*"`, "g"), `${prop}="${value}"`)
    .replace(new RegExp(`${prop}\\s*:\\s*[^;"'}]+`, "g"), `${prop}:${value}`);
  out = out.replace(
    new RegExp(`<(${PAINT_TAGS})\\b([^>]*?)(/?)>`, "g"),
    (m, tag, attrs, slash) =>
      new RegExp(`${prop}\\s*[=:]`).test(attrs) ? m : `<${tag}${attrs} ${prop}="${value}"${slash}>`
  );
  return out;
}

/** Set ONLY the fill on every paintable element (independent of the border). */
export function setFillColorMarkup(html: string, color: string): string {
  return forceProp(html, "fill", color);
}

/** Set the border (stroke) color on every paintable element. */
export function setStrokeColorMarkup(html: string, color: string): string {
  return forceProp(html, "stroke", color);
}

/** Set the border thickness (stroke-width) on every paintable element. */
export function setStrokeWidthMarkup(html: string, width: number): string {
  return forceProp(html, "stroke-width", String(width));
}
