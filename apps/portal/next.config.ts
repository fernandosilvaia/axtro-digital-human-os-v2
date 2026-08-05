import type { NextConfig } from "next";

// Headers de segurança (auditoria 2026-08-02: produção não servia NENHUM).
// Cuidados que não são óbvios:
// - Permissions-Policy precisa DELEGAR camera/microphone pro origin do Daily
//   (tavus.daily.co): a sala de vídeo do /testar é um iframe cross-origin com
//   allow="camera; microphone" — restringir a (self) quebraria a sala. As
//   páginas próprias (apresentação, /rosto-agente) usam getUserMedia no nosso
//   próprio origin, coberto pelo self.
// - X-Frame-Options: DENY em tudo MENOS /rosto-agente: o Output Media do
//   Recall.ai carrega essa página num navegador próprio (não iframe), mas
//   não custa deixá-la frameável — se o vendor mudar o mecanismo, a câmera
//   do agente em TODAS as reuniões externas não pode quebrar por um header.
// - HSTS sem includeSubDomains: closer.axtroai.com convive com outros
//   subdomínios de axtroai.com fora do nosso controle direto.
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: 'camera=(self "https://tavus.daily.co"), microphone=(self "https://tavus.daily.co"), geolocation=(), payment=()',
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/((?!rosto-agente).*)",
        headers: [...SECURITY_HEADERS, { key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/rosto-agente",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
