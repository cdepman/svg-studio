// Sanitize imported SVG before it ever touches the live DOM. Runs exactly once
// at import — never during drag or render. PRD §11.
import DOMPurify from "dompurify";

const PAINTABLE = "path,rect,circle,ellipse,line,polyline,polygon";

export interface SanitizeResult {
  /** The sanitized full <svg> markup. */
  clean: string;
  /** True if sanitization altered what would render (counts/style/filter/script). */
  simplified: boolean;
}

function countPaintables(markup: string): number {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  if (doc.querySelector("parsererror")) return 0;
  return doc.querySelectorAll(PAINTABLE).length;
}

function has(markup: string, selector: string): boolean {
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  return !!doc.querySelector(selector);
}

export function sanitizeSvg(raw: string): SanitizeResult {
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // Belt-and-suspenders on top of the SVG profile. PRD §11.
    FORBID_TAGS: [
      "script",
      "foreignObject",
      "animate",
      "animateTransform",
      "animateMotion",
      "set",
    ],
    // on* handlers are stripped by the profile, but be explicit.
    FORBID_ATTR: ["onload", "onclick", "onerror", "onmouseover", "onbegin"],
  });

  // Surface a notice if rendering could have changed: a <style>/<filter>/<script>
  // present in the source but gone after, or a different paintable count. PRD §11.
  const removedStyle = has(raw, "style") && !has(clean, "style");
  const removedFilter = has(raw, "filter") && !has(clean, "filter");
  const removedScript = has(raw, "script");
  const countChanged = countPaintables(raw) !== countPaintables(clean);

  return {
    clean,
    simplified: removedStyle || removedFilter || removedScript || countChanged,
  };
}
