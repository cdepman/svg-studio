# Motif Seed Library

Drop Illustrator `.ai` files or grouped sheet `.svg` files into `drop-ai`, then run:

```sh
npm run convert:motifs -- --limit 5
```

Prepared sheet SVGs are written to `split-source`.

If each motif is a top-level group, split the sheet with:

```sh
npm run split:motifs
```

That writes separate motif SVGs into `svg`.

If the export did not preserve each motif as a top-level group, try geometry clustering.
For dense Illustrator/Inkscape exports, use Inkscape-rendered bounds:

```sh
npm run split:motifs -- --mode cluster --bounds inkscape --gap 40
```

The converter uses Inkscape for `.ai` files. If it is not installed in a standard location, run:

```sh
INKSCAPE_BIN=/path/to/inkscape npm run convert:motifs -- --limit 5
```
