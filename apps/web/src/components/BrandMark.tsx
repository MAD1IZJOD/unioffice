/**
 * The UNIOFFICE mark: three planes stacked in depth.
 *
 * The company as layers - the people and rules at the bottom, the workforce
 * in the middle, the work in flight on top - drawn as an isometric stack so
 * the mark has the same sense of depth as the surfaces it sits above. The top
 * plane carries the system's blue; the ones beneath recede into the rail.
 *
 * Coloured from the design tokens, so it follows them, and marked decorative:
 * the word next to it is the name.
 */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 18.5v2.5l11 5.5 11-5.5v-2.5" className="brand-mark-edge" />
      <path d="M16 24 5 18.5 16 13l11 5.5z" className="brand-mark-plane brand-mark-plane-3" />
      <path d="M16 20 5 14.5 16 9l11 5.5z" className="brand-mark-plane brand-mark-plane-2" />
      <path d="M16 16 5 10.5 16 5l11 5.5z" className="brand-mark-plane brand-mark-plane-1" />
    </svg>
  );
}
