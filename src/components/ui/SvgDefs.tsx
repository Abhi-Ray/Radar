/**
 * Shared SVG filters, rendered once in the root layout. `ink-rough` (globals.css) references
 * #radar-ink-rough to roughen stamp edges like a rubber stamp on paper.
 * Positioned off-screen with zero size (display:none would disable the filter in some engines).
 */
export function SvgDefs() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="pointer-events-none absolute size-0 overflow-hidden">
      <defs>
        <filter id="radar-ink-rough" x="-5%" y="-10%" width="110%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
