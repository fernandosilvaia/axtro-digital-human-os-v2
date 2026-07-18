import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://portal-production-b43e.up.railway.app"),
  title: {
    default: "Axtro Digital Human OS",
    template: "%s",
  },
  description:
    "Plataforma operacional para agentes digitais humanos — apresentadores com voz, avatar e conhecimento governado por conta.",
  applicationName: "Axtro Digital Human OS",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Axtro Digital Human OS",
    description:
      "Plataforma operacional para agentes digitais humanos — apresentadores com voz, avatar e conhecimento governado por conta.",
    type: "website",
    locale: "pt_BR",
    siteName: "Axtro Digital Human OS",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0f",
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
