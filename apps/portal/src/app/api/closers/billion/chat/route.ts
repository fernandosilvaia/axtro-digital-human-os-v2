import { NextRequest, NextResponse } from "next/server";

import { createOpenRouterTextGenerationPort, TextGenerationError } from "@axtro/provider-openrouter";

import { AdmissionError, authenticateCrmCaller, verifyAdmission } from "@/lib/closers/billion-admission";
import { billionBrainAgent, buildBrainMessages, countUserTurns, MAX_USER_TURNS_PER_ADMISSION, parseChatBody } from "@/lib/closers/billion-chat";
import { checkAdmission } from "@/lib/closers/billion-store";
import { billionCloserEnabled, resolveBillionAgent } from "@/lib/closers/billion-server";
import { runAuthenticatedBrainTurn, type BudgetVerdict } from "@/lib/brain/handle-chat-request";
import type { BrainKnowledgeMatch } from "@/lib/brain/chat-completion-core";
import { retrieveBrainKnowledge } from "@/lib/brain/knowledge-retrieval";
import {
  aiProviderRequestScope,
  beginAiUsage,
  commitAiUsage,
  configuredOpenRouterGenerationModel,
  markAiUsageInFlight,
  markAiUsageUnknown,
  recordAiUsageProviderFailure,
  releaseAiUsageNotDispatched,
  stableAiUsageIdempotencyKey,
  type AiUsageReservation,
} from "@/lib/ai-budget/reservations";
import { readBoundedTextBody } from "@/lib/http/read-bounded-body";
import { embedQuery, prepareEmbeddingQueryForReservedUsage } from "@/lib/knowledge";
import { isRateLimited } from "@/lib/rate-limit";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Chat de texto da closer da Billion (ADR-051). O painel do CRM chama via backend do CRM, com o
 * segredo de serviço e a admissão assinada. O turno é o mesmo do vídeo: mesma doutrina, mesma
 * tabela de preços, mesma trava de saída e mesmo limitador de tamanho; só muda o transporte.
 * Cada turno reserva o pior caso de custo antes do provedor, como o endpoint do cérebro.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: NextRequest): Promise<Response> {
  if (!billionCloserEnabled(process.env)) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (apiKey.trim().length === 0) return NextResponse.json({ error: "language_provider_not_configured" }, { status: 503 });

  let reservation: AiUsageReservation | null = null;
  let dispatched = false;
  let terminalRecorded = false;
  let reportedCostUsd: number | undefined;
  const serviceClientFactory = () => createServiceRoleClient();

  try {
    authenticateCrmCaller(request.headers.get("authorization"), process.env.BILLION_CLOSER_SERVICE_SECRET);
    if (isRateLimited("billion-closer:chat", 60_000, 120)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    const raw = await readBoundedTextBody(request, MAX_BODY_BYTES);
    if (!raw.ok) return NextResponse.json({ error: raw.reason === "too_large" ? "payload_too_large" : "invalid_body" }, { status: raw.reason === "too_large" ? 413 : 400 });
    let body: unknown;
    try {
      body = JSON.parse(raw.text);
    } catch {
      return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
    }
    const parsed = parseChatBody(body);
    const admission = verifyAdmission(parsed.admission, process.env.BILLION_CLOSER_ADMISSION_KEY);
    if (countUserTurns(parsed.messages) > MAX_USER_TURNS_PER_ADMISSION) return NextResponse.json({ error: "conversation_limit" }, { status: 429 });
    if (isRateLimited(`billion-closer:chat:${admission.id}`, 60_000, 12)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

    // O recibo durável manda: admissão revogada (pedido de parar) ou sem recibo não conversa.
    const receipt = await checkAdmission(createServiceRoleClient(), admission.id);
    if (!receipt.valid) {
      return receipt.reason === "unavailable"
        ? NextResponse.json({ error: "closer_unavailable" }, { status: 503 })
        : NextResponse.json({ error: receipt.reason === "expired" ? "admission_expired" : "admission_invalid" }, { status: 401 });
    }
    const agent = await resolveBillionAgent(process.env);
    if (agent === null) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
    const brainAgent = billionBrainAgent(agent, admission);
    const rawMessages = buildBrainMessages(admission, agent.agentName, parsed.messages);

    const providerModel = configuredOpenRouterGenerationModel(process.env);
    const port = createOpenRouterTextGenerationPort({
      apiKey,
      appUrl: "https://portal-production-b43e.up.railway.app",
      appTitle: "Axtro Digital Human OS Billion Closer",
    });
    const serviceClient = serviceClientFactory();
    const scope = aiProviderRequestScope(request.headers.get("idempotency-key"));
    const material = `${agent.tenantId}:${agent.agentId}:${admission.id}:${scope}:${JSON.stringify(rawMessages)}`;

    const result = await runAuthenticatedBrainTurn(brainAgent, { rawMessages }, {
      checkBudget: async (tenantId): Promise<BudgetVerdict> => {
        const begin = await beginAiUsage({
          client: serviceClient,
          operation: "brain_generation",
          idempotencyKey: stableAiUsageIdempotencyKey("brain_generation", material),
          tenantId,
          agentId: agent.agentId,
        });
        if (!begin.allowed) return begin.reason === "capped" ? "exhausted" : "unavailable";
        if (begin.reservation.state !== "reserved") return "unavailable";
        reservation = begin.reservation;
        return "allowed";
      },
      retrieveKnowledge: async (tenantId, queryText): Promise<readonly BrainKnowledgeMatch[]> =>
        retrieveBrainKnowledge({ tenantId, agentId: agent.agentId, queryText, idempotencyMaterial: material }, {
          client: serviceClient,
          apiKey,
          prepare: prepareEmbeddingQueryForReservedUsage,
          embed: embedQuery,
          recordEvent: (code) => logEvent(code, { tenant_id: tenantId, agent_id: agent.agentId }),
        }),
      generate: async (messages, maxOutputTokens, options) => {
        if (reservation === null) throw new Error("AI usage reservation missing");
        dispatched = await markAiUsageInFlight(serviceClient, reservation);
        if (!dispatched) throw new Error("AI usage reservation is not executable");
        try {
          const generated = await port.generate({
            model: providerModel,
            messages,
            maxOutputTokens,
            ...(options?.cacheSystemPrompt === true ? { cacheSystemPrompt: true } : {}),
          });
          reportedCostUsd = generated.usage.reportedCostUsd;
          return generated;
        } catch (error) {
          if (error instanceof TextGenerationError && error.billedUsage !== undefined && !terminalRecorded) {
            const committed = await commitAiUsage(serviceClient, reservation, { ...error.billedUsage });
            terminalRecorded = true;
            if (!committed) await markAiUsageUnknown(serviceClient, reservation, "usage_commit_failed");
          }
          throw error;
        }
      },
      logGenerationUsage: async (_tenantId, _agentId, inputTokens, outputTokens) => {
        if (reservation === null) throw new Error("AI usage reservation missing at commit");
        const committed = await commitAiUsage(serviceClient, reservation, {
          inputTokens,
          outputTokens,
          ...(reportedCostUsd === undefined ? {} : { reportedCostUsd }),
        });
        terminalRecorded = true;
        if (!committed) {
          await markAiUsageUnknown(serviceClient, reservation, "usage_commit_failed");
          throw new Error("AI usage commit failed after provider success");
        }
      },
    });

    if (reservation !== null && result.degraded) {
      if (dispatched && !terminalRecorded && result.degradedReason === "generation_failed") {
        await recordAiUsageProviderFailure(serviceClient, reservation, result.cause);
      } else if (!dispatched) {
        await releaseAiUsageNotDispatched(serviceClient, reservation);
      }
    }
    if (result.degraded) logEvent(`billion_closer_degraded_${result.degradedReason ?? "unknown"}`, { admission_id: admission.id });
    if (result.guardrailFlags.length > 0) logEvent("billion_closer_guardrail_flags", { admission_id: admission.id, flags: result.guardrailFlags.join(",") });
    // Só o texto e se foi fallback: a conversa em si não vai para telemetria.
    return NextResponse.json({ reply: result.reply, degraded: result.degraded });
  } catch (error) {
    if (error instanceof AdmissionError) return NextResponse.json({ error: error.code }, { status: error.status });
    if (error instanceof ServiceRoleUnavailableError) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
    trackError("billion_closer_chat_unexpected_error", error, {});
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
