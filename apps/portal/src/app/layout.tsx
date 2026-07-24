import type { Metadata, Viewport } from "next";

import { SITE_NAME, SITE_URL } from "@/lib/site";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(`${SITE_URL}/`),
  title: {
    default: SITE_NAME,
    template: "%s",
  },
  description:
    "Plataforma de apresentadores digitais para vendas, onboarding e customer success, com vídeo ao vivo, conhecimento governado e operação rastreável.",
  applicationName: SITE_NAME,
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  robots: { index: false, follow: false },
  openGraph: {
    title: SITE_NAME,
    description:
      "Apresentadores digitais para vendas, onboarding e customer success, com vídeo ao vivo, conhecimento governado e operação rastreável.",
    type: "website",
    locale: "pt_BR",
    siteName: SITE_NAME,
  },
};

export const viewport: Viewport = {
  themeColor: "#08090d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
