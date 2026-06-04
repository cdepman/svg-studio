// Inline SVG icon set (ported from the design system). Each icon is a component
// taking optional size/className; strokes use currentColor so CSS controls color.
import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

function svg(children: React.ReactNode, { size = 18, className, style }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const fill = { fill: "currentColor", stroke: "none" } as const;

export const Icon = {
  undo: (p: IconProps = {}) => svg(<path d="M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-1" />, p),
  redo: (p: IconProps = {}) => svg(<path d="M15 7l5 5-5 5M20 12H9a5 5 0 000 10h1" />, p),
  play: (p: IconProps = {}) => svg(<path d="M7 5l12 7-12 7z" {...fill} />, p),
  pause: (p: IconProps = {}) => svg(<><rect x={7} y={5} width={4} height={14} rx={1} {...fill} /><rect x={13} y={5} width={4} height={14} rx={1} {...fill} /></>, p),
  toStart: (p: IconProps = {}) => svg(<><path d="M7 5v14" /><path d="M19 5l-9 7 9 7z" /></>, p),
  loop: (p: IconProps = {}) => svg(<path d="M17 2l3 3-3 3M7 22l-3-3 3-3M20 5H9a5 5 0 00-5 5M4 19h11a5 5 0 005-5" />, p),
  add: (p: IconProps = {}) => svg(<><path d="M12 5v14" /><path d="M5 12h14" /></>, p),
  folder: (p: IconProps = {}) => svg(<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />, p),
  eye: (p: IconProps = {}) => svg(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx={12} cy={12} r={3} /></>, p),
  eyeOff: (p: IconProps = {}) => svg(<><path d="M4 4l16 16" /><path d="M9.5 5.4A9.7 9.7 0 0112 5c6 0 10 7 10 7a17 17 0 01-3 3.6M6 7.5A17 17 0 002 12s4 7 10 7a9.5 9.5 0 003.5-.7" /></>, p),
  lock: (p: IconProps = {}) => svg(<><rect x={5} y={11} width={14} height={9} rx={2} /><path d="M8 11V8a4 4 0 018 0v3" /></>, p),
  unlock: (p: IconProps = {}) => svg(<><rect x={5} y={11} width={14} height={9} rx={2} /><path d="M8 11V8a4 4 0 017-2.5" /></>, p),
  chevron: (p: IconProps = {}) => svg(<path d="M6 9l6 6 6-6" />, p),
  grip: (p: IconProps = {}) => svg(<>{[7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.4} {...fill} />))}</>, p),
  dots: (p: IconProps = {}) => svg(<>{[5, 12, 19].map((x) => <circle key={x} cx={x} cy={12} r={1.5} {...fill} />)}</>, p),
  search: (p: IconProps = {}) => svg(<><circle cx={11} cy={11} r={7} /><path d="M20 20l-4-4" /></>, p),
  duplicate: (p: IconProps = {}) => svg(<><rect x={8} y={8} width={12} height={12} rx={2} /><path d="M4 16V6a2 2 0 012-2h10" /></>, p),
  trash: (p: IconProps = {}) => svg(<><path d="M4 7h16" /><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" /><path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13" /></>, p),
  download: (p: IconProps = {}) => svg(<><path d="M12 4v11" /><path d="M8 11l4 4 4-4" /><path d="M5 20h14" /></>, p),
  upload: (p: IconProps = {}) => svg(<><path d="M12 20V9" /><path d="M8 13l4-4 4 4" /><path d="M5 4h14" /></>, p),
  plus: (p: IconProps = {}) => svg(<><path d="M12 5v14" /><path d="M5 12h14" /></>, p),
  minus: (p: IconProps = {}) => svg(<path d="M5 12h14" />, p),
  target: (p: IconProps = {}) => svg(<><circle cx={12} cy={12} r={8} /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>, p),
  pen: (p: IconProps = {}) => svg(<path d="M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" />, p),
  sparkle: (p: IconProps = {}) => svg(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />, p),
  file: (p: IconProps = {}) => svg(<><path d="M6 3h8l4 4v14a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M14 3v4h4" /></>, p),
  group: (p: IconProps = {}) => svg(<><rect x={4} y={4} width={7} height={7} rx={1} /><rect x={13} y={13} width={7} height={7} rx={1} /></>, p),
  ungroup: (p: IconProps = {}) => svg(<><rect x={3} y={3} width={6} height={6} rx={1} /><rect x={15} y={3} width={6} height={6} rx={1} /><rect x={9} y={15} width={6} height={6} rx={1} /></>, p),
  reset: (p: IconProps = {}) => svg(<path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7L4 9M4 4v4h4" />, p),
  cursor: (p: IconProps = {}) => svg(<path d="M5 3l6 16 2.2-6.2L19 11z" fill="currentColor" stroke="currentColor" strokeWidth={1.2} />, p),
  eyedropper: (p: IconProps = {}) =>
    svg(
      <>
        <path d="m2 22 1-1h3l9-9" />
        <path d="M3 21v-3l9-9" />
        <path d="m15 6 3.4-3.4a2.1 2.1 0 0 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
      </>,
      p
    ),
};
