import type { Metadata } from "next";

/**
 * The public marketing surface has one reviewed canonical origin. Runtime
 * callback origins are validated separately in `public-origin.ts`; a preview
 * deployment must never become the URL that search engines or AI answers use.
 */
export const SITE_URL = "https://closer.axtroai.com";
export const SITE_NAME = "Axtro Closer AI Human";
export const SITE_TAGLINE = "Closer de IA em vídeo";
export const SITE_DESCRIPTION =
  "Closer de IA em vídeo para conversas comerciais com presença identificada, contexto autorizado e controle da sua equipe.";
export const OG_IMAGE_PATH = "/opengraph-image";

export function absoluteUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new TypeError("Public site paths must be root-relative");
  }

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
        alt: `${SITE_NAME}, ${SITE_TAGLINE} com presença identificada e operação sob controle`,
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
