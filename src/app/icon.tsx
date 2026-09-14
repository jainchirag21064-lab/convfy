import { ImageResponse } from "next/og";

// Replaces the default Next.js favicon with the CONVfy brand mark —
// WhatsApp-green chat bubble with three typing dots — matching the
// sidebar logo in `src/components/layout/sidebar.tsx` and the
// marketing site. Next.js renders this at build time and auto-injects
// <link rel="icon"> into <head>.
//
// This route takes precedence over src/app/favicon.ico, which is the
// Next.js default and can stay on disk harmlessly (or be removed).

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M6 4.5A4.5 4.5 0 0 0 1.5 9v10a4.5 4.5 0 0 0 4.5 4.5H8v5.5l5.1-5.5H26a4.5 4.5 0 0 0 4.5-4.5V9A4.5 4.5 0 0 0 26 4.5H6Z"
          fill="#25D366"
        />
        <circle cx="10.8" cy="14.4" r="2.7" fill="#ffffff" />
        <circle cx="16" cy="14.4" r="2.7" fill="#ffffff" />
        <circle cx="21.2" cy="14.4" r="2.7" fill="#ffffff" />
      </svg>
    ),
    { ...size },
  );
}