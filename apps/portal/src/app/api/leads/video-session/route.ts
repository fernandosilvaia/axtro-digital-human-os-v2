import { NextRequest, NextResponse } from "next/server";

import { createTavusVideoConversationPort, VideoProviderError } from "@axtro/provider-tavus";

import {
  handleVideoSessionRequest,
  VideoSessionError,
  type PlatformAgentPersona,
} from "@/lib/leads/video-session";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Chamado pelo control-tower (ligação de voz da Raissa) quando o lead topa
 * emendar pra vídeo na hora. Servidor-a-servidor — autenticado por
 * RAISSA_TOOLS_SECRET (segredo estático único, não por agente/tenant como o
 * M4). Devolve a URL da sala Tavus da Raissa (a agente com
 * presentation_kind = 'platform' em agent_video_config).
 *
 * NÃO chamar em produção sem RAISSA_TOOLS_SECRET configurada no ambiente —
 * sem ela, a rota responde 503 antes de tocar qualquer dado.
 */
export const dynamic = "force-dynamic";

async function resolvePlatformAgentPersona(): Promise<PlatformAgentPersona | null> {
  const supabase = createServiceRoleClient();
  // Duas consultas simples em vez de embedding do PostgREST (agents(...)):
  // agent_video_config -> agents é FK composta (tenant_id, agent_id), e o
  // comportamento do embed nesse caso não foi verificado contra o projeto
  // real — mesma cautela já aplicada em M4-04 (handle-chat-request.ts).
  const { data: config, error: configError } = await supabase
    .from("agent_video_config")
    .select("tavus_persona_id, tenant_id, agent_id")
    .eq("presentation_kind", "platform")
    .not("tavus_persona_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (configError || config === null || typeof config.tavus_persona_id !== "string") {
    if (configError) trackError("video_session_resolve_persona_failed", configError, {});
    return null;
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("name")
    .eq("tenant_id", config.tenant_id)
    .eq("id", config.agent_id)
    .maybeSingle();

  return {
    personaId: config.tavus_persona_id,
    agentName: typeof agent?.name === "string" ? agent.name : "Raissa",
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = process.env.TAVUS_API_KEY ?? "";
  if (apiKey.trim().length === 0) {
    return NextResponse.json({ error: "video_provider_not_configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const leadName = typeof (body as { leadName?: unknown })?.leadName === "string" ? (body as { leadName: string }).leadName : null;
  const language = typeof (body as { language?: unknown })?.language === "string" ? (body as { language: string }).language : null;

  const port = createTavusVideoConversationPort({ apiKey });

  try {
    const result = await handleVideoSessionRequest(
      {
        authorizationHeader: request.headers.get("authorization"),
        expectedSecret: process.env.RAISSA_TOOLS_SECRET ?? null,
        leadName,
        language,
      },
      {
        resolvePlatformAgentPersona,
        createConversation: async ({ personaId, leadName: name, language: lang }) => {
          const conversation = await port.createConversation({
            personaId,
            conversationName: `Lead ${name ?? "sem nome"} — vídeo sob demanda`,
            ...(name ? { greeting: `Oi ${name}! Que bom falar com você agora — bora continuar por vídeo?` } : {}),
            ...(lang ? { language: lang } : {}),
            maxCallDurationSeconds: 900,
          });
          return { url: conversation.conversationUrl, conversationId: conversation.conversationId };
        },
      },
    );
    return NextResponse.json({ url: result.url, conversationId: result.conversationId });
  } catch (error) {
    if (error instanceof VideoSessionError) {
      if (error.code !== "missing_bearer" && error.code !== "invalid_secret" && error.code !== "not_configured") {
        trackError("video_session_failed", error, {});
      }
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    if (error instanceof VideoProviderError) {
      trackError("video_session_tavus_error", error, { code: error.code });
      return NextResponse.json({ error: "provider_unavailable" }, { status: 502 });
    }
    if (error instanceof ServiceRoleUnavailableError) {
      trackError("video_session_service_role_unavailable", error, {});
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    trackError("video_session_unexpected_error", error, {});
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

// GAP CONHECIDO E DECLARADO (Art. 16): esta rota ainda não grava custo no
// ledger (cost_events) — a conversa Tavus criada aqui não aparece em
// portal_usage_summary. portal_log_video_usage exige auth.uid(), que não
// existe numa chamada servidor-a-servidor; precisa da mesma variante
// _service já usada em portal_log_ai_usage_service (0019). Candidato à
// próxima sessão que tocar isto.
