import { NextResponse } from "next/server";

/**
 * Health check (T5): usado pelo Railway e pelo smoke test pós-deploy.
 * Nunca expõe segredo — só flags booleanas de configuração e a versão.
 */
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({
    ok: true,
    service: "axtro-portal",
    time: new Date().toISOString(),
    checks: {
      supabase_url: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").length > 0,
      language_provider: (process.env.OPENROUTER_API_KEY ?? "").length > 0,
      video_provider: (process.env.TAVUS_API_KEY ?? "").length > 0,
      email_provider: (process.env.RESEND_API_KEY ?? "").length > 0,
      fake_providers: process.env.PORTAL_FAKE_PROVIDERS === "1",
    },
  });
}
