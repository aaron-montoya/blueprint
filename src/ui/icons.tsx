/** Inline SVG icons. They take the surrounding text color. */

/** Optimize wires: two pins joined by a tidy right-angle wire. */
export function OptimizeIcon() {
  return (
    <svg
      className="icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="2" width="4" height="4" rx="0.5" />
      <rect x="11" y="10" width="4" height="4" rx="0.5" />
      <path d="M5 4h3.5v8H11" />
    </svg>
  );
}
