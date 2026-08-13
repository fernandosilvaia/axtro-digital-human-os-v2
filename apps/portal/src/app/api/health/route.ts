import { NextResponse } from "next/server";

const RECALL_VALID_REGIONS = new Set(["us-east-1", "us-west-2", "eu-central-1", "ap-northeast-1"]);

/**
 * Health check (T5): usado pelo Railway e pelo smoke test pós-deploy.
 * Nunca expõe segredo — só flags booleanas de configuração e a versão.
 *
 * `ok` continua fixo em `true` de propósito (decisão já documentada em
 * SECURITY_REVIEW.md): um único provider opcional ausente não deveria
 * derrubar o healthcheck do Railway e reiniciar o processo inteiro. O que
 * mudou (achado onda 8, D-V2-117) é a COBERTURA de `checks` — antes só 4
 * das ~14 vars críticas apareciam aqui; um operador olhando este endpoint
 * pra diagnosticar "por que X não funciona" não via a maioria das vars
 * reais. Agora todas aparecem, ainda como flags booleanas (nunca o valor).
 */
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  const recallRegion = (process.env.RECALL_API_REGION ?? "").trim();
  return NextResponse.json({
    ok: true,
    service: "axtro-portal",
    time: new Date().toISOString(),
    checks: {
      supabase_url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").length > 0,
      supabase_service_role: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").length > 0,
      language_provider: (process.env.OPENROUTER_API_KEY ?? "").length > 0,
      video_provider: (process.env.TAVUS_API_KEY ?? "").length > 0,
      video_replica: (process.env.TAVUS_REPLICA_ID ?? "").length > 0,
      video_webhook_token: (process.env.TAVUS_WEBHOOK_TOKEN ?? "").trim().length >= 16,
      meeting_provider: (process.env.RECALL_API_KEY ?? "").length > 0,
      meeting_provider_region: RECALL_VALID_REGIONS.has(recallRegion),
      // Achado da própria auto-revisão (onda 8): faltavam os 2 segredos de
      // webhook do Recall aqui, apesar do comentário acima dizer "todas
      // aparecem" — meeting_provider_webhook_token segue o mesmo limiar
      // >=16 real de recall/webhook/route.ts (RECALL_WEBHOOK_TOKEN
      // rejeita com 503 abaixo disso); RECALL_WEBHOOK_SECRET é
      // genuinamente OPCIONAL nesse mesmo arquivo (HMAC só roda se
      // presente), então aqui é só um booleano informativo, não uma
      // checagem de limiar.
      meeting_provider_webhook_token: (process.env.RECALL_WEBHOOK_TOKEN ?? "").trim().length >= 16,
      meeting_provider_webhook_secret_optional: (process.env.RECALL_WEBHOOK_SECRET ?? "").length > 0,
      voice_provider: (process.env.ELEVENLABS_API_KEY ?? "").length > 0,
      email_provider: (process.env.RESEND_API_KEY ?? "").length > 0,
      email_webhook_secret: (process.env.RESEND_WEBHOOK_SECRET ?? "").length > 0,
      billing_provider: (process.env.STRIPE_SECRET_KEY ?? "").length > 0,
      billing_webhook_secret: (process.env.STRIPE_WEBHOOK_SECRET ?? "").length > 0,
      // Achado da própria auto-revisão: faltava o mesmo limiar >=16 real
      // (authenticateVideoSessionRequest, lib/leads/video-session.ts) —
      // um secret de 1-15 chars aparecia como "true" aqui enquanto
      // POST /api/leads/video-session rejeitava 100% das chamadas.
      brain_tools_secret: (process.env.RAISSA_TOOLS_SECRET ?? "").trim().length >= 16,
      fake_providers: process.env.PORTAL_FAKE_PROVIDERS === "1",
    },
  });
}
