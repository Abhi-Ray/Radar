import { ImageResponse } from "next/og";

/* Home-screen icon (iOS): the same scope as icon.svg, drawn at 180×180 with an acid "D" lock. */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#111111",
        }}
      >
        <svg width="150" height="150" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r="13" fill="none" stroke="#1fd18b" strokeWidth="1.6" />
          <circle cx="16" cy="16" r="8.5" fill="none" stroke="#1fd18b" strokeWidth="0.9" strokeOpacity="0.55" />
          <circle cx="16" cy="16" r="4" fill="none" stroke="#1fd18b" strokeWidth="0.9" strokeOpacity="0.55" />
          <path d="M16 16 L16 3 A13 13 0 0 1 27.26 9.5 Z" fill="#1fd18b" fillOpacity="0.32" />
          <path d="M16 16 L27.26 9.5" stroke="#1fd18b" strokeWidth="1.6" strokeLinecap="square" />
          <rect x="19.5" y="18.5" width="4.5" height="4.5" fill="#ffe14d" stroke="#111111" strokeWidth="0.8" />
          <rect x="8" y="9" width="3" height="3" fill="#ff6b1a" stroke="#111111" strokeWidth="0.6" />
          <rect x="14.75" y="14.75" width="2.5" height="2.5" fill="#1fd18b" />
        </svg>
      </div>
    ),
    size,
  );
}
