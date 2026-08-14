import { createHash } from "node:crypto";
import { createUuidV7 } from "@axtro/domain";
import { NextRequest, NextResponse } from "next/server";

import { readBoundedTextBody } from "@/lib/http/read-bounded-body";
import { activateProviderEffectBilling } from "@/lib/paid-effects";
import { isRateLimited } from "@/lib/rate-limit";
import { parseTavusNoDeliveryEvent, parseTavusTranscriptEvent, transcriptAppendWasPersisted } from "@/lib/transcripts/tavus-webhook";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logError as trackError, logEvent } from "@/lib/telemetry";

/**
 * Tavus does not sign callback requests. Each paid reservation therefore gets
 * an independent 256-bit bearer whose SHA-256 hash is bound in PostgreSQL
 * before provider dispatch. A capability for one conversation cannot claim,
 * append or replay delivery for another conversation.
 */
export const dynamic = "force-dynamic";

const MAX_TAVUS_WEBHOOK_BYTES = 5 * 1024 * 1024;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const TAVUS_WEBHOOK_RATE_LIMIT_WINDOW_MS = 60_000;
const TAVUS_WEBHOOK_GLOBAL_RATE_LIMIT_MAX = 240;
const TAVUS_WEBHOOK_CAPABILITY_RATE_LIMIT_MAX = 30;
const TAVUS_WEBHOOK_GLOBAL_RATE_LIMIT_KEY = "tavus-webhook:global";

type ClaimOutcome = "claimed" | "replayed" | "busy" | "unauthorized" | "not_ready" | "conflict";
type PreflightReceipt =
  | { readonly outcome: "authorized"; readonly providerRef: string; readonly capabilityExpiresAt: string }
  | { readonly outcome: "not_ready" }
  | { readonly outcome: "replayed_terminal" }
  | { readonly outcome: "unauthorized" };

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).sort().join("\u001f") === [...keys].sort().join("\u001f");
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function parsePreflightReceipt(value: unknown): PreflightReceipt | null {
  const record = ownRecord(value);
  if (!record || typeof record.outcome !== "string") return null;
  if (record.outcome === "authorized") {
    if (
      !hasExactKeys(record, ["outcome", "providerRef", "capabilityExpiresAt"])
      || typeof record.providerRef !== "string"
      || record.providerRef.length < 1
      || record.providerRef.length > 512
      || !isIsoTimestamp(record.capabilityExpiresAt)
    ) return null;
    return {
      outcome: "authorized",
      providerRef: record.providerRef,
      capabilityExpiresAt: record.capabilityExpiresAt,
    };
  }
  if (
    (record.outcome === "not_ready" || record.outcome === "replayed_terminal" || record.outcome === "unauthorized")
    && hasExactKeys(record, ["outcome"])
  ) return { outcome: record.outcome };
  return null;
}

function parseClaimOutcome(value: unknown): ClaimOutcome | null {
  const record = ownRecord(value);
  if (!record || !hasExactKeys(record, ["outcome"])) return null;
  const outcome = record.outcome;
  return outcome === "claimed" || outcome === "replayed" || outcome === "busy"
    || outcome === "unauthorized" || outcome === "not_ready" || outcome === "conflict"
    ? outcome
    : null;
}

function validateDeclaredBodyLength(headers: Headers): "invalid" | "too_large" | null {
  const declaredLength = headers.get("content-length");
  if (declaredLength === null) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(declaredLength)) return "invalid";
  return BigInt(declaredLength) > BigInt(MAX_TAVUS_WEBHOOK_BYTES) ? "too_large" : null;
}

