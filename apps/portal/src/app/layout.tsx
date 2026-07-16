import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Axtro Digital Human OS",
  description: "Portal operacional do Axtro Digital Human OS",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
