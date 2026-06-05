#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const defaults = {
  input: path.join(repoRoot, "motif-seed-library", "drop-ai"),
  output: path.join(repoRoot, "motif-seed-library", "split-source"),
  limit: Infinity,
};

function usage() {
  console.log(`Prepare Illustrator .ai files and grouped SVG sheets for motif splitting.

Usage:
  npm run convert:motifs
  npm run convert:motifs -- --limit 5
  npm run convert:motifs -- --input /path/to/drop-folder --output /path/to/sheets

Default input:
  motif-seed-library/drop-ai

Default output:
  motif-seed-library/split-source
`);
}

function parseArgs(argv) {
  const args = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--input" || arg === "-i") {
      args.input = path.resolve(argv[++i] ?? "");
    } else if (arg === "--output" || arg === "-o") {
      args.output = path.resolve(argv[++i] ?? "");
    } else if (arg === "--limit" || arg === "-l") {
      const n = Number(argv[++i]);
      args.limit = Number.isFinite(n) && n > 0 ? Math.floor(n) : Infinity;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
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

function svgNameFor(file) {
  return `${path.basename(file, path.extname(file))}.svg`;
}

async function listSeedFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => {
      const ext = path.extname(entry.name).toLowerCase();
      return entry.isFile() && (ext === ".ai" || ext === ".svg");
    })
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function cleanSvg(file) {
  let svg = await readFile(file, "utf8");
  svg = svg
    .replace(/<\?xml[^>]*>\s*/i, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<metadata[\s\S]*?<\/metadata>\s*/gi, "")
    .replace(/<sodipodi:namedview[\s\S]*?<\/sodipodi:namedview>\s*/gi, "")
    .replace(/\s+(inkscape|sodipodi):[a-zA-Z0-9_-]+="[^"]*"/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  await writeFile(file, `${svg}\n`, "utf8");
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

  const files = (await listSeedFiles(args.input)).slice(0, args.limit);
  if (files.length === 0) {
    console.log(`No .ai or .svg files found in ${path.relative(repoRoot, args.input)}`);
    console.log("Drop a few .ai files or grouped SVG sheets there, then run: npm run convert:motifs -- --limit 5");
    return;
  }

  const needsInkscape = files.some((file) => path.extname(file).toLowerCase() === ".ai");
  const inkscape = needsInkscape ? findInkscape() : null;
  if (needsInkscape && !inkscape) {
    console.error("Could not find Inkscape.");
    console.error("Install it from https://inkscape.org, or set INKSCAPE_BIN=/path/to/inkscape.");
    console.error("Then run: npm run convert:motifs -- --limit 5");
    process.exitCode = 1;
    return;
  }

  const report = [];
  for (const inputFile of files) {
    const outputFile = path.join(args.output, svgNameFor(inputFile));
    if (path.extname(inputFile).toLowerCase() === ".svg") {
      const svg = await readFile(inputFile, "utf8");
      await writeFile(outputFile, svg, "utf8");
      await cleanSvg(outputFile);
      report.push({ input: path.basename(inputFile), output: path.basename(outputFile), ok: true, copied: true });
      console.log(`OK ${path.basename(inputFile)} -> ${path.basename(outputFile)}`);
      continue;
    }

    const result = spawnSync(
      inkscape,
      [inputFile, "--export-type=svg", `--export-filename=${outputFile}`],
      { encoding: "utf8" }
    );

    if (result.status === 0 && existsSync(outputFile)) {
      await cleanSvg(outputFile);
      report.push({ input: path.basename(inputFile), output: path.basename(outputFile), ok: true });
      console.log(`OK ${path.basename(inputFile)} -> ${path.basename(outputFile)}`);
    } else {
      report.push({
        input: path.basename(inputFile),
        output: path.basename(outputFile),
        ok: false,
        error: (result.stderr || result.stdout || "Unknown Inkscape error").trim(),
      });
      console.error(`FAIL ${path.basename(inputFile)}`);
      if (result.stderr) console.error(result.stderr.trim());
    }
  }

  const reportFile = path.join(args.output, "conversion-report.json");
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Report: ${path.relative(repoRoot, reportFile)}`);

  const failed = report.filter((item) => !item.ok).length;
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
