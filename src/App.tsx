// App shell. Holds the DOCUMENT: a flat layer array, a primary selectedLayerId,
// and an allSelected flag for synchronized manipulation. The imperative drag
// code owns continuous in-gesture deltas for the selected layer(s) and never
// writes state mid-gesture. PRD §12, §15.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, type SelectionBox } from "./canvas/Canvas";
import { useCenterDrag } from "./canvas/useCenterDrag";
import { useScene, type DragTargetSpec, type NumericParamKey } from "./canvas/useScene";
import { useViewport } from "./canvas/useViewport";
import { boundsReach } from "./canvas/repeatMath";
import { Controls } from "./controls/Controls";
import { LayersPanel, type MoveDir } from "./layers/LayersPanel";
import { DEFAULT_MOTIF_SVG } from "./defaultMotif";
import { importSvgFromFile, importSvgFromText } from "./motif/importSvg";
import { buildExportSvg, downloadSvg } from "./motif/exportSvg";
import {
  createLayer,
  duplicateLayer,
  duplicateLayers,
  insertAbove,
  moveBackward,
  moveForward,
  moveToBack,
  moveToFront,
  removeLayer,
  reorderByDisplay,
  updateLayer,
} from "./document/layers";
import type { Center, Layer, Motif, RepeatParams } from "./types";

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** AABB intersection between a marquee rect and a layer's square artwork box. */
function boxIntersects(r: WorldRect, c: Center, reach: number): boolean {
  return (
    c.x - reach <= r.maxX &&
    c.x + reach >= r.minX &&
    c.y - reach <= r.maxY &&
    c.y + reach >= r.minY
  );
}

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
  tuck: true, // on by default
  seamBlend: 2, // tuck depth: how many copies a petal laps. Small + explicit.
};

