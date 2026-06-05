import { describe, expect, it } from "vitest";
import { importSvgFromText } from "./importSvg";
import {
  duplicatePart,
  partColor,
  reorderParts,
  serializeMotif,
  setPartFill,
  setPartTransform,
  setPartVisible,
} from "./parts";

const ring = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <g id="Background" transform="translate(10,0)">
    <path d="M0 0 H10" style="fill:rgb(34,38,46);stroke:black"/>
    <g transform="rotate(30)"><path d="M0 0 H5" style="fill:rgb(34,38,46)"/></g>
    <g transform="rotate(60)"><path d="M0 0 H5" style="fill:rgb(34,38,46)"/></g>
  </g>
</svg>`;

const clippedDot = `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>.dot { clip-path: url(#dotClip); opacity: .8; }</style>
    <clipPath id="dotClip"><circle cx="20" cy="20" r="10"/></clipPath>
  </defs>
  <g class="dot">
    <rect x="10" y="10" width="20" height="20" fill="#ffb8da"/>
  </g>
</svg>`;

describe("motif parts", () => {
  it("flattens an imported SVG into one part per paintable leaf", () => {
    const motif = importSvgFromText(ring);
    expect(motif.parts?.length).toBe(3);
    // First leaf takes its group's id; others fall back to Path N.
    expect(motif.parts?.[0].name).toBe("Background");
  });

  it("bakes ancestor transforms into each part so the result renders identically", () => {
    const motif = importSvgFromText(ring);
    // The two rod paths carry both the Background translate and their own rotate.
    expect(motif.parts?.[1].baseMarkup).toContain("translate(10,0)");
    expect(motif.parts?.[1].baseMarkup).toContain("rotate(30)");
  });

  it("preserves class-based ancestor clipping when flattening paintable leaves", () => {
    const motif = importSvgFromText(clippedDot);
    expect(motif.parts?.length).toBe(1);
    expect(motif.parts?.[0].baseMarkup).toContain('class="dot"');
    expect(motif.innerHtml).toContain(".dot");
    expect(motif.innerHtml).toContain("clip-path: url(#dotClip)");
    expect(motif.innerHtml).toContain("<rect");
  });

  it("derives innerHtml from the visible parts; hiding one drops it", () => {
    const motif = importSvgFromText(ring);
    const full = serializeMotif(motif);
    expect((full.match(/<path/g) ?? []).length).toBe(3);

    const hidden = setPartVisible(motif, motif.parts![0].id, false);
    expect((hidden.innerHtml.match(/<path/g) ?? []).length).toBe(2);
    expect(hidden.parts?.[0].visible).toBe(false);
  });

  it("recolors one part non-destructively (override drives the render)", () => {
    const motif = importSvgFromText(ring);
    const id = motif.parts![1].id;
    const out = setPartFill(motif, id, "#ff0000");
    expect(out.parts?.[1].fill).toBe("#ff0000");
    expect(partColor(out.parts![1])).toBe("#ff0000");
    // baseMarkup is untouched; the override shows in the derived innerHtml.
    expect(out.parts?.[1].baseMarkup).toContain("rgb(34,38,46)");
    expect(out.innerHtml).toContain("#ff0000");
  });

  it("applies a part transform about the part center in the derived markup", () => {
    const motif = importSvgFromText(ring);
    const id = motif.parts![0].id;
    const out = setPartTransform(motif, id, { tx: 5, ty: -3, rotation: 45, scale: 2 });
    expect(out.parts?.[0].transform.rotation).toBe(45);
    expect(out.innerHtml).toContain("rotate(45)");
    expect(out.innerHtml).toContain("translate(5 -3)");
  });

  it("duplicates a part with a new id + transform, inserted above the original", () => {
    const motif = importSvgFromText(ring);
    const srcId = motif.parts![0].id;
    const out = duplicatePart(motif, srcId, "part-copy", { tx: 10, ty: 5, rotation: 0, scale: 1.5 });
    expect(out.parts?.length).toBe(4);
    const copy = out.parts!.find((p) => p.id === "part-copy")!;
    expect(copy.baseMarkup).toBe(motif.parts![0].baseMarkup); // same geometry
    expect(copy.transform.scale).toBe(1.5);
    // inserted right after the original (paint above it)
    expect(out.parts!.findIndex((p) => p.id === "part-copy")).toBe(1);
    expect(out.innerHtml).toContain("scale(1.5)");
  });

  it("reorders parts (paint order) by id", () => {
    const motif = importSvgFromText(ring);
    const [a, b, c] = motif.parts!.map((p) => p.id);
    const out = reorderParts(motif, c, a); // move last before first
    expect(out.parts?.map((p) => p.id)).toEqual([c, a, b]);
  });
});
