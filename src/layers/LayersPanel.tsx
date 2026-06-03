// Flat layers panel. Renders the layer array REVERSED so the top row is the
// visual front (array end). Groups are editor-level sets, shown as compact
// badges without changing the flat render order.
import { useRef, useState } from "react";
import type { Layer, LayerGroup } from "../types";

export type MoveDir = "front" | "forward" | "backward" | "back";

interface LayersPanelProps {
  layers: Layer[];
  groups: LayerGroup[];
  selectedIds: Set<string>;
  /** Toggles are disabled mid-drag so visibility can't change during a gesture. PRD §17. */
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
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, dir: MoveDir) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onNewLayer: () => void;
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
  onDuplicate,
  onDelete,
  onMove,
  onReorder,
  onNewLayer,
}: LayersPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const draggedId = useRef<string | null>(null);

  // Top row = front = end of the internal array.
  const display = layers.slice().reverse();
  const groupByLayer = new Map<string, LayerGroup>();
  groups.forEach((g) => g.layerIds.forEach((id) => groupByLayer.set(id, g)));
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const emittedGroups = new Set<string>();
  const groupedDisplay = display.flatMap((layer) => {
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

  return (
    <div className="layers-panel">
      <div className="layers-head">
        <span className="layers-title">Layers</span>
        <div className="layers-head-actions">
          <button className="mini" onClick={onGroupSelection} disabled={!canGroupSelection} title="Group selected layers (⌘G)">
            Group
          </button>
          <button className="mini" onClick={onUngroupSelection} disabled={!canUngroupSelection} title="Ungroup selected layers (⌘⇧G)">
            Ungroup
          </button>
          <button className="mini" onClick={onNewLayer} title="New layer">
            + New
          </button>
        </div>
      </div>

      {display.length === 0 && (
        <div className="layers-empty">
          No layers.
          <button className="mini" onClick={onNewLayer}>
            + New Layer
          </button>
        </div>
      )}

      <ul className="layers-list">
        {groupedDisplay.map((entry) => {
          if (entry.kind === "group") {
            const selected = entry.group.layerIds.every((id) => selectedIds.has(id));
            return (
              <li
                key={entry.group.id}
                className={`group-row${selected ? " selected" : ""}`}
                onClick={(e) => onSelect(entry.group.layerIds[0], e.shiftKey || e.metaKey)}
              >
                <span className="group-disclosure">▾</span>
                <span className="group-icon">G</span>
                <span className="layer-name" title={entry.group.name}>
                  {entry.group.name}
                </span>
                <span className="group-count">{entry.members.length}</span>
                <button
                  className="mini"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUngroupGroup(entry.group.id);
                  }}
                  title="Ungroup"
                >
                  Ungroup
                </button>
              </li>
            );
          }

          const l = entry.layer;
          const selected = selectedIds.has(l.id);
          const group = groupByLayer.get(l.id);
          return (
            <li
              key={l.id}
              className={`layer-row${entry.depth ? " child-row" : ""}${selected ? " selected" : ""}`}
              draggable
              onDragStart={(e) => {
                draggedId.current = l.id;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (draggedId.current) onReorder(draggedId.current, l.id);
                draggedId.current = null;
              }}
              onClick={(e) => onSelect(l.id, e.shiftKey || e.metaKey)}
            >
              <span className="drag-handle" title="Drag to reorder">
                ⠿
              </span>
              <button
                className="mini"
                disabled={dragging}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisible(l.id);
                }}
                title={l.visible ? "Hide" : "Show"}
              >
                {l.visible ? "👁" : "🙈"}
              </button>
              <button
                className="mini"
                disabled={dragging}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLocked(l.id);
                }}
                title={l.locked ? "Unlock" : "Lock"}
              >
                {l.locked ? "🔒" : "🔓"}
              </button>

              {editingId === l.id ? (
                <input
                  className="layer-name-input"
                  autoFocus
                  defaultValue={l.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    onRename(l.id, e.target.value.trim() || l.name);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span
                  className="layer-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(l.id);
                  }}
                >
                  {l.name}
                </span>
              )}
              {group && entry.depth === 0 && (
                <span className="layer-group-badge" title={group.name}>
                  G
                </span>
              )}

              <div className="layer-menu-wrap">
                <button
                  className="mini"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuId(menuId === l.id ? null : l.id);
                  }}
                  title="More"
                >
                  ⋮
                </button>
                {menuId === l.id && (
                  <div className="layer-menu" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { setEditingId(l.id); setMenuId(null); }}>Rename</button>
                    <button onClick={() => { onDuplicate(l.id); setMenuId(null); }}>Duplicate</button>
                    <button onClick={() => { onMove(l.id, "front"); setMenuId(null); }}>Move to Front</button>
                    <button onClick={() => { onMove(l.id, "forward"); setMenuId(null); }}>Move Forward</button>
                    <button onClick={() => { onMove(l.id, "backward"); setMenuId(null); }}>Move Backward</button>
                    <button onClick={() => { onMove(l.id, "back"); setMenuId(null); }}>Move to Back</button>
                    <button className="danger" onClick={() => { onDelete(l.id); setMenuId(null); }}>Delete</button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