export default function App() {
  const [layers, setLayers] = useState<Layer[]>(() => [
    createLayer({
      name: "Radial Repeat 1",
      motif: importSvgFromText(DEFAULT_MOTIF_SVG),
      params: DEFAULT_PARAMS,
      center: { x: 0, y: 0 },
    }),
  ]);
  // Selection is a SET of layer ids (single click, shift-click, marquee drag,
  // or select-all all funnel into this). The last entry is the "primary".
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    layers[0] ? [layers[0].id] : []
  );
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const newLayerCount = useRef(1);

  const scene = useScene();
  const { viewport, setViewport, onWheel, panBy } = useViewport({ tx: 0, ty: 0, s: 1 });

  // --- Derived selection ---
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const primaryId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  const allSelected = layers.length > 0 && selectedIds.length === layers.length;

  // Layers that can actually be manipulated geometrically.
  const editableSelected = useMemo(
    () => layers.filter((l) => selectedSet.has(l.id) && l.visible && !l.locked),
    [layers, selectedSet]
  );

  const primary = useMemo<Layer | null>(() => {
    const p = layers.find((l) => l.id === primaryId);
    if (p && p.visible && !p.locked) return p;
    return editableSelected[0] ?? p ?? null;
  }, [layers, primaryId, editableSelected]);

  // Combined handle = centroid of the editable selected centers.
  const handlePos = useMemo<Center | null>(() => {
    if (editableSelected.length === 0) return null;
    const sum = editableSelected.reduce(
      (a, l) => ({ x: a.x + l.center.x, y: a.y + l.center.y }),
      { x: 0, y: 0 }
    );
    return { x: sum.x / editableSelected.length, y: sum.y / editableSelected.length };
  }, [editableSelected]);

  const boxes = useMemo<SelectionBox[]>(
    () =>
      editableSelected.map((l) => ({
        id: l.id,
        center: l.center,
        reach: boundsReach(l.params, l.motif.box),
      })),
    [editableSelected]
  );

  // --- Keep the imperative side current (read at gesture start) ---
  scene.selectedLayerIdRef.current = primaryId;
  scene.handlePosRef.current = handlePos ?? { x: 0, y: 0 };
  scene.dragTargetsRef.current = useMemo<DragTargetSpec[]>(
    () =>
      editableSelected.map((l) => ({
        id: l.id,
        params: l.params,
        center: l.center,
        motifBox: l.motif.box,
      })),
    [editableSelected]
  );
  const primaryParamsRef = useRef<RepeatParams | null>(primary?.params ?? null);
  primaryParamsRef.current = primary?.params ?? null;

  const editableIdsRef = useRef<Set<string>>(new Set());
  editableIdsRef.current = new Set(editableSelected.map((l) => l.id));

  const docRef = useRef({ layers, selectedIds, primaryId, dragging });
  docRef.current = { layers, selectedIds, primaryId, dragging };

  // Center the world origin in the viewport once on mount.
  useEffect(() => {
    const svg = scene.svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    setViewport((v) => ({ ...v, tx: r.width / 2, ty: r.height / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function viewportCenterWorld(): Center {
    const svg = scene.svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return scene.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  // --- Editing: absolute (discrete) and delta (continuous) over the selection ---
  const onCommitAbsolute = (partial: Partial<RepeatParams>) => {
    const ids = editableIdsRef.current;
    setLayers((ls) =>
      ls.map((l) =>
        ids.has(l.id)
          ? { ...l, params: { ...l.params, ...partial }, updatedAt: Date.now() }
          : l
      )
    );
  };
  const onCommitDelta = (key: NumericParamKey, delta: number) => {
    const ids = editableIdsRef.current;
    setLayers((ls) =>
      ls.map((l) =>
        ids.has(l.id)
          ? { ...l, params: { ...l.params, [key]: l.params[key] + delta }, updatedAt: Date.now() }
          : l
      )
    );
  };

  const onCenterPointerDown = useCenterDrag(scene, {
    onStart: () => setDragging(true),
    onCommit: (delta) => {
      const ids = editableIdsRef.current;
      // Single React commit applying the gesture delta to every dragged layer.
      if (delta.x !== 0 || delta.y !== 0) {
        setLayers((ls) =>
          ls.map((l) =>
            ids.has(l.id)
              ? { ...l, center: { x: l.center.x + delta.x, y: l.center.y + delta.y }, updatedAt: Date.now() }
              : l
          )
        );
      }
      setDragging(false);
    },
  });

  // --- Selection actions ---
  const selectSingle = (id: string, additive = false) => {
    setSelectedIds((prev) =>
      additive
        ? prev.includes(id)
          ? prev.filter((x) => x !== id)
          : [...prev, id]
        : [id]
    );
  };
  const selectAll = () => setSelectedIds(layers.map((l) => l.id));
  const collapseToPrimary = () =>
    setSelectedIds((prev) => (prev.length ? [prev[prev.length - 1]] : []));

  // Marquee (click-drag) selection: select every visible, unlocked layer whose
  // artwork box intersects the dragged rectangle. Shift adds to the selection.
  const onMarqueeSelect = (rect: WorldRect, additive: boolean) => {
    const hit = layers
      .filter(
        (l) =>
          l.visible &&
          !l.locked &&
          boxIntersects(rect, l.center, boundsReach(l.params, l.motif.box))
      )
      .map((l) => l.id);
    setSelectedIds((prev) =>
      additive ? Array.from(new Set([...prev, ...hit])) : hit
    );
  };

  // --- Layer operations ---
  function addLayerFromMotif(motif: Motif, name: string, params = DEFAULT_PARAMS) {
    const layer = createLayer({ name, motif, params, center: viewportCenterWorld() });
    setLayers((ls) => [...ls, layer]);
    selectSingle(layer.id);
    return layer;
  }
  function onNewLayer() {
    const motif = primary?.motif ?? importSvgFromText(DEFAULT_MOTIF_SVG);
    newLayerCount.current += 1;
    addLayerFromMotif(motif, `Radial Repeat ${newLayerCount.current}`);
  }
  function onDuplicate(id: string) {
    setLayers((ls) => {
      const original = ls.find((l) => l.id === id);
      if (!original) return ls;
      const copy = duplicateLayer(original);
      setSelectedIds([copy.id]);
      return insertAbove(ls, copy, id);
    });
  }
  // Duplicate every selected layer at once (the toolbar action + ⌘D). Each copy
  // lands directly above its original; the copies become the new selection.
  function onDuplicateSelected() {
    const { layers: ls, selectedIds: sel } = docRef.current;
    if (sel.length === 0) return;
    const { layers: next, newIds } = duplicateLayers(ls, new Set(sel));
    setLayers(next);
    setSelectedIds(newIds);
  }
  function onDelete(id: string) {
    setLayers((ls) => {
      const idx = ls.findIndex((l) => l.id === id);
      const next = removeLayer(ls, id);
      setSelectedIds((prev) => {
        const kept = prev.filter((x) => x !== id);
        if (kept.length) return kept;
        const fb = next[Math.min(idx, next.length - 1)];
        return fb ? [fb.id] : [];
      });
      return next;
    });
  }
  const onRename = (id: string, name: string) =>
    setLayers((ls) => updateLayer(ls, id, (l) => ({ ...l, name, updatedAt: Date.now() })));
  const onToggleVisible = (id: string) => {
    if (docRef.current.dragging) return; // no visibility changes mid-gesture. PRD §17.
    setLayers((ls) => updateLayer(ls, id, (l) => ({ ...l, visible: !l.visible, updatedAt: Date.now() })));
  };
  const onToggleLocked = (id: string) => {
    if (docRef.current.dragging) return;
    setLayers((ls) => updateLayer(ls, id, (l) => ({ ...l, locked: !l.locked, updatedAt: Date.now() })));
  };
  const onMove = (id: string, dir: MoveDir) => {
    setLayers((ls) => {
      switch (dir) {
        case "front": return moveToFront(ls, id);
        case "forward": return moveForward(ls, id);
        case "backward": return moveBackward(ls, id);
        case "back": return moveToBack(ls, id);
      }
    });
  };
  const onReorder = (draggedId: string, targetId: string) =>
    setLayers((ls) => reorderByDisplay(ls, draggedId, targetId));

  function resetCenter() {
    const ids = editableIdsRef.current;
    const w = viewportCenterWorld();
    setLayers((ls) => ls.map((l) => (ids.has(l.id) ? { ...l, center: w, updatedAt: Date.now() } : l)));
  }

  async function loadFile(file: File) {
    try {
      const m = await importSvgFromFile(file);
      newLayerCount.current += 1;
      addLayerFromMotif(m, `Radial Repeat ${newLayerCount.current}`);
      setNotice(m.simplified ? "This SVG was simplified on import." : null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not import that file.");
    }
  }
  function onExport() {
    downloadSvg(buildExportSvg(layers));
  }
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Keyboard shortcuts (PRD §16). Skip when typing in a field. ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const { primaryId: id } = docRef.current;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key === "Escape" && docRef.current.selectedIds.length > 1) {
        collapseToPrimary();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        onDuplicateSelected();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
        e.preventDefault();
        if (id) onDelete(id);
        return;
      }
      if (mod && e.key === "]") {
        e.preventDefault();
        if (id) onMove(id, e.shiftKey ? "front" : "forward");
        return;
      }
      if (mod && e.key === "[") {
        e.preventDefault();
        if (id) onMove(id, e.shiftKey ? "back" : "backward");
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleCount = useMemo(() => layers.filter((l) => l.visible).length, [layers]);
  const editableForControls = editableSelected.length > 0;

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
        <button onClick={onNewLayer}>New Layer</button>
        <button
          className={allSelected ? "active" : ""}
          onClick={() => (allSelected ? collapseToPrimary() : selectAll())}
          disabled={layers.length === 0}
        >
          {allSelected ? "Selected: All" : "Select All"}
        </button>
        <button onClick={onDuplicateSelected} disabled={selectedIds.length === 0}>
          {selectedIds.length > 1 ? `Duplicate ${selectedIds.length}` : "Duplicate"}
        </button>
        <button onClick={() => primaryId && onDelete(primaryId)} disabled={!primaryId}>
          Delete
        </button>
        <button onClick={resetCenter} disabled={!editableForControls}>
          Reset center
        </button>
        <button onClick={onExport}>Export SVG</button>
        {notice && <span className="notice">{notice}</span>}
      </div>

      <div className="stage">
        <LayersPanel
          layers={layers}
          selectedIds={selectedSet}
          dragging={dragging}
          onSelect={selectSingle}
          onRename={onRename}
          onToggleVisible={onToggleVisible}
          onToggleLocked={onToggleLocked}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onMove={onMove}
          onReorder={onReorder}
          onNewLayer={onNewLayer}
        />

        <div
          className="canvas-wrap"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) loadFile(f);
          }}
        >
          <Canvas
            layers={layers}
            selectedIds={selectedSet}
            boxes={boxes}
            handlePos={handlePos}
            viewport={viewport}
            dragging={dragging}
            scene={scene}
            onSelect={selectSingle}
            onMarqueeSelect={onMarqueeSelect}
            onCenterPointerDown={onCenterPointerDown}
            onWheel={onWheel}
            panBy={panBy}
          />
        </div>

        <aside className="sidebar">
          <Controls
            primary={primary}
            selectionCount={editableSelected.length}
            allSelected={allSelected}
            editable={editableForControls}
            primaryParamsRef={primaryParamsRef}
            applyParamDelta={scene.applyParamDelta}
            onCommitDelta={onCommitDelta}
            onCommitAbsolute={onCommitAbsolute}
            setDragging={setDragging}
            onToggleVisible={() => primaryId && onToggleVisible(primaryId)}
            onToggleLocked={() => primaryId && onToggleLocked(primaryId)}
          />
        </aside>
      </div>

      <div className="bottombar">
        <span>Zoom {Math.round(viewport.s * 100)}%</span>
        <span>{layers.length} layers · {visibleCount} visible</span>
        {selectedIds.length > 1 ? (
          <span>{selectedIds.length} selected ({editableSelected.length} editable)</span>
        ) : (
          primary && <span>Sel: {primary.name}</span>
        )}
        <span className="hint">drag empty canvas = marquee select · shift = add · ⌘A all · space/middle = pan</span>
      </div>
    </div>
  );
}