export async function POST(request: NextRequest): Promise<Response> {
  const reservationId = request.nextUrl.searchParams.get("reservationId") ?? "";
  const capability = request.nextUrl.searchParams.get("capability") ?? "";
  if (!UUID_V7_PATTERN.test(reservationId) || !CAPABILITY_PATTERN.test(capability)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const declaredBodyLength = validateDeclaredBodyLength(request.headers);
  if (declaredBodyLength === "too_large") return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  if (declaredBodyLength === "invalid") return NextResponse.json({ error: "invalid_request_body" }, { status: 400 });

  const capabilityHash = createHash("sha256").update(capability).digest("hex");
  if (isRateLimited(TAVUS_WEBHOOK_GLOBAL_RATE_LIMIT_KEY, TAVUS_WEBHOOK_RATE_LIMIT_WINDOW_MS, TAVUS_WEBHOOK_GLOBAL_RATE_LIMIT_MAX)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (isRateLimited(`tavus-webhook:capability:${capabilityHash}`, TAVUS_WEBHOOK_RATE_LIMIT_WINDOW_MS, TAVUS_WEBHOOK_CAPABILITY_RATE_LIMIT_MAX)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  let preflight: PreflightReceipt;
  try {
    supabase = createServiceRoleClient();
    const { data, error } = await supabase.rpc("portal_preflight_tavus_webhook_service", {
      p_reservation_id: reservationId,
      p_capability_hash: capabilityHash,
    });
    if (error) {
      trackError("tavus_webhook_preflight_failed", error, {});
      return NextResponse.json({ error: "preflight_unavailable" }, { status: 503 });
    }
    const receipt = parsePreflightReceipt(data);
    if (receipt === null) {
      trackError("tavus_webhook_preflight_failed", new Error("invalid preflight receipt"), {});
      return NextResponse.json({ error: "preflight_unavailable" }, { status: 503 });
    }
    if (receipt.outcome === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (receipt.outcome === "not_ready") return NextResponse.json({ error: "delivery_not_ready" }, { status: 503 });
    if (receipt.outcome === "replayed_terminal") {
      return NextResponse.json({ ok: true, handled: true, replayed: true });
    }
    if (Date.parse(receipt.capabilityExpiresAt) <= Date.now()) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    preflight = receipt;
  } catch (error) {
    if (error instanceof ServiceRoleUnavailableError) {
      trackError("tavus_webhook_service_role_unavailable", error, {});
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    trackError("tavus_webhook_preflight_failed", error, {});
    return NextResponse.json({ error: "preflight_unavailable" }, { status: 503 });
  }

  // Capability authorization happens before this point. Only an authorized,
  // unexpired reservation may make us acquire and buffer the provider body.
  const bounded = await readBoundedTextBody(request, MAX_TAVUS_WEBHOOK_BYTES);
  if (!bounded.ok) {
    if (bounded.reason === "too_large") return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
    return NextResponse.json({ error: "invalid_request_body" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(bounded.text);
  } catch {
    return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
  }

  const transcript = parseTavusTranscriptEvent(body);
  const noDelivery = transcript === null ? parseTavusNoDeliveryEvent(body) : null;
  const parsed = transcript ?? noDelivery;
  if (parsed === null) {
    return NextResponse.json({ ok: true, handled: false });
  }
  if (parsed.conversationId !== preflight.providerRef) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payloadDigest = createHash("sha256").update(bounded.text).digest("hex");
  const claimToken = createUuidV7();
  try {
    const { data, error } = await supabase.rpc("portal_claim_tavus_webhook_service", {
      p_reservation_id: reservationId,
      p_provider_ref: parsed.conversationId,
      p_capability_hash: capabilityHash,
      p_payload_digest: payloadDigest,
      p_claim_token: claimToken,
      p_observed_at: parsed.observedAt,
    });
    if (error) {
      trackError("tavus_webhook_claim_failed", error, { conversation_id: parsed.conversationId });
      return NextResponse.json({ error: "dedupe_unavailable" }, { status: 503 });
    }
    const outcome = parseClaimOutcome(data);
    if (outcome === "replayed") return NextResponse.json({ ok: true, handled: true, replayed: true });
    if (outcome === "busy" || outcome === "not_ready") {
      return NextResponse.json({ error: "delivery_not_ready" }, { status: 503 });
    }
    if (outcome === "unauthorized") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (outcome === "conflict") return NextResponse.json({ error: "delivery_conflict" }, { status: 409 });
    if (outcome !== "claimed") return NextResponse.json({ error: "dedupe_unavailable" }, { status: 503 });
  } catch (error) {
    trackError("tavus_webhook_claim_failed", error, { conversation_id: parsed.conversationId });
    return NextResponse.json({ error: "dedupe_unavailable" }, { status: 503 });
  }

  const releaseForRetry = async (errorCode: string): Promise<Response> => {
    try {
      const { data, error } = await supabase.rpc("portal_release_tavus_webhook_service", {
        p_reservation_id: reservationId,
        p_payload_digest: payloadDigest,
        p_claim_token: claimToken,
      });
      if (error || data !== true) throw error ?? new Error("delivery release receipt missing");
    } catch (releaseError) {
      trackError("tavus_webhook_release_failed", releaseError, { conversation_id: parsed.conversationId });
    }
    return NextResponse.json({ error: errorCode }, { status: 503 });
  };

  try {
    if (transcript !== null) {
      if (transcript.truncated) {
        logEvent("tavus_webhook_transcript_truncated", { conversation_id: transcript.conversationId, kept_turns: transcript.turns.length });
      }
      const { data, error } = await supabase.rpc("portal_append_transcript_turns_service", {
        p_surface: "video",
        p_external_ref: transcript.conversationId,
        p_turns: transcript.turns,
        p_ended_at: new Date().toISOString(),
      });
      if (error) {
        trackError("tavus_webhook_transcript_append_failed", error, { conversation_id: transcript.conversationId });
        return releaseForRetry("transcript_persistence_retryable");
      }
      if (!transcriptAppendWasPersisted(data)) {
        logEvent("tavus_webhook_transcript_no_matching_transcript", { conversation_id: transcript.conversationId });
        return releaseForRetry("transcript_placeholder_not_ready");
      }

      // A transcript placeholder, an assistant greeting and replica_joined
      // do not prove that a customer ever entered the room. Only a non-empty
      // user turn from Tavus' final transcript unlocks customer billing.
      if (transcript.hasHumanTurn) {
        const { data: receiptData, error: receiptError } = await supabase.rpc("portal_record_tavus_customer_delivery_service", {
          p_reservation_id: reservationId,
          p_provider_ref: transcript.conversationId,
          p_payload_digest: payloadDigest,
          p_event_type: "application.transcription_ready",
          p_observed_at: transcript.observedAt,
        });
        const receipt = receiptData as { recorded?: unknown; customerDeliveryState?: unknown } | null;
        if (receiptError || receipt?.recorded !== true || (receipt.customerDeliveryState !== "held" && receipt.customerDeliveryState !== "activated")) {
          if (receiptError) trackError("tavus_webhook_delivery_receipt_failed", receiptError, { conversation_id: transcript.conversationId });
          return releaseForRetry("delivery_receipt_pending");
        }
        try {
          await activateProviderEffectBilling(reservationId, supabase);
        } catch (activationError) {
          trackError("tavus_webhook_billing_activation_failed", activationError, { conversation_id: transcript.conversationId });
          return releaseForRetry("billing_activation_pending");
        }
      } else {
        const { data: noDeliveryData, error: noDeliveryError } = await supabase.rpc("portal_record_tavus_no_delivery_service", {
          p_reservation_id: reservationId,
          p_provider_ref: transcript.conversationId,
          p_payload_digest: payloadDigest,
          p_reason: "transcript_without_user_turn",
          p_observed_at: transcript.observedAt,
        });
        const receipt = noDeliveryData as { voided?: unknown; customerDeliveryState?: unknown } | null;
        if (noDeliveryError || receipt?.voided !== true || receipt.customerDeliveryState !== "voided") {
          if (noDeliveryError) trackError("tavus_webhook_no_delivery_receipt_failed", noDeliveryError, { conversation_id: transcript.conversationId });
          return releaseForRetry("no_delivery_receipt_pending");
        }
      }
    } else if (noDelivery !== null) {
      const { data: noDeliveryData, error: noDeliveryError } = await supabase.rpc("portal_record_tavus_no_delivery_service", {
        p_reservation_id: reservationId,
        p_provider_ref: noDelivery.conversationId,
        p_payload_digest: payloadDigest,
        p_reason: noDelivery.reason,
        p_observed_at: noDelivery.observedAt,
      });
      const receipt = noDeliveryData as { voided?: unknown; customerDeliveryState?: unknown } | null;
      if (noDeliveryError || receipt?.voided !== true || receipt.customerDeliveryState !== "voided") {
        if (noDeliveryError) trackError("tavus_webhook_no_delivery_receipt_failed", noDeliveryError, { conversation_id: noDelivery.conversationId });
        return releaseForRetry("no_delivery_receipt_pending");
      }
    }

    const { data: completed, error: completeError } = await supabase.rpc("portal_complete_tavus_webhook_service", {
      p_reservation_id: reservationId,
      p_payload_digest: payloadDigest,
      p_claim_token: claimToken,
    });
    if (completeError || completed !== true) {
      if (completeError) trackError("tavus_webhook_complete_failed", completeError, { conversation_id: parsed.conversationId });
      return releaseForRetry("delivery_completion_pending");
    }
    return NextResponse.json({ ok: true, handled: true });
  } catch (error) {
    trackError("tavus_webhook_unexpected_error", error, { conversation_id: parsed.conversationId });
    return releaseForRetry("transcript_persistence_retryable");
  }
}
