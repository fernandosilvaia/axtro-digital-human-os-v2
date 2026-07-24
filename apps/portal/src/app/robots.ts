import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/dashboard",
        "/agentes",
        "/conhecimento",
        "/configuracoes",
        "/login",
        "/signup",
        "/recuperar-senha",
        "/nova-senha",
        "/auth/",
        "/api/",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
