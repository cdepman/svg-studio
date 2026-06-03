// Resolve the repeat into a fresh, portable SVG. Stretch goal — strictly
// post-validation. PRD §12.
import {
  instanceOpacity,
  instanceTransform,
  paintOrder,
  seamReach,
  seamWedgePath,
  tuckIndices,
} from "../canvas/repeatMath";
import type { Center, Motif, RepeatParams } from "../types";

export function buildExportSvg(
  motif: Motif,
  params: RepeatParams,
  center: Center
): string {
  // Generous bounds: farthest a (possibly scaled) copy can reach from center.
  let maxAbsScale = 1;
  for (let i = 0; i < params.count; i++) {
    maxAbsScale = Math.max(maxAbsScale, Math.abs(1 + i * params.scaleStep));
  }
  const halfDiag =
    0.5 * Math.hypot(motif.box.width, motif.box.height) * maxAbsScale;
  const reach = params.radiusOffset + halfDiag;
  const bound = reach + 8;
  const size = 2 * bound;
  const viewBox = `${center.x - bound} ${center.y - bound} ${size} ${size}`;

  const useEl = (i: number) =>
    `    <use href="#motif" transform="${instanceTransform(
      params,
      i
    )}" opacity="${instanceOpacity(params, i)}"/>`;

  // Paint in z-order so a relocated seam is preserved in the export.
  const uses = paintOrder(params.count, params.paintOffset).map(useEl);

  // Resolve the tuck (clip + redrawn copies) into the output too. PRD §12.
  let wedgeDef = "";
  let tuckGroup = "";
  if (params.tuck) {
    const d = seamWedgePath(params, seamReach(params, motif.box));
    wedgeDef = `\n    <clipPath id="seam-wedge" clipPathUnits="userSpaceOnUse"><path d="${d}"/></clipPath>`;
    const redraw = tuckIndices(params.count, params.paintOffset, params.seamBlend)
      .map(useEl)
      .join("\n");
    tuckGroup = `\n    <g clip-path="url(#seam-wedge)">\n${redraw}\n    </g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}">
  <defs>
    <g id="motif" transform="translate(${-motif.anchorX},${-motif.anchorY})">${motif.innerHtml}</g>${wedgeDef}
  </defs>
  <g transform="translate(${center.x},${center.y})">
${uses.join("\n")}${tuckGroup}
  </g>
</svg>
`;
}

export function downloadSvg(svgText: string, filename = "radial-repeat.svg") {
  const blob = new Blob([svgText], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
