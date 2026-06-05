#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { JSDOM } from "jsdom";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const defaults = {
  input: path.join(repoRoot, "motif-seed-library", "split-source"),
  output: path.join(repoRoot, "motif-seed-library", "svg"),
  mode: "top-level",
  gap: null,
  padding: 12,
  bounds: "dom",
};

const SKIP = new Set(["defs", "style", "title", "desc", "metadata", "sodipodi:namedview"]);
const NON_RENDERING_ANCESTORS = new Set([
  "defs",
  "clippath",
  "mask",
  "filter",
  "marker",
  "pattern",
  "symbol",
  "style",
  "metadata",
]);
const PAINTABLE = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "image"]);
const DEFINITION_TAGS = new Set([
  "clippath",
  "mask",
  "filter",
  "lineargradient",
  "radialgradient",
  "pattern",
  "marker",
  "symbol",
]);

function usage() {
  console.log(`Split sheet SVGs into separate motif SVG files.

Usage:
  npm run split:motifs
  npm run split:motifs -- --mode group-cluster --gap 40
  npm run split:motifs -- --mode cluster --bounds inkscape --gap 40
  npm run split:motifs -- --input /path/to/sheets --output /path/to/motifs

Default input:
  motif-seed-library/split-source

Default output:
  motif-seed-library/svg

Modes:
  top-level  Split direct children/groups. Best when Illustrator preserved groups.
  cluster    Cluster nearby SVG elements by approximate geometry.
  group-cluster
             Cluster terminal SVG groups. Best for Affinity grouped sheets.

Bounds:
  dom       Fast approximate bounds from SVG data.
  inkscape  Real rendered bounds from Inkscape. Best for Illustrator exports.
`);
}

function parseArgs(argv) {
  const args = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--input" || arg === "-i") args.input = path.resolve(argv[++i] ?? "");
    else if (arg === "--output" || arg === "-o") args.output = path.resolve(argv[++i] ?? "");
    else if (arg === "--mode" || arg === "-m") args.mode = argv[++i] ?? args.mode;
    else if (arg === "--gap" || arg === "-g") args.gap = Number(argv[++i]);
    else if (arg === "--padding" || arg === "-p") args.padding = Number(argv[++i]);
    else if (arg === "--bounds" || arg === "-b") args.bounds = argv[++i] ?? args.bounds;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["top-level", "cluster", "group-cluster"].includes(args.mode)) throw new Error(`Unknown mode: ${args.mode}`);
  if (!["dom", "inkscape"].includes(args.bounds)) throw new Error(`Unknown bounds mode: ${args.bounds}`);
  if (!Number.isFinite(args.padding)) args.padding = defaults.padding;
  return args;
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/\.svg$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "motif";
}

