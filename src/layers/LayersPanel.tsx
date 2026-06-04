// Flat layers panel (design re-skin). Renders the layer array REVERSED so the
// top row is the visual front. Groups are editor-level sets shown as folder
// rows with their members indented. Thumbnails preview each layer's repeat.
import { useRef, useState } from "react";
import { Icon } from "../ui/icons";
import { boundsReach, instanceOpacity, instanceTransform, paintOrder } from "../canvas/repeatMath";
import { renderPart } from "../motif/parts";
import type { Layer, LayerGroup, Motif, MotifPart } from "../types";

export type MoveDir = "front" | "forward" | "backward" | "back";

interface LayersPanelProps {
  layers: Layer[];
  groups: LayerGroup[];
  selectedIds: Set<string>;
  dragging: boolean;
  onSelect: (id: string, additive?: boolean) => void;
  onGroupSelection: () => void;
  onUngroupSelection: () => void;
  onUngroupGroup: (groupId: string) => void;
  canGroupSelection: boolean;
  canUngroupSelection: boolean;
  onRename: (id: string, name: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onTogglePart: (layerId: string, partId: string) => void;
  onSelectPart: (layerId: string, partId: string) => void;
  onReorderPart: (layerId: string, draggedId: string, targetId: string) => void;
  selectedPart: { layerId: string; partId: string | null } | null;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: MoveDir) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onNewLayer: () => void;
}

function LayerThumb({ layer }: { layer: Layer }) {
  const p = layer.params;
  const r = boundsReach(p, layer.motif.box) * layer.scale + 6;
  const id = `th-${layer.id}`;
  // Render the FULL ring so the preview is contiguous (no arc/gap at high counts).
  const indices = paintOrder(p.count, p.paintOffset);
  return (
    <div className="lr-thumb">
      <svg viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`}>
        <defs>
          <g
            id={id}
            transform={`translate(${-layer.motif.anchorX},${-layer.motif.anchorY})`}
            dangerouslySetInnerHTML={{ __html: layer.motif.innerHtml }}
          />
        </defs>
        <g transform={`scale(${layer.scale})`}>
          {indices.map((i) => (
            <use key={i} href={`#${id}`} transform={instanceTransform(p, i)} opacity={instanceOpacity(p, i)} />
          ))}
        </g>
      </svg>
    </div>
  );
}

/** Preview a single motif sub-part within the motif's bounding frame. */
function PartThumb({ motif, part }: { motif: Motif; part: MotifPart }) {
  const b = motif.box;
  const r = 0.5 * Math.hypot(b.width, b.height) + 4;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return (
    <div className={`lr-thumb part${part.visible ? "" : " is-hidden"}`}>
      <svg viewBox={`${cx - r} ${cy - r} ${2 * r} ${2 * r}`}>
        <g dangerouslySetInnerHTML={{ __html: renderPart(part) }} />
      </svg>
    </div>
  );
}

