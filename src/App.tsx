// App shell. Holds COMMITTED repeat state (params + center + motif). The
// imperative drag code (useCenterDrag, the slider handlers) owns continuous
// in-gesture deltas and never writes state here mid-gesture. PRD §4.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "./canvas/Canvas";
import { useCenterDrag } from "./canvas/useCenterDrag";
import { useScene } from "./canvas/useScene";
import { useViewport } from "./canvas/useViewport";
import { Controls } from "./controls/Controls";
import { isHeavy } from "./config";
import { DEFAULT_MOTIF_SVG } from "./defaultMotif";
import { importSvgFromFile, importSvgFromText } from "./motif/importSvg";
import { buildExportSvg, downloadSvg } from "./motif/exportSvg";
import type { Center, Motif, RepeatParams } from "./types";

const DEFAULT_PARAMS: RepeatParams = {
  count: 12,
  angleOffset: 0,
  radiusOffset: 140,
  sourceRotation: 0,
  orientationMode: "rotateWithCircle",
  mirrorAlternates: false,
  scaleStep: 0,
  opacityStep: 0,
  paintOffset: 0,
  tuck: false,
  seamBlend: 2,
};

export default function App() {
  const [motif, setMotif] = useState<Motif>(() => importSvgFromText(DEFAULT_MOTIF_SVG));
  const [params, setParams] = useState<RepeatParams>(DEFAULT_PARAMS);
  const [center, setCenter] = useState<Center>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Latest committed params for imperative merges during a single-slider drag.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const scene = useScene();
  // Keep the imperative seam-wedge resize (in applyInstances) using the live motif.
  scene.motifBoxRef.current = motif.box;
  const { viewport, setViewport, onWheel, panBy } = useViewport({ tx: 0, ty: 0, s: 1 });

  // Center the world origin in the viewport once on mount.
  useEffect(() => {
    const svg = scene.svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    setViewport((v) => ({ ...v, tx: r.width / 2, ty: r.height / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCenterPointerDown = useCenterDrag(scene, {
    onStart: () => setDragging(true),
    onCommit: (x, y) => {
      // Single React commit on release. Matches the last dragged frame, so no
      // visual jump. dragging=false swaps the full render back in. PRD §9, §10.
      setCenter({ x, y });
      setDragging(false);
    },
  });

  const onCommitParams = (partial: Partial<RepeatParams>) =>
    setParams((p) => ({ ...p, ...partial }));

  async function loadFile(file: File) {
    try {
      const m = await importSvgFromFile(file);
      setMotif(m);
      setNotice(m.simplified ? "This SVG was simplified on import." : null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not import that file.");
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetCenter() {
    const svg = scene.svgRef.current;
    if (!svg) {
      setCenter({ x: 0, y: 0 });
      return;
    }
    const r = svg.getBoundingClientRect();
    const w = scene.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    setCenter(w);
  }

  function onExport() {
    downloadSvg(buildExportSvg(motif, params, center));
  }

  const heavy = useMemo(() => isHeavy(params.count, motif.weight), [params.count, motif.weight]);

  return (
    <div className="app">
      <div className="topbar">
        <strong className="brand">Radial Repeat Studio</strong>
        <button onClick={() => fileInputRef.current?.click()}>Load SVG</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
            e.target.value = "";
          }}
        />
        <button onClick={resetCenter}>Reset center</button>
        <button onClick={onExport}>Export SVG</button>
        {notice && <span className="notice">{notice}</span>}
      </div>

      <div
        className="stage"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) loadFile(f);
        }}
      >
        <Canvas
          motif={motif}
          params={params}
          center={center}
          viewport={viewport}
          dragging={dragging}
          scene={scene}
          onCenterPointerDown={onCenterPointerDown}
          onWheel={onWheel}
          panBy={panBy}
        />
        <aside className="sidebar">
          <Controls
            params={params}
            paramsRef={paramsRef}
            applyInstances={scene.applyInstances}
            onCommit={onCommitParams}
            setDragging={setDragging}
          />
        </aside>
      </div>

      <div className="bottombar">
        <span>Zoom {Math.round(viewport.s * 100)}%</span>
        <span>Count {params.count}</span>
        <span>Motif weight {motif.weight}</span>
        {heavy && (
          <span className="warn">
            Heavy scene — drag shows a representative subset
          </span>
        )}
        <span className="hint">scroll = zoom · space/middle-drag = pan · drag the center handle</span>
      </div>
    </div>
  );
}
