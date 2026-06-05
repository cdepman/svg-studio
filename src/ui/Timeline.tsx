// Animate-mode dock: transport + ruler + one lane per animated layer.
// Playback itself is CSS-driven; the playhead/time here is a synced visual clock.
import { useRef } from "react";
import { Icon } from "./icons";
import { anyEffectEnabled } from "../motion/effects";
import type { Layer } from "../types";

interface TimelineProps {
  layers: Layer[];
  total: number;
  playTime: number;
  playing: boolean;
  /** Which composites are currently playing (each plays independently). */
  playingIds: Set<string>;
  loop: boolean;
  collapsed: boolean;
  selectedId: string | null;
  onTogglePlay: () => void;
  onToggleLayerPlay: (id: string) => void;
  onToStart: () => void;
  onToggleLoop: () => void;
  onToggleCollapse: () => void;
  onScrub: (t: number) => void;
  onSelect: (id: string) => void;
}

const fmt = (s: number) => (Math.round(s * 10) / 10).toFixed(1) + "s";

export function Timeline({
  layers, total, playTime, playing, playingIds, loop, collapsed, selectedId,
  onTogglePlay, onToggleLayerPlay, onToStart, onToggleLoop, onToggleCollapse, onScrub, onSelect,
}: TimelineProps) {
  const lanesRef = useRef<HTMLDivElement>(null);
  const T = Math.max(total, 1);
  const animated = layers.filter((l) => l.animation?.enabled || anyEffectEnabled(l.effects));

  const timeFromEvent = (clientX: number) => {
    const r = lanesRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * T;
  };
  const startScrub = (e: React.PointerEvent) => {
    onScrub(timeFromEvent(e.clientX));
    const move = (ev: PointerEvent) => onScrub(timeFromEvent(ev.clientX));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const step = T > 8 ? 2 : 1;
  const ticks: number[] = [];
  for (let t = 0; t <= T + 0.001; t += step) ticks.push(Math.round(t));

  return (
    <div className={`timeline${collapsed ? " is-collapsed" : ""}`}>
      <div className="tl-bar">
        <button className={`tl-collapse${collapsed ? " is-collapsed" : ""}`} onClick={onToggleCollapse} title={collapsed ? "Expand timeline" : "Collapse timeline"}>
          {Icon.chevron()}
        </button>
        <div className="tl-transport">
          <button onClick={onToStart} title="Back to start">{Icon.toStart()}</button>
          <button className="tl-play" onClick={onTogglePlay} title="Play / pause">{playing ? Icon.pause() : Icon.play()}</button>
        </div>
        <div className="tl-time">{fmt(playTime)} <span className="tl-total">/ {fmt(T)}</span></div>
        <div className="tl-bar-spacer" />
        <button className={`tl-loopbtn${loop ? " on" : ""}`} onClick={onToggleLoop}>{Icon.loop()} Loop</button>
      </div>

      {!collapsed && (
      <div className="tl-body">
        <div className="tl-tracks-head scroll">
          <div className="tl-ruler-cell">tracks</div>
          {animated.length === 0
            ? <div className="tl-track-label" style={{ color: "var(--faint)" }}>no animated layers</div>
            : animated.map((l) => (
                <div key={l.id} className={`tl-track-label${l.id === selectedId ? " is-selected" : ""}`} onPointerDown={() => onSelect(l.id)}>
                  <button
                    className={`tl-lane-play${playingIds.has(l.id) ? " is-playing" : ""}`}
                    onPointerDown={(e) => { e.stopPropagation(); }}
                    onClick={(e) => { e.stopPropagation(); onToggleLayerPlay(l.id); }}
                    title={playingIds.has(l.id) ? `Pause ${l.name}` : `Play ${l.name}`}
                  >
                    {playingIds.has(l.id) ? Icon.pause() : Icon.play()}
                  </button>
                  <span className="tl-swatch" style={{ background: "var(--teal)" }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                </div>
              ))}
        </div>

        <div className="tl-lanes" ref={lanesRef}>
          <div className="tl-ruler">
            {ticks.map((t, i) => (
              <div key={i} className="tl-tick" style={{ left: `${(t / T) * 100}%` }}><span>{t}s</span></div>
            ))}
          </div>
          {animated.map((l) => {
            const a = l.animation?.enabled ? l.animation : null;
            const dimmed = !playingIds.has(l.id);
            if (!a) {
              // Effects-only composite: a continuous looping band (no center-path clip).
              return (
                <div key={l.id} className={`tl-lane${l.id === selectedId ? " is-selected" : ""}`} onPointerDown={() => onSelect(l.id)}>
                  <div className={`tl-clip effects${dimmed ? " is-paused" : ""}`} style={{ left: 0, width: "100%" }} title={l.name}>
                    <span>effects</span>
                  </div>
                </div>
              );
            }
            const delayPct = (a.delaySeconds / T) * 100;
            const durPct = (a.durationSeconds / T) * 100;
            return (
              <div key={l.id} className={`tl-lane${l.id === selectedId ? " is-selected" : ""}`} onPointerDown={() => onSelect(l.id)}>
                {a.delaySeconds > 0 && <div className="tl-clip delay" style={{ left: 0, width: `${delayPct}%` }} />}
                <div className={`tl-clip${dimmed ? " is-paused" : ""}`} style={{ left: `${delayPct}%`, width: `${durPct}%` }} title={l.name}>
                  <span>{a.direction}</span>
                  <div className="tl-key" style={{ left: 5 }} />
                  <div className="tl-key" style={{ left: "calc(100% - 5px)" }} />
                </div>
              </div>
            );
          })}
          <div className="tl-scrub" onPointerDown={startScrub} />
          <div className="tl-playhead" style={{ left: `${(playTime / T) * 100}%` }} />
        </div>
      </div>
      )}
    </div>
  );
}