export function LayersPanel({
  layers,
  groups,
  selectedIds,
  dragging,
  onSelect,
  onGroupSelection,
  onUngroupSelection,
  onUngroupGroup,
  canGroupSelection,
  canUngroupSelection,
  onRename,
  onToggleVisible,
  onToggleLocked,
  onTogglePart,
  onSelectPart,
  onReorderPart,
  selectedPart,
  onDuplicate,
  onDelete,
  onMove,
  onReorder,
  onNewLayer,
}: LayersPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedParts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const [query, setQuery] = useState("");
  const draggedId = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const draggedPart = useRef<{ layerId: string; partId: string } | null>(null);
  const [overPartId, setOverPartId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const display = layers.slice().reverse();
  const groupByLayer = new Map<string, LayerGroup>();
  groups.forEach((g) => g.layerIds.forEach((id) => groupByLayer.set(id, g)));
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const emittedGroups = new Set<string>();
  const rows = display.flatMap((layer) => {
    const group = groupByLayer.get(layer.id);
    if (!group) return [{ kind: "layer" as const, layer, depth: 0 }];
    if (emittedGroups.has(group.id)) return [];
    emittedGroups.add(group.id);
    const members = group.layerIds
      .map((id) => layerById.get(id))
      .filter((l): l is Layer => !!l)
      .slice()
      .reverse();
    return [
      { kind: "group" as const, group, members },
      ...members.map((member) => ({ kind: "layer" as const, layer: member, depth: 1 })),
    ];
  });
  const visibleRows = rows.filter((entry) =>
    !q ? true : (entry.kind === "group" ? entry.group.name : entry.layer.name).toLowerCase().includes(q)
  );

  return (
    <aside className="layers-panel">
      <div className="panel-head">
        <span className="panel-title">Layers</span>
        <div className="panel-head-spacer" />
        <button className="iconbtn" onClick={onGroupSelection} disabled={!canGroupSelection} title="Group selection (⌘G)">
          {Icon.group({ size: 15 })}
        </button>
        <button className="iconbtn" onClick={onUngroupSelection} disabled={!canUngroupSelection} title="Ungroup (⌘⇧G)">
          {Icon.ungroup({ size: 15 })}
        </button>
        <button className="iconbtn" onClick={onNewLayer} title="New layer">
          {Icon.add({ size: 17 })}
        </button>
      </div>

      <div className="layer-search">
        {Icon.search()}
        <input placeholder="Search layers" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="layer-list scroll">
        {visibleRows.map((entry) => {
          if (entry.kind === "group") {
            const selected = entry.group.layerIds.every((id) => selectedIds.has(id));
            return (
              <div
                key={entry.group.id}
                className={`layer-row${selected ? " is-selected" : ""}`}
                onPointerDown={() => onSelect(entry.group.layerIds[0])}
              >
                <span className="lr-grip" />
                <span className="lr-disclosure">{Icon.chevron()}</span>
                <div className="lr-thumb group">{Icon.folder({ size: 15 })}</div>
                <div className="lr-body">
                  <span className="lr-name">{entry.group.name}</span>
                  <span className="lr-meta">group · {entry.members.length} item{entry.members.length === 1 ? "" : "s"}</span>
                </div>
                <div className="lr-actions">
                  <button className="lr-ico" title="Ungroup" onPointerDown={(e) => { e.stopPropagation(); onUngroupGroup(entry.group.id); }}>
                    {Icon.ungroup({ size: 15 })}
                  </button>
                </div>
              </div>
            );
          }

          const l = entry.layer;
          const selected = selectedIds.has(l.id);
          const anim = l.animation?.enabled;
          const parts = l.motif.parts ?? [];
          const hasParts = parts.length > 1;
          const expanded = expandedParts.has(l.id);
          return (
            <div key={l.id} style={{ position: "relative" }}>
              <div
                className={`layer-row${selected ? " is-selected" : ""}${overId === l.id ? " is-drop-target" : ""}`}
                style={{ paddingLeft: 4 + entry.depth * 16 }}
                draggable
                onPointerDown={(e) => onSelect(l.id, e.shiftKey || e.metaKey)}
                onDragStart={(e) => {
                  draggedId.current = l.id;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (l.id !== draggedId.current) setOverId(l.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedId.current && draggedId.current !== l.id) onReorder(draggedId.current, l.id);
                  draggedId.current = null;
                  setOverId(null);
                }}
                onDragEnd={() => { draggedId.current = null; setOverId(null); }}
              >
                <span className="lr-grip">{Icon.grip()}</span>
                <span
                  className={`lr-disclosure${hasParts ? " clickable" : ""}${expanded ? " open" : ""}`}
                  onPointerDown={hasParts ? (e) => { e.stopPropagation(); toggleExpanded(l.id); } : undefined}
                >
                  {hasParts ? Icon.chevron() : null}
                </span>
                <LayerThumb layer={l} />
                <div className="lr-body">
                  {editingId === l.id ? (
                    <span className="lr-name">
                      <input
                        autoFocus
                        defaultValue={l.name}
                        onPointerDown={(e) => e.stopPropagation()}
                        onBlur={(e) => { onRename(l.id, e.target.value.trim() || l.name); setEditingId(null); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                    </span>
                  ) : (
                    <span className="lr-name" onDoubleClick={(e) => { e.stopPropagation(); setEditingId(l.id); }}>
                      {l.name}
                    </span>
                  )}
                  <span className="lr-meta">{l.params.count}×{anim ? " · anim" : ""}</span>
                </div>
                <div className="lr-actions">
                  <span className="lr-reorder">
                    <button
                      className="lr-ico is-quiet lr-move up"
                      disabled={dragging}
                      onPointerDown={(e) => { e.stopPropagation(); onMove(l.id, "forward"); }}
                      title="Move up (toward front)"
                    >
                      {Icon.chevron({ size: 13 })}
                    </button>
                    <button
                      className="lr-ico is-quiet lr-move down"
                      disabled={dragging}
                      onPointerDown={(e) => { e.stopPropagation(); onMove(l.id, "backward"); }}
                      title="Move down (toward back)"
                    >
                      {Icon.chevron({ size: 13 })}
                    </button>
                  </span>
                  <button
                    className={`lr-ico is-quiet${l.locked ? " lock-on" : ""}`}
                    disabled={dragging}
                    onPointerDown={(e) => { e.stopPropagation(); onToggleLocked(l.id); }}
                    title={l.locked ? "Unlock" : "Lock"}
                  >
                    {l.locked ? Icon.lock() : Icon.unlock()}
                  </button>
                  <button
                    className={`lr-ico${l.visible ? " on" : " is-quiet"}`}
                    disabled={dragging}
                    onPointerDown={(e) => { e.stopPropagation(); onToggleVisible(l.id); }}
                    title={l.visible ? "Hide" : "Show"}
                  >
                    {l.visible ? Icon.eye() : Icon.eyeOff()}
                  </button>
                  <button className="lr-ico is-quiet" onPointerDown={(e) => { e.stopPropagation(); setMenuId(menuId === l.id ? null : l.id); }} title="More">
                    {Icon.dots()}
                  </button>
                </div>
              </div>
              {hasParts && expanded && parts.map((part) => {
                const partSelected = selectedPart?.layerId === l.id && selectedPart.partId === part.id;
                return (
                  <div
                    key={part.id}
                    className={`layer-row part-row${part.visible ? "" : " part-hidden"}${partSelected ? " is-selected" : ""}${overPartId === part.id ? " is-drop-target" : ""}`}
                    style={{ paddingLeft: 4 + (entry.depth + 1) * 16 }}
                    draggable
                    onPointerDown={(e) => { e.stopPropagation(); onSelectPart(l.id, part.id); }}
                    onDragStart={(e) => { draggedPart.current = { layerId: l.id, partId: part.id }; e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => {
                      const d = draggedPart.current;
                      if (d && d.layerId === l.id && d.partId !== part.id) { e.preventDefault(); setOverPartId(part.id); }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const d = draggedPart.current;
                      if (d && d.layerId === l.id && d.partId !== part.id) onReorderPart(l.id, d.partId, part.id);
                      draggedPart.current = null;
                      setOverPartId(null);
                    }}
                    onDragEnd={() => { draggedPart.current = null; setOverPartId(null); }}
                  >
                    <span className="lr-grip">{Icon.grip()}</span>
                    <span className="lr-disclosure" />
                    <PartThumb motif={l.motif} part={part} />
                    <div className="lr-body">
                      <span className="lr-name">{part.name}</span>
                    </div>
                    <div className="lr-actions">
                      <button
                        className={`lr-ico${part.visible ? " on" : " is-quiet"}`}
                        disabled={dragging}
                        onPointerDown={(e) => { e.stopPropagation(); onTogglePart(l.id, part.id); }}
                        title={part.visible ? "Hide part" : "Show part"}
                      >
                        {part.visible ? Icon.eye() : Icon.eyeOff()}
                      </button>
                    </div>
                  </div>
                );
              })}
              {menuId === l.id && (
                <div style={{ position: "absolute", right: 8, top: 36, zIndex: 50 }}>
                  <div className="menu right" onClick={(e) => e.stopPropagation()}>
                    <button className="menu-item" onPointerDown={() => { setEditingId(l.id); setMenuId(null); }}>{Icon.pen({ size: 15 })}<span>Rename</span></button>
                    <button className="menu-item" onPointerDown={() => { onDuplicate(l.id); setMenuId(null); }}>{Icon.duplicate({ size: 15 })}<span>Duplicate</span></button>
                    <div className="menu-sep" />
                    <button className="menu-item" onPointerDown={() => { onMove(l.id, "front"); setMenuId(null); }}><span>Move to Front</span></button>
                    <button className="menu-item" onPointerDown={() => { onMove(l.id, "forward"); setMenuId(null); }}><span>Move Forward</span></button>
                    <button className="menu-item" onPointerDown={() => { onMove(l.id, "backward"); setMenuId(null); }}><span>Move Backward</span></button>
                    <button className="menu-item" onPointerDown={() => { onMove(l.id, "back"); setMenuId(null); }}><span>Move to Back</span></button>
                    <div className="menu-sep" />
                    <button className="menu-item" onPointerDown={() => { onDelete(l.id); setMenuId(null); }}>{Icon.trash({ size: 15 })}<span>Delete</span></button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {visibleRows.length === 0 && <div className="empty-note">{q ? `No layers match “${query}”.` : "No layers."}</div>}
      </div>
    </aside>
  );
}
