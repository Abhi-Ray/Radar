import type { ReactNode, SVGProps } from "react";
import { cn } from "./cn";

/*
 * RADAR icon set — hand-drawn on a 24×24 grid. Chunky 2.5 stroke, square caps, mitred joins,
 * no rounded corners. Dots are real squares so they survive at 16px.
 */

const dot = (x: number, y: number, s = 3) => <rect x={x - s / 2} y={y - s / 2} width={s} height={s} fill="currentColor" stroke="none" />;

const ICONS = {
  desk: (
    <>
      <path d="M3 4h18v11H3z" />
      <path d="M8 20h8M12 15v5" />
      <path d="M6.5 11.5l3-3 2.5 2 4.5-4.5" />
    </>
  ),
  jobs: (
    <>
      <path d="M3 8h18v12H3z" />
      <path d="M8.5 8V4.5h7V8" />
      <path d="M3 13.5h18" />
      <path d="M10.5 12v3h3v-3" />
    </>
  ),
  tracker: (
    <>
      <path d="M5 4.5h14V21H5z" />
      <path d="M9 2.5h6v4H9z" />
      <path d="M8.5 12l2.5 2.5 4.5-4.5M8.5 17.5h7" />
    </>
  ),
  companies: (
    <>
      <path d="M4 21V3.5h10V21" />
      <path d="M14 9h6v12" />
      <path d="M2 21h20" />
      <path d="M7.5 7.5h3M7.5 11.5h3M7.5 15.5h3" />
      {dot(17, 13, 2.5)}
      {dot(17, 17, 2.5)}
    </>
  ),
  countries: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z" />
      <path d="M3.5 9h17M3.5 15h17" />
      <path d="M12 3c-3.2 3.4-3.2 14.6 0 18M12 3c3.2 3.4 3.2 14.6 0 18" />
    </>
  ),
  kit: (
    <>
      {/* Application kit: a CV on top of a second document. */}
      <path d="M8.5 6V2.5H20v14.5h-4" />
      <path d="M4 6h12v15.5H4z" />
      <path d="M7.5 11h5M7.5 14.5h5M7.5 18h3" />
    </>
  ),
  review: (
    <>
      <path d="M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z" />
      <path d="M15.5 15.5L21 21" />
      <path d="M8.5 9a2 2 0 1 1 3 1.8c-.8.4-1 .9-1 1.7" />
      {dot(10.5, 14.6, 2.4)}
    </>
  ),
  sources: (
    <>
      <path d="M12 12.5V21M8.5 21h7" />
      <path d="M8.6 6.6a4.8 4.8 0 0 0 0 6.8M15.4 6.6a4.8 4.8 0 0 1 0 6.8" />
      <path d="M5.4 3.6a9 9 0 0 0 0 12.8M18.6 3.6a9 9 0 0 1 0 12.8" />
      {dot(12, 10, 3.4)}
    </>
  ),
  accuracy: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17z" />
      <path d="M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z" />
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
      {dot(12, 12, 2.6)}
    </>
  ),
  system: (
    <>
      <path d="M2 12.5h4.5l2-6 4 12 2.5-8 1.5 2H22" />
    </>
  ),
  settings: (
    <>
      <path d="M3 6h9M17 6h4M3 12h3M11 12h10M3 18h11M19 18h2" />
      <path d="M12 3.5h5v5h-5zM6 9.5h5v5H6zM14 15.5h5v5h-5z" />
    </>
  ),
  more: (
    <>
      <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h12" />,
  close: <path d="M5 5l14 14M19 5L5 19" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  plus: <path d="M12 4v16M4 12h16" />,
  minus: <path d="M4 12h16" />,
  "arrow-right": <path d="M3.5 12h16M13.5 6l6 6-6 6" />,
  "arrow-left": <path d="M20.5 12h-16M10.5 6l-6 6 6 6" />,
  "arrow-up": <path d="M12 20.5v-16M6 10.5l6-6 6 6" />,
  "arrow-down": <path d="M12 3.5v16M6 13.5l6 6 6-6" />,
  external: (
    <>
      <path d="M8 16L19 5" />
      <path d="M10 5h9v9" />
      <path d="M17 17.5V20H4V7h2.5" />
    </>
  ),
  "chevron-down": <path d="M5.5 9l6.5 6.5L18.5 9" />,
  "chevron-up": <path d="M5.5 15l6.5-6.5 6.5 6.5" />,
  "chevron-left": <path d="M15 5.5L8.5 12l6.5 6.5" />,
  "chevron-right": <path d="M9 5.5l6.5 6.5L9 18.5" />,
  sort: <path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4" />,
  search: (
    <>
      <path d="M10.5 3.5a7 7 0 1 0 0 14a7 7 0 1 0 0-14z" />
      <path d="M15.5 15.5L21 21" />
    </>
  ),
  filter: <path d="M3 4.5h18l-7 8.5v6l-4 2v-8z" />,
  calendar: (
    <>
      <path d="M3.5 5.5h17v15h-17z" />
      <path d="M3.5 10h17M8 2.5v5M16 2.5v5" />
      {dot(8, 14.5, 2.6)}
      {dot(12, 14.5, 2.6)}
    </>
  ),
  clock: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z" />
      <path d="M12 7v5.5l3.5 2" />
    </>
  ),
  history: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M3.5 3.5v5h5" />
      <path d="M12 8v4.5l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 2.5L1.8 20.5h20.4z" />
      <path d="M12 9v5" />
      {dot(12, 17.2, 2.8)}
    </>
  ),
  info: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z" />
      <path d="M12 11v6M10 11h2" />
      {dot(12, 7.6, 2.8)}
    </>
  ),
  ai: (
    <>
      <path d="M7 7h10v10H7z" />
      <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
      <path d="M10.2 10.2h3.6v3.6h-3.6z" fill="currentColor" />
    </>
  ),
  bolt: <path d="M13.5 2L5 13.5h6L10 22l9-12h-6.5z" />,
  eye: (
    <>
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" />
      <path d="M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.3C10.6 5.1 11.3 5 12 5c6.5 0 10.5 7 10.5 7s-1 1.8-2.8 3.6M6.4 6.9C3.4 8.8 1.5 12 1.5 12s4 7 10.5 7c1.7 0 3.2-.5 4.5-1.2" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  bookmark: <path d="M6 3h12v18l-6-5-6 5z" />,
  "bookmark-filled": <path d="M6 3h12v18l-6-5-6 5z" fill="currentColor" />,
  trash: (
    <>
      <path d="M3.5 6h17M9 6V3h6v3" />
      <path d="M5.5 6l1.2 15h10.6L18.5 6" />
      <path d="M10 10v7M14 10v7" />
    </>
  ),
  edit: (
    <>
      <path d="M15 4l5 5L9 20H4v-5z" />
      <path d="M12.5 6.5l5 5" />
    </>
  ),
  link: (
    <>
      <path d="M10 14l4-4" />
      <path d="M8.5 11L6 13.5a3.5 3.5 0 0 0 5 5l2.5-2.5" />
      <path d="M15.5 13L18 10.5a3.5 3.5 0 0 0-5-5L10.5 8" />
    </>
  ),
  "link-broken": (
    <>
      <path d="M8.5 11L6 13.5a3.5 3.5 0 0 0 5 5l2.5-2.5" />
      <path d="M15.5 13L18 10.5a3.5 3.5 0 0 0-5-5L10.5 8" />
      <path d="M3 3l3 3M21 21l-3-3M9 2v3M22 15h-3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9" />
      <path d="M18.5 2.5v5h-5M5.5 21.5v-5h5" />
    </>
  ),
  download: <path d="M12 3v12M6.5 9.5L12 15l5.5-5.5M3.5 20.5h17" />,
  upload: <path d="M12 16V4M6.5 9.5L12 4l5.5 5.5M3.5 20.5h17" />,
  logout: (
    <>
      <path d="M14 4H4v16h10" />
      <path d="M10 12h11M17 8l4 4-4 4" />
    </>
  ),
  lock: (
    <>
      <path d="M4.5 10.5h15v10h-15z" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
      <path d="M12 14v3" />
    </>
  ),
  user: (
    <>
      <path d="M12 3.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z" />
      <path d="M3.5 21c.8-4 4.2-6 8.5-6s7.7 2 8.5 6" />
    </>
  ),
  stamp: (
    <>
      <path d="M9.5 3h5v5l-.5 4h-4l-.5-4z" />
      <path d="M4 12h16v4.5H4z" />
      <path d="M3 20.5h18" />
    </>
  ),
  passport: (
    <>
      <path d="M5 2.5h14v19H5z" />
      <path d="M12 6.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z" />
      <path d="M8.5 10h7M9 17.5h6" />
    </>
  ),
  radar: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z" />
      <path d="M12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9z" />
      <path d="M12 12L18 5.5" />
      {dot(16, 15, 3)}
    </>
  ),
  pin: (
    <>
      <path d="M12 22s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" />
      <path d="M10 8h4v4h-4z" />
    </>
  ),
  euro: (
    <>
      <path d="M18 5.5A7.5 7.5 0 0 0 7 12a7.5 7.5 0 0 0 11 6.5" />
      <path d="M3.5 10h10M3.5 14h9" />
    </>
  ),
  language: (
    <>
      <path d="M3 4h13v10H9l-4 3.5V14H3z" />
      <path d="M13 17.5h3.5L20 21v-3.5h1.5V9H19" />
      <path d="M6.5 11.5l3-6 3 6M7.6 9.5h3.8" />
    </>
  ),
  remote: (
    <>
      <path d="M4 5h16v10.5H4z" />
      <path d="M1.5 19.5h21" />
      <path d="M9 11a4.2 4.2 0 0 1 6 0" />
      {dot(12, 13, 2.6)}
    </>
  ),
  ghost: (
    <>
      <path d="M5 21V10a7 7 0 0 1 14 0v11l-2.3-2-2.3 2-2.4-2-2.4 2-2.3-2z" />
      {dot(9.5, 10.5, 2.6)}
      {dot(14.5, 10.5, 2.6)}
    </>
  ),
  copy: (
    <>
      <path d="M8 8h12v12H8z" />
      <path d="M16 4H4v12" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21.5V3" />
      <path d="M5 4h13l-3 4.5 3 4.5H5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.5l8 3v6c0 5.2-3.5 8.6-8 10-4.5-1.4-8-4.8-8-10v-6z" />
      <path d="M8.5 12l2.5 2.5 4.5-4.5" />
    </>
  ),
  database: (
    <>
      <path d="M4 5.5C4 3.8 7.6 2.5 12 2.5s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z" />
      <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  play: <path d="M7 4v16l13-8z" />,
  pause: <path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" />,
  mail: (
    <>
      <path d="M3 5.5h18v13H3z" />
      <path d="M3 6l9 7 9-7" />
    </>
  ),
  merge: (
    <>
      <path d="M6 3v5.5c0 3 6 4 6 7.5v5M18 3v5.5c0 3-6 4-6 7.5" />
      <path d="M8.5 18.5L12 22l3.5-3.5" />
    </>
  ),
  split: (
    <>
      <path d="M12 21.5V14c0-3-6-4-6-7.5V3M12 14c0-3 6-4 6-7.5V3" />
      <path d="M3.5 5.5L6 3l2.5 2.5M15.5 5.5L18 3l2.5 2.5" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 2.5h14v19l-2.3-1.6-2.4 1.6-2.3-1.6-2.3 1.6-2.4-1.6L5 21.5z" />
      <path d="M8.5 7.5h7M8.5 11.5h7M8.5 15.5h4" />
    </>
  ),
  dot: dot(12, 12, 6),
  quote: (
    <>
      <path d="M4 6h6v6l-3 6H4.5l2-6H4zM14 6h6v6l-3 6h-2.5l2-6H14z" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name" | "children"> {
  name: IconName;
  /** Pixel size (width = height). Default 20. */
  size?: number;
  /** Accessible label. Without it the icon is decorative (aria-hidden). */
  title?: string;
  strokeWidth?: number;
}

export function Icon({ name, size = 20, title, strokeWidth = 2.5, className, ...rest }: IconProps) {
  const labelled = Boolean(title);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeMiterlimit={10}
      className={cn("shrink-0", className)}
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
      focusable="false"
      {...rest}
    >
      {labelled ? <title>{title}</title> : null}
      {ICONS[name]}
    </svg>
  );
}
