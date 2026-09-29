import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { connection } from "next/server";
import { SvgDefs } from "@/components/ui/SvgDefs";
import "./globals.css";

/*
 * `subsets` only controls what is preloaded: every unicode-range face (latin-ext for "Łódź",
 * "Ørsted"…) is still declared and fetched on demand, so preloading latin-ext would just warn
 * "preloaded but not used" on pages without such characters.
 */

/* Display + body face. Variable weight and the width axis power `wide`/`wider`/`narrow`. */
const archivo = Archivo({
  subsets: ["latin"],
  weight: "variable",
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

/* Receipts, codes, timestamps, numbers. */
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s · RADAR",
    default: "RADAR — Field Station",
  },
  description: "Private field station for a job hunt: visa-aware job radar, tracker and evidence receipts.",
  applicationName: "RADAR",
  referrer: "strict-origin-when-cross-origin",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, title: "RADAR", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#111111",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Per-request render so Next can stamp the proxy's CSP nonce (x-nonce) onto its scripts.
  // Static prerendering would bake nonce-less <script> tags that the CSP then blocks.
  await connection();

  return (
    <html lang="en" className={`${archivo.variable} ${jetbrains.variable}`}>
      <body>
        <SvgDefs />
        {children}
      </body>
    </html>
  );
}
