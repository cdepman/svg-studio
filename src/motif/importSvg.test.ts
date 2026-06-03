import { describe, expect, it } from "vitest";
import { importSvgFromText } from "./importSvg";

describe("importSvgFromText — sanitization (PRD §11, §14)", () => {
  it("strips <script> and on* handlers, flags the import as simplified", () => {
    const malicious = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <script>window.__pwned = true;</script>
      <rect width="10" height="10" onload="window.__pwned = true"/>
    </svg>`;
    const m = importSvgFromText(malicious);
    expect(m.innerHtml).not.toContain("<script");
    expect(m.innerHtml.toLowerCase()).not.toContain("onload");
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
    expect(m.simplified).toBe(true);
  });
});

describe("importSvgFromText — anchoring (PRD §6, §14)", () => {
  it("anchors at the center of a non-zero-origin viewBox", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 200 40 80">
      <rect x="100" y="200" width="40" height="80"/>
    </svg>`;
    const m = importSvgFromText(svg);
    expect(m.anchorX).toBe(120); // 100 + 40/2
    expect(m.anchorY).toBe(240); // 200 + 80/2
    expect(m.box).toEqual({ x: 100, y: 200, width: 40, height: 80 });
  });

  it("derives a box from width/height when viewBox is absent", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20">
      <circle cx="30" cy="10" r="5"/>
    </svg>`;
    const m = importSvgFromText(svg);
    expect(m.anchorX).toBe(30);
    expect(m.anchorY).toBe(10);
  });

  it("counts paintable elements as motif weight", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <path d="M0 0H10"/><rect width="2" height="2"/><circle r="1"/><g><line x1="0" y1="0" x2="1" y2="1"/></g>
    </svg>`;
    const m = importSvgFromText(svg);
    expect(m.weight).toBe(4);
  });
});
