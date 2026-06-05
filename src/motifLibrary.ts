export interface MotifLibraryItem {
  id: string;
  name: string;
  filename: string;
  previewUrl: string;
  loadSvg: () => Promise<string>;
}

const motifUrls = import.meta.glob("../motif-seed-library/svg/*.svg", {
  eager: true,
  import: "default",
  query: "?url",
}) as Record<string, string>;

const motifLoaders = import.meta.glob("../motif-seed-library/svg/*.svg", {
  import: "default",
  query: "?raw",
}) as Record<string, () => Promise<string>>;

function displayName(filename: string) {
  return filename
    .replace(/\.svg$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export const MOTIF_LIBRARY: MotifLibraryItem[] = Object.entries(motifUrls)
  .map(([file, previewUrl]) => {
    const filename = file.split("/").pop() ?? file;
    return {
      id: filename.toLowerCase(),
      name: displayName(filename),
      filename,
      previewUrl,
      loadSvg: motifLoaders[file],
    };
  })
  .filter((item) => item.loadSvg)
  .sort((a, b) => a.name.localeCompare(b.name));
