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
    const drawn = createDrawnMotif(square, 2, 50, "#abcdef", "#111111", 2, 0, true);
    expect(drawn).not.toBeNull();
    const { motif, worldCenter } = drawn!;
    // filled closed region: literal fill + real border, no currentColor
    expect(motif.innerHtml).toContain('fill="#abcdef"');
    expect(motif.innerHtml).toContain('stroke="#111111"');
    expect(motif.innerHtml).toContain('stroke-width="2"');
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

  it("keeps open strokes as stroked centerline paths instead of filled brush blobs", () => {
    const drawn = createDrawnMotif(square.slice(0, 4), 2, 50, "#123456", "#0a0a0a", 2, 0, false);
    expect(drawn).not.toBeNull();
    expect(drawn!.motif.innerHtml).toContain('fill="none"');
    expect(drawn!.motif.innerHtml).toContain('stroke="#0a0a0a"');
    expect(drawn!.motif.innerHtml).toContain('stroke-width="2"');
    expect(drawn!.motif.innerHtml).not.toContain("Z");
  });

  it("simplifies a straightforward pencil line into a small cubic path", () => {
    const points = Array.from({ length: 80 }, (_, i) => ({
      x: i * 3,
      y: Math.sin(i / 5) * 1.5,
    }));
    const drawn = createDrawnMotif(points, 2, 80, "#123456", "#0a0a0a", 2, 0, false);
    expect(drawn).not.toBeNull();
    const commands = drawn!.motif.innerHtml.match(/[CLQ]/g) ?? [];
    expect(commands.length).toBeLessThanOrEqual(8);
  });

  it("keeps a small closed circle compact instead of emitting every sampled point", () => {
    const points = Array.from({ length: 72 }, (_, i) => {
      const a = (i / 72) * Math.PI * 2;
      return { x: 100 + Math.cos(a) * 24, y: 100 + Math.sin(a) * 24 };
    });
    points.push(points[0]);
    const drawn = createDrawnMotif(points, 2, 80, "#123456", "#0a0a0a", 2, 0, true);
    expect(drawn).not.toBeNull();
    const commands = drawn!.motif.innerHtml.match(/[CLQ]/g) ?? [];
    expect(commands.length).toBeLessThanOrEqual(12);
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
  it("returns an open line path for two-point centerlines", () => {
    expect(svgPathFromStroke([[0, 0], [1, 1]], false)).toBe("M0,0 L1,1");
  });
  it("returns empty for fewer than two points", () => {
    expect(svgPathFromStroke([[0, 0]])).toBe("");
  });
});