function nums(value) {
  return (value.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

function box(x, y, width, height) {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function pointsBox(values) {
  const n = nums(values);
  let out = null;
  for (let i = 0; i + 1 < n.length; i += 2) out = union(out, box(n[i], n[i + 1], 0.0001, 0.0001));
  return out;
}

const IDENTITY = [1, 0, 0, 1, 0, 0];

function multiplyMatrix(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function transformPoint(matrix, x, y) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

function transformBox(matrix, b) {
  if (!b) return null;
  const points = [
    transformPoint(matrix, b.minX, b.minY),
    transformPoint(matrix, b.maxX, b.minY),
    transformPoint(matrix, b.maxX, b.maxY),
    transformPoint(matrix, b.minX, b.maxY),
  ];
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function parseTransform(value) {
  if (!value) return IDENTITY;
  let matrix = IDENTITY;
  for (const match of value.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)) {
    const type = match[1].toLowerCase();
    const n = nums(match[2]);
    let next = IDENTITY;
    if (type === "matrix" && n.length >= 6) {
      next = n.slice(0, 6);
    } else if (type === "translate") {
      next = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
    } else if (type === "scale") {
      next = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    } else if (type === "rotate") {
      const angle = ((n[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rotate = [cos, sin, -sin, cos, 0, 0];
      if (n.length >= 3) {
        next = multiplyMatrix(
          multiplyMatrix([1, 0, 0, 1, n[1], n[2]], rotate),
          [1, 0, 0, 1, -n[1], -n[2]]
        );
      } else {
        next = rotate;
      }
    }
    matrix = multiplyMatrix(matrix, next);
  }
  return matrix;
}

function elementBox(el, parentMatrix = IDENTITY) {
  const matrix = multiplyMatrix(parentMatrix, parseTransform(el.getAttribute("transform")));
  const tag = el.tagName.toLowerCase();
  let own = null;
  if (tag === "rect" || tag === "image") {
    own = box(
      Number(el.getAttribute("x") ?? 0),
      Number(el.getAttribute("y") ?? 0),
      Number(el.getAttribute("width")),
      Number(el.getAttribute("height"))
    );
  } else if (tag === "circle") {
    const cx = Number(el.getAttribute("cx") ?? 0);
    const cy = Number(el.getAttribute("cy") ?? 0);
    const r = Number(el.getAttribute("r"));
    own = box(cx - r, cy - r, r * 2, r * 2);
  } else if (tag === "ellipse") {
    const cx = Number(el.getAttribute("cx") ?? 0);
    const cy = Number(el.getAttribute("cy") ?? 0);
    const rx = Number(el.getAttribute("rx"));
    const ry = Number(el.getAttribute("ry"));
    own = box(cx - rx, cy - ry, rx * 2, ry * 2);
  } else if (tag === "line") {
    const x1 = Number(el.getAttribute("x1") ?? 0);
    const y1 = Number(el.getAttribute("y1") ?? 0);
    const x2 = Number(el.getAttribute("x2") ?? 0);
    const y2 = Number(el.getAttribute("y2") ?? 0);
    own = { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
  } else if (tag === "polyline" || tag === "polygon") {
    own = pointsBox(el.getAttribute("points") ?? "");
  } else if (tag === "path") {
    own = pointsBox(el.getAttribute("d") ?? "");
  }

  let out = transformBox(matrix, own);
  for (const child of Array.from(el.children)) out = union(out, elementBox(child, matrix));
  return out;
}

function findInkscape() {
  const candidates = [
    process.env.INKSCAPE_BIN,
    "/Applications/Inkscape.app/Contents/MacOS/inkscape",
    "/opt/homebrew/bin/inkscape",
    "/usr/local/bin/inkscape",
    "inkscape",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.includes(path.sep) && !existsSync(candidate)) continue;
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (result.status === 0) return candidate;
  }
  return null;
}

function parseInkscapeQuery(stdout) {
  const bounds = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(",");
    if (parts.length < 5) continue;
    const [id, x, y, width, height] = parts;
    const b = box(Number(x), Number(y), Number(width), Number(height));
    if (id && b) bounds.set(id, b);
  }
  return bounds;
}

function inkscapeBoundsFor(file) {
  const inkscape = findInkscape();
  if (!inkscape) throw new Error("Inkscape bounds requested, but Inkscape was not found.");
  const result = spawnSync(inkscape, ["--query-all", file], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "Inkscape bounds query failed").trim());
  }
  return parseInkscapeQuery(result.stdout);
}

function queryBox(el, queryBounds) {
  const id = el.getAttribute("id");
  return id ? queryBounds.get(id) ?? null : null;
}

function inflatedIntersects(a, b, gap) {
  return (
    a.minX - gap <= b.maxX &&
    a.maxX + gap >= b.minX &&
    a.minY - gap <= b.maxY &&
    a.maxY + gap >= b.minY
  );
}

function clusterCandidates(candidates, gap) {
  const remaining = new Set(candidates);
  const clusters = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    remaining.delete(first);
    const cluster = [first];
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of Array.from(remaining)) {
        if (cluster.some((member) => inflatedIntersects(member.bbox, item.bbox, gap))) {
          remaining.delete(item);
          cluster.push(item);
          changed = true;
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function contentRoot(svg) {
  const children = Array.from(svg.children).filter((el) => !SKIP.has(el.tagName.toLowerCase()));
  return children.length === 1 && children[0].tagName.toLowerCase() === "g" ? children[0] : svg;
}

function directCandidates(root) {
  const direct = Array.from(root.children).filter((el) => {
    const tag = el.tagName.toLowerCase();
    return tag === "g" || PAINTABLE.has(tag);
  });
  return direct.length > 0 ? direct : Array.from(root.querySelectorAll(Array.from(PAINTABLE).join(",")));
}

function isRenderablePaintable(el) {
  const tag = el.tagName.toLowerCase();
  if (!PAINTABLE.has(tag)) return false;
  let parent = el.parentElement;
  while (parent) {
    if (NON_RENDERING_ANCESTORS.has(parent.tagName.toLowerCase())) return false;
    parent = parent.parentElement;
  }
  return true;
}

function paintableCandidates(svg) {
  return Array.from(svg.querySelectorAll(Array.from(PAINTABLE).join(","))).filter(isRenderablePaintable);
}

function groupChildCount(el) {
  return Array.from(el.children).filter((child) => child.tagName.toLowerCase() === "g").length;
}

function isTerminalMotifGroup(el) {
  if (el.tagName.toLowerCase() !== "g" || !isRenderableGroup(el)) return false;
  const directGroups = Array.from(el.children).filter((child) => child.tagName.toLowerCase() === "g");
  if (directGroups.length < 2) return false;
  return !directGroups.some((child) => groupChildCount(child) >= 2);
}

function isRenderableGroup(el) {
  let parent = el.parentElement;
  while (parent) {
    if (NON_RENDERING_ANCESTORS.has(parent.tagName.toLowerCase())) return false;
    parent = parent.parentElement;
  }
  return true;
}

function groupCandidates(svg) {
  return Array.from(svg.querySelectorAll("g")).filter(isTerminalMotifGroup);
}

function styleMarkup(svg) {
  return Array.from(svg.children)
    .filter((el) => el.tagName.toLowerCase() === "style")
    .map((el) => el.outerHTML)
    .join("\n");
}

function referencedIds(markup) {
  const refs = new Set();
  for (const match of markup.matchAll(/url\(#([^)]+)\)|(?:href|xlink:href)="#([^"]+)"/g)) {
    const id = match[1] ?? match[2];
    if (id) refs.add(id);
  }
  return refs;
}

function defsMarkupFor(svg, body) {
  const refs = referencedIds(body);
  const needed = new Set(refs);
  const queue = Array.from(refs);
  while (queue.length) {
    const id = queue.pop();
    if (!id) continue;
    const el = svg.ownerDocument.getElementById(id);
    if (!el) continue;
    for (const nested of referencedIds(el.outerHTML)) {
      if (!needed.has(nested)) {
        needed.add(nested);
        queue.push(nested);
      }
    }
  }

  const definitions = Array.from(svg.querySelectorAll("[id]")).filter((el) => {
    const tag = el.tagName.toLowerCase();
    return needed.has(el.getAttribute("id") ?? "") && DEFINITION_TAGS.has(tag);
  });
  if (definitions.length === 0) return "";
  return `<defs>\n${definitions.map((el) => el.outerHTML).join("\n")}\n</defs>`;
}

function attrsWithoutId(el) {
  return Array.from(el.attributes)
    .filter((attr) => attr.name !== "id" && !attr.name.includes(":"))
    .map((attr) => `${attr.name}="${attr.value.replace(/"/g, "&quot;")}"`)
    .join(" ");
}

function contentWrapperStart(root, svg) {
  if (root === svg || root.tagName.toLowerCase() !== "g") return "<g>";
  const attrs = attrsWithoutId(root);
  return attrs ? `<g ${attrs}>` : "<g>";
}

function wrapperAttrs(el) {
  const attrs = ["transform", "opacity", "style", "fill", "stroke", "stroke-width"]
    .map((name) => {
      const value = el.getAttribute(name);
      return value ? `${name}="${value.replace(/"/g, "&quot;")}"` : "";
    })
    .filter(Boolean)
    .join(" ");
  return attrs;
}

function wrappedElementMarkup(el, root) {
  let body = el.outerHTML;
  const ancestors = [];
  let parent = el.parentElement;
  while (parent && parent !== root) {
    ancestors.push(parent);
    parent = parent.parentElement;
  }
  for (const ancestor of ancestors) {
    const attrs = wrapperAttrs(ancestor);
    if (attrs) body = `<g ${attrs}>\n${body}\n</g>`;
  }
  return body;
}

function ancestorMatrix(el, svg) {
  const ancestors = [];
  let parent = el.parentElement;
  while (parent && parent !== svg) {
    ancestors.push(parent);
    parent = parent.parentElement;
  }
  return ancestors.reverse().reduce((matrix, ancestor) => multiplyMatrix(matrix, parseTransform(ancestor.getAttribute("transform"))), IDENTITY);
}

function isLikelySheetBackground(item, sheetBox) {
  if (!sheetBox) return false;
  const sheetWidth = sheetBox.maxX - sheetBox.minX;
  const sheetHeight = sheetBox.maxY - sheetBox.minY;
  const width = item.bbox.maxX - item.bbox.minX;
  const height = item.bbox.maxY - item.bbox.minY;
  return width >= sheetWidth * 0.9 && height >= sheetHeight * 0.9;
}

async function splitFile(file, args) {
  const raw = await readFile(file, "utf8");
  const dom = new JSDOM(raw, { contentType: "image/svg+xml" });
  const svg = dom.window.document.querySelector("svg");
  if (!svg) return { file, count: 0, error: "No <svg> root found" };

  const root = contentRoot(svg);
  const queryBounds = args.bounds === "inkscape" ? inkscapeBoundsFor(file) : null;
  const elements =
    args.mode === "cluster" ? paintableCandidates(svg) : args.mode === "group-cluster" ? groupCandidates(svg) : directCandidates(root);
  const candidates = elements
    .map((el) => ({ el, bbox: queryBounds ? queryBox(el, queryBounds) : elementBox(el, ancestorMatrix(el, svg)) }))
    .filter((item) => item.bbox);
  if (candidates.length === 0) return { file, count: 0, error: "No splittable SVG elements found" };

  const sheetBox = queryBounds?.get(svg.getAttribute("id") ?? "") ?? candidates.reduce((acc, item) => union(acc, item.bbox), null);
  const filtered = candidates.filter((item) => !isLikelySheetBackground(item, sheetBox));
  const usable = filtered.length > 0 ? filtered : candidates;
  const whole = usable.reduce((acc, item) => union(acc, item.bbox), null);
  const autoGap = Math.max(8, Math.min(80, Math.max(whole.maxX - whole.minX, whole.maxY - whole.minY) * 0.025));
  const clusters = args.mode === "cluster" ? clusterCandidates(usable, Number.isFinite(args.gap) ? args.gap : autoGap) : usable.map((c) => [c]);
  const styles = styleMarkup(svg);
  const base = slug(path.basename(file));
  const wrapperStart = contentWrapperStart(root, svg);

  let index = 0;
  for (const cluster of clusters) {
    index += 1;
    const b0 = cluster.reduce((acc, item) => union(acc, item.bbox), null);
    const pad = args.padding;
    const b = {
      minX: b0.minX - pad,
      minY: b0.minY - pad,
      maxX: b0.maxX + pad,
      maxY: b0.maxY + pad,
    };
    const body = cluster.map((item) => wrappedElementMarkup(item.el, root)).join("\n");
    const defs = defsMarkupFor(svg, body);
    const preamble = [defs, styles].filter(Boolean).join("\n");
    const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX} ${b.minY} ${b.maxX - b.minX} ${b.maxY - b.minY}">
${preamble ? `${preamble}\n` : ""}${wrapperStart}
${body}
</g>
</svg>
`;
    const name = `${base}-${String(index).padStart(2, "0")}.svg`;
    await writeFile(path.join(args.output, name), out, "utf8");
  }
  return { file, count: clusters.length };
}

async function listSvgFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".svg"))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    usage();
    return;
  }

  await mkdir(args.input, { recursive: true });
  await mkdir(args.output, { recursive: true });

  const files = await listSvgFiles(args.input);
  if (files.length === 0) {
    console.log(`No sheet SVGs found in ${path.relative(repoRoot, args.input)}`);
    console.log("Put a converted multi-motif SVG there, then run: npm run split:motifs");
    return;
  }

  const report = [];
  for (const file of files) {
    const result = await splitFile(file, args);
    report.push(result);
    if (result.error) console.error(`FAIL ${path.basename(file)}: ${result.error}`);
    else console.log(`OK ${path.basename(file)} -> ${result.count} motif SVGs`);
  }
  await writeFile(path.join(args.output, "split-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
