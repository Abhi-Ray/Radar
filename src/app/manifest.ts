import type { MetadataRoute } from "next";

/* Installable, standalone, login-walled. Icons point at the metadata-file routes (icon.svg, apple-icon). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RADAR — Field Station",
    short_name: "RADAR",
    description: "Private job-hunt field station: visa-aware job radar, tracker and evidence receipts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f3eee3",
    theme_color: "#111111",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
