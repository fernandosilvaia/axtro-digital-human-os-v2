import type { Metadata } from "next";

/** Public canonical origin. Deploy hosts must be supplied explicitly when they differ. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://closer.axtroai.com").replace(/\/$/, "");
export const SITE_NAME = "Axtro Digital Human OS";
export const OG_IMAGE_PATH = "/opengraph-image";

export function absoluteUrl(path: string): string {
  return new URL(path, `${SITE_URL}/`).toString();
}

export function createPageMetadata({
  title,
  description,
  path,
  noIndex = false,
}: {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly noIndex?: boolean;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: absoluteUrl(path),
      type: "website",
      locale: "pt_BR",
      siteName: SITE_NAME,
      images: [{
        url: absoluteUrl(OG_IMAGE_PATH),
        width: 1200,
        height: 630,
        alt: `${SITE_NAME}, apresentadores digitais para vendas e atendimento`,
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [absoluteUrl(OG_IMAGE_PATH)],
    },
  };
}
