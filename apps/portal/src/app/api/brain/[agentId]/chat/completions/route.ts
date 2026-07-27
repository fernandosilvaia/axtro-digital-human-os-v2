import { NextRequest, NextResponse } from "next/server";

import { createUuidV7 } from "@axtro/domain";
import { createOpenRouterTextGenerationPort } from "@axtro/provider-openrouter";

import { BrainHttpError, handleBrainChatRequest, type ResolvedBrainAgent } from "@/lib/brain/handle-chat-request";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Endpoint OpenAI-compatible que o Tavus chama como LLM da persona de vídeo
 * (`layers.llm.base_url`, M4-04). Wiring fino sobre `handleBrainChatRequest`
 * (M4-01/M4-02/M4-03, puro e já testado): resolve o segredo via service
 * role (sem sessão de usuário — é chamada servidor-a-servidor), formata a
 * resposta em SSE `chat.completion.chunk`.
 *
 * GAP CONHECIDO E DECLARADO (Art. 16 — honestidade estrutural): RAG real
 * ainda não está ligado neste caminho — `portal_search_knowledge` exige
 * `auth.uid()`, que não existe aqui. Enquanto uma RPC `_service` equivalente
 * não existe, o cérebro responde só com identidade + Método Silva +
 * percepção, sem fontes de conhecimento da conta (Art. 14: RAG indisponível,
 * o agente não inventa — segue sem, não finge ter).
 *
 * NÃO chamar em produção: a migration 0018/0019 ainda não foi aplicada no
 * Supabase real (bloqueio do classificador de segurança da sessão que
 * escreveu este código — ver PROGRESS.md/DECISIONS_LOG D-V2-082) e nenhuma
 * persona Tavus real aponta pra este endpoint ainda.
 */
export const dynamic = "force-dynamic";

async function resolveConfig(secretHash: string): Promise<ResolvedBrainAgent | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_resolve_agent_brain_config_service", {
    p_secret_hash: secretHash,
  });
  if (error) {
    trackError("brain_resolve_config_failed", error, {});
    return null;
  }
  const record = data as { found: boolean; tenant_id?: string; agent_id?: string; agent_name?: string; tenant_name?: string } | null;
  if (record === null || record.found !== true) return null;
  if (
    typeof record.tenant_id !== "string"
    || typeof record.agent_id !== "string"
    || typeof record.agent_name !== "string"
    || typeof record.tenant_name !== "string"
  ) {
    return null;
  }
  return {
    tenantId: record.tenant_id,
    agentId: record.agent_id,
    agentName: record.agent_name,
    tenantName: record.tenant_name,
    enabled: true,
  };
}

// GAP CONHECIDO — ver docstring do módulo. Retorna sempre vazio até uma RPC
// service-role de busca vetorial existir (candidato a M4-05).
async function retrieveKnowledge(): Promise<readonly []> {
  return [];
}

async function logGenerationUsage(tenantId: string, agentId: string, inputTokens: number, outputTokens: number): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.rpc("portal_log_ai_usage_service", {
      p_tenant_id: tenantId,
      p_id: createUuidV7(),
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
    });
    if (error) trackError("brain_log_usage_failed", error, { agent_id: agentId });
  } catch (error) {
    trackError("brain_log_usage_failed", error, { agent_id: agentId });
  }
}

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function buildCompletionStream(reply: string, model: string): ReadableStream<Uint8Array> {
  const id = `brain-${createUuidV7()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }],
      })));
      controller.enqueue(encoder.encode(sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> },
): Promise<Response> {
  const { agentId } = await context.params;
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (apiKey.trim().length === 0) {
    return NextResponse.json({ error: "language_provider_not_configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }
  const rawMessages = (body as { messages?: unknown } | null)?.messages;
  const model = typeof (body as { model?: unknown } | null)?.model === "string"
    ? (body as { model: string }).model
    : "axtro-digital-human-os-brain";

  const port = createOpenRouterTextGenerationPort({
    apiKey,
    appUrl: "https://portal-production-b43e.up.railway.app",
    appTitle: "Axtro Digital Human OS — Brain",
  });

  try {
    const result = await handleBrainChatRequest(
      {
        authorizationHeader: request.headers.get("authorization"),
        agentIdFromPath: agentId,
        rawMessages,
      },
      {
        resolveConfig,
        retrieveKnowledge,
        generate: (messages, maxOutputTokens) =>
          port.generate({ model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5", messages, maxOutputTokens }),
        logGenerationUsage,
      },
    );
    return new Response(buildCompletionStream(result.reply, model), {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
  } catch (error) {
    if (error instanceof BrainHttpError) {
      // Falha de autenticação: rejeição dura, sem tocar dado de tenant, sem detalhe que ajude a adivinhar o segredo certo.
      return NextResponse.json({ error: "unauthorized" }, { status: error.status });
    }
    if (error instanceof ServiceRoleUnavailableError) {
      trackError("brain_service_role_unavailable", error, { agent_id: agentId });
      return NextResponse.json({ error: "brain_not_configured" }, { status: 503 });
    }
    trackError("brain_chat_completions_unexpected_error", error, { agent_id: agentId });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
