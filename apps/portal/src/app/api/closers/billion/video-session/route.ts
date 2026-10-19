import { NextRequest, NextResponse } from "next/server";

import { createTavusVideoConversationPort, isTrustedTavusConversationUrl, VideoProviderError } from "@axtro/provider-tavus";

import { AdmissionError, authenticateCrmCaller, verifyAdmission } from "@/lib/closers/billion-admission";
import { admissionContext, openingGreeting } from "@/lib/closers/billion-chat";
import { checkAdmission, reserveVideo } from "@/lib/closers/billion-store";
import { billionCloserEnabled, resolveBillionAgent } from "@/lib/closers/billion-server";
import { readBoundedTextBody } from "@/lib/http/read-bounded-body";
import { isRateLimited } from "@/lib/rate-limit";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";
import { beginProviderEffect, commitProviderEffectOrCompensate, compensateCommittedProviderEffect, fenceProviderFailure, isPaidEffectCommandId, markCleanupPending, paidEffectIntentKey, providerCorrelationLabel, retryReleasedProviderEffect, type ProviderEffectReservation } from "@/lib/paid-effects";
import { prepareTavusWebhookCallback, registerTranscriptPlaceholder } from "@/lib/transcripts/register";

/**
 * Sessão de vídeo da closer da Billion (ADR-051). Só o backend do CRM chama, com o segredo de
 * serviço e a admissão assinada, que prova o aviso de IA confirmado. A chave de idempotência do
 * efeito pago é a própria admissão: repetir a chamada devolve a MESMA sala, nunca uma segunda
 * cobrança. O teto diário de vídeo do tenant (ledger durável) continua valendo.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_CALL_SECONDS = 600;

export async function POST(request: NextRequest): Promise<Response> {
  if (!billionCloserEnabled(process.env)) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
  const tavusKey = process.env.TAVUS_API_KEY ?? "";
  if (tavusKey.trim().length === 0) return NextResponse.json({ error: "video_provider_not_configured" }, { status: 503 });

  let reservation: ProviderEffectReservation | null = null;
  let tenantId: string | null = null;
  let agentId: string | null = null;
  const port = createTavusVideoConversationPort({ apiKey: tavusKey });

  try {
    authenticateCrmCaller(request.headers.get("authorization"), process.env.BILLION_CLOSER_SERVICE_SECRET);
    if (isRateLimited("billion-closer:video", 60_000, 30)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    const raw = await readBoundedTextBody(request, MAX_BODY_BYTES);
    if (!raw.ok) return NextResponse.json({ error: raw.reason === "too_large" ? "payload_too_large" : "invalid_body" }, { status: raw.reason === "too_large" ? 413 : 400 });
    let body: Record<string, unknown>;
    try {
      const parsedBody: unknown = JSON.parse(raw.text);
      if (parsedBody === null || typeof parsedBody !== "object" || Array.isArray(parsedBody)) return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
      body = parsedBody as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
    }
    const admission = verifyAdmission(body.admission, process.env.BILLION_CLOSER_ADMISSION_KEY);
    if (!isPaidEffectCommandId(admission.id)) return NextResponse.json({ error: "admission_invalid" }, { status: 401 });
    const receipt = await checkAdmission(createServiceRoleClient(), admission.id);
    if (!receipt.valid) {
      return receipt.reason === "unavailable"
        ? NextResponse.json({ error: "closer_unavailable" }, { status: 503 })
        : NextResponse.json({ error: receipt.reason === "expired" ? "admission_expired" : "admission_invalid" }, { status: 401 });
    }
    // Teto diário de salas por conta, no banco. "already" segue: a idempotência devolve a mesma sala.
    const video = await reserveVideo(createServiceRoleClient(), admission.id);
    if (video === "limit") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (video === "invalid") return NextResponse.json({ error: "admission_invalid" }, { status: 401 });
    if (video === "unavailable") return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });

    const agent = await resolveBillionAgent(process.env);
    if (agent === null || agent.personaId === null) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
    tenantId = agent.tenantId;
    agentId = agent.agentId;

    const reservationInput = {
      tenantId: agent.tenantId,
      agentId: agent.agentId,
      provider: "tavus" as const,
      idempotencyKey: paidEffectIntentKey(admission.id, "tavus:billion-closer-video"),
      relatedRef: admission.id,
      maxDurationSeconds: MAX_CALL_SECONDS,
    };
    reservation = await retryReleasedProviderEffect(reservationInput, await beginProviderEffect(reservationInput));
    if (reservation.outcome === "capped") {
      logEvent("billion_closer_video_daily_cap_hit", {});
      return NextResponse.json({ error: "video_unavailable_today" }, { status: 503 });
    }
    if (reservation.outcome === "blocked_unknown" || reservation.reservationId === null) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });

    // Repetição da mesma admissão: devolve a sala já criada.
    if (reservation.state === "committed" && reservation.providerRef && reservation.providerUrl) {
      if (!isTrustedTavusConversationUrl(reservation.providerUrl)) return NextResponse.json({ error: "provider_unavailable" }, { status: 502 });
      return NextResponse.json({ url: reservation.providerUrl, conversationId: reservation.providerRef, replayed: true });
    }

    const reservationId = reservation.reservationId;
    const callbackUrl = (await prepareTavusWebhookCallback(reservationId)).callbackUrl;
    let conversation: Awaited<ReturnType<typeof port.createConversation>>;
    try {
      conversation = await port.createConversation({
        personaId: agent.personaId,
        conversationName: providerCorrelationLabel("Billion closer, vídeo", reservationId, 120),
        greeting: openingGreeting(agent.agentName, admission.lang, admission.firstName),
        language: admission.lang,
        conversationalContext: admissionContext(admission),
        maxCallDurationSeconds: MAX_CALL_SECONDS,
        callbackUrl,
      });
      await commitProviderEffectOrCompensate(
        reservationId, "tavus", conversation.conversationId,
        () => port.endConversation(conversation.conversationId), conversation.conversationUrl, "billion-closer-video",
      );
    } catch (error) {
      await fenceProviderFailure(reservationId, error).catch(() => undefined);
      throw error;
    }

    if (!(await registerTranscriptPlaceholder(agent.tenantId, agent.agentId, "video", conversation.conversationId))) {
      try {
        await compensateCommittedProviderEffect({
          reservationId, provider: "tavus", providerRef: conversation.conversationId, failureCode: "transcript_persistence_failed",
          terminate: () => port.endConversation(conversation.conversationId),
        });
      } catch (compensationError) {
        await markCleanupPending(reservationId, conversation.conversationId, "transcript_compensation_unknown").catch(() => undefined);
        trackError("billion_closer_video_compensation_failed", compensationError, {});
      }
      return NextResponse.json({ error: "persistence_failed" }, { status: 503 });
    }
    logEvent("billion_closer_video_created", { admission_id: admission.id, tenant_id: agent.tenantId, agent_id: agent.agentId });
    return NextResponse.json({ url: conversation.conversationUrl, conversationId: conversation.conversationId });
  } catch (error) {
    if (error instanceof AdmissionError) return NextResponse.json({ error: error.code }, { status: error.status });
    if (error instanceof VideoProviderError) {
      trackError("billion_closer_video_tavus_error", error, { code: error.code });
      return NextResponse.json({ error: "provider_unavailable" }, { status: 502 });
    }
    if (error instanceof ServiceRoleUnavailableError) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
    trackError("billion_closer_video_unexpected_error", error, { tenant_id: tenantId, agent_id: agentId });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
