// Bundled motif so the app does something on first load with zero input. PRD §1.
// An asymmetric petal whose "interesting" axis is local +x, so the orientation
// modes read clearly (with rotateWithCircle every petal points outward).
export const DEFAULT_MOTIF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">
  <path d="M8 40 C 40 4, 88 4, 112 40 C 88 76, 40 76, 8 40 Z"
        fill="#7c93ff" stroke="#243a8f" stroke-width="3" stroke-linejoin="round"/>
  <path d="M8 40 C 40 22, 84 22, 112 40 C 84 58, 40 58, 8 40 Z"
        fill="#aebcff" opacity="0.7"/>
  <line x1="18" y1="40" x2="98" y2="40" stroke="#243a8f" stroke-width="2"/>
  <circle cx="98" cy="40" r="7" fill="#ffd166" stroke="#243a8f" stroke-width="2"/>
  <circle cx="34" cy="40" r="3.5" fill="#243a8f"/>
</svg>`;
