import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";

// Cada regra do array vira um bloco User-Agent independente no robots.txt
// gerado — por RFC 9309, um bot com bloco próprio usa SÓ esse bloco, sem
// herdar o do "*". Por isso os paths privados precisam ser repetidos em
// TODO bloco que permite crawling (achado da revisão da Auditoria 360:
// OAI-SearchBot/Claude-SearchBot/Claude-User tinham só `allow: "/"`, sem
// nenhum disallow, contradizendo docs/codex/SYSTEM_MAP.md).
const PRIVATE_PATHS = [
  "/dashboard",
  "/agentes",
  "/conversas",
  "/conhecimento",
  "/configuracoes",
  "/auth/",
  "/api/",
  "/rosto-agente",
];

// Páginas de login, criação e recuperação de conta usam `noindex` na
// metadata. Elas precisam poder ser lidas pelo crawler para que essa diretiva
// seja respeitada; já workspace, capability stage e API ficam fora do crawl.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "GPTBot", disallow: "/" },
      { userAgent: "ClaudeBot", disallow: "/" },
      { userAgent: "Google-Extended", disallow: "/" },
      { userAgent: "CCBot", disallow: "/" },
      { userAgent: "OAI-SearchBot", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "Claude-SearchBot", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: "Claude-User", allow: "/", disallow: PRIVATE_PATHS },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
