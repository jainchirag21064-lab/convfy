// CONVfy brand mark — chat bubble with three typing dots in WhatsApp
// green. Mirrors the logo on the CONVfy marketing site so the product
// and the site always share one identity.
export function ConvfyMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M6 4.5A4.5 4.5 0 0 0 1.5 9v10a4.5 4.5 0 0 0 4.5 4.5H8v5.5l5.1-5.5H26a4.5 4.5 0 0 0 4.5-4.5V9A4.5 4.5 0 0 0 26 4.5H6Z"
        fill="#25D366"
      />
      <circle cx="10.8" cy="14.4" r="2.7" fill="#fff" />
      <circle cx="16" cy="14.4" r="2.7" fill="#fff" />
      <circle cx="21.2" cy="14.4" r="2.7" fill="#fff" />
    </svg>
  );
}