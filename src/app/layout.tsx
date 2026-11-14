import type { Metadata } from "next";
import "./globals.css";

const FAVICON_SVG =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='grad' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' style='stop-color:%23009688;stop-opacity:1' /><stop offset='100%' style='stop-color:%2300BCD4;stop-opacity:1' /></linearGradient></defs><circle cx='50' cy='50' r='45' fill='url(%23grad)' stroke='%23FFF' stroke-width='2'/><rect x='32' y='30' width='10' height='40' rx='2' fill='white' opacity='0.9'/><rect x='47' y='20' width='10' height='60' rx='2' fill='white' opacity='0.9'/><rect x='62' y='35' width='10' height='30' rx='2' fill='white' opacity='0.9'/><path d='M77 35 Q90 50 77 65' stroke='white' stroke-width='3' fill='none' stroke-linecap='round'/><path d='M82 25 Q100 50 82 75' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' opacity='0.7'/></svg>";

export const metadata: Metadata = {
  title: "Neural Readalong — Kokoro-82M & Paradee-8M v1.3",
  description:
    "100% client-side WebGPU/WASM neural text-to-speech studio supporting timestamped Kokoro-82M v1.0 and multilingual Paradee-8M v1.3 with exact word-break highlighting",
  icons: {
    icon: FAVICON_SVG,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
