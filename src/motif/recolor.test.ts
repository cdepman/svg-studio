import { describe, expect, it } from "vitest";
import { motifFillColor, recolorMarkup } from "./recolor";
import { recolorMotif } from "./parts";
import type { Motif } from "../types";

const drawn: Motif = {
  innerHtml: `<path d="M0 0" fill="#7c93ff" stroke="#7c93ff" stroke-width="8" />`,
  anchorX: 0, anchorY: 0, box: { x: 0, y: 0, width: 10, height: 10 }, weight: 1, simplified: false,
};

describe("recolor", () => {
  it("reads the fill color", () => {
    expect(motifFillColor(drawn)).toBe("#7c93ff");
    expect(motifFillColor({ ...drawn, innerHtml: '<path fill="none" stroke="none"/>' })).toBeNull();
  });

  it("recolors fill and the matching stroke (drawn shapes stay consistent)", () => {
    const out = recolorMotif(drawn, "#ff0000").innerHtml;
    expect(out).toContain('fill="#ff0000"');
    expect(out).toContain('stroke="#ff0000"');
  });

  it("detects a real fill even when a none-fill element comes first (imported art)", () => {
    const html = '<path fill="none" stroke="#000"/><circle fill="#222"/>';
    expect(motifFillColor({ ...drawn, innerHtml: html })).toBe("#222");
  });

  it("detects and recolors an inline style fill", () => {
    const html = '<path style="fill:#334455;stroke:none"/>';
    expect(motifFillColor({ ...drawn, innerHtml: html })).toBe("#334455");
    expect(recolorMarkup(html, "#ff0000")).toContain("fill:#ff0000");
  });

  it("colors paintable elements that have no fill at all (default black)", () => {
    const out = recolorMarkup('<path d="M0 0"/>', "#00ff00");
    expect(out).toContain('fill="#00ff00"');
    // idempotent: re-coloring doesn't stack duplicate fills.
    const twice = recolorMarkup(out, "#0000ff");
    expect((twice.match(/fill=/g) ?? []).length).toBe(1);
    expect(twice).toContain('fill="#0000ff"');
  });

  it("recolors fill and stroke to one color, keeping none (single-color recolor)", () => {
    const html = '<circle fill="#222" stroke="#0f0"/><path fill="none" stroke="#00f"/>';
    const out = recolorMarkup(html, "#abcdef");
    expect(out).toContain('fill="#abcdef"'); // colored fill recolored
    expect(out).toContain('fill="none"'); // none preserved (stays unfilled)
    expect((out.match(/stroke="#abcdef"/g) ?? []).length).toBe(2); // both strokes recolored
  });

  it("recolors a stroke-dominated imported logo (fill + style strokes)", () => {
    const html =
      '<path style="stroke:black;stroke-width:36px"/>' +
      '<path style="fill:rgb(34,38,46);stroke:black;stroke-width:50px"/>';
    const out = recolorMarkup(html, "#ff0000");
    expect(out).not.toContain("stroke:black"); // outline recolored, not left black
    expect(out).toContain("fill:#ff0000"); // near-black fill recolored
    expect(out).toContain('fill="#ff0000"'); // the no-fill path gets the color
  });
});
