import { describe, expect, it } from "vitest";
import { createDrawnMotif, svgPathFromStroke } from "./drawnPath";
import type { Center } from "../types";

const square: Center[] = [
  { x: 200, y: 200 },
  { x: 300, y: 200 },
  { x: 300, y: 300 },
  { x: 200, y: 300 },
  { x: 200, y: 200 },
];

describe("createDrawnMotif (PRD §13)", () => {
  it("produces a normalized filled-path Motif anchored at its visual center", () => {
    const drawn = createDrawnMotif(square, 12, 50, "#abcdef");
    expect(drawn).not.toBeNull();
    const { motif, worldCenter } = drawn!;
    // filled closed region: literal fill + same-color round stroke, no currentColor
    expect(motif.innerHtml).toContain('fill="#abcdef"');
    expect(motif.innerHtml).toContain('stroke="#abcdef"');
    expect(motif.innerHtml).not.toContain("currentColor");
    expect(motif.innerHtml).toMatch(/^<path d="M/);
    expect(motif.innerHtml).toContain("Z"); // closed path
    // anchor is the bbox center; world center matches it
    expect(motif.anchorX).toBeCloseTo(motif.box.x + motif.box.width / 2);
    expect(motif.anchorY).toBeCloseTo(motif.box.y + motif.box.height / 2);
    expect(worldCenter.x).toBeCloseTo(motif.anchorX);
    expect(worldCenter.y).toBeCloseTo(motif.anchorY);
    // box roughly wraps the drawn 100x100 region (around world (250,250))
    expect(motif.box.width).toBeGreaterThan(80);
    expect(worldCenter.x).toBeGreaterThan(230);
    expect(worldCenter.x).toBeLessThan(270);
  });

  it("discards a stray click / tiny stroke", () => {
    expect(createDrawnMotif([{ x: 0, y: 0 }], 10, 50, "#000")).toBeNull();
    expect(createDrawnMotif([{ x: 0, y: 0 }, { x: 0.5, y: 0 }], 2, 50, "#000")).toBeNull();
  });
});

describe("svgPathFromStroke", () => {
  it("returns a closed quadratic path for enough points", () => {
    const d = svgPathFromStroke([
      [0, 0], [10, 0], [10, 10], [0, 10], [0, 0],
    ]);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });
  it("returns empty for too few points", () => {
    expect(svgPathFromStroke([[0, 0], [1, 1]])).toBe("");
  });
});
