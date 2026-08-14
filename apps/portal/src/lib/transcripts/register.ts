/**
 * Glue compartilhada de histórico de conversa (D-V2-106) entre os 3 pontos
 * de integração (chat sandbox, vídeo/apresentação, reunião externa):
 * placeholder criado no momento em que a conversa nasce (contexto
 * autenticado, tenant conhecido de verdade) — os webhooks do Tavus/Recall
 * só PREENCHEM `turns` depois, nunca criam a linha (Art. 9: um webhook
 * externo não é fonte confiável de qual tenant é dono da conversa).
 */
import { createHash, randomBytes } from "node:crypto";
import { createUuidV7 } from "@axtro/domain";
import type { SupabaseClient } from "@supabase/supabase-js";

import { portalPublicOrigin } from "../public-origin.ts";
import { createServiceRoleClient } from "../supabase/service.ts";
import { logError as trackError } from "../telemetry.ts";

export type TranscriptSurface = "chat" | "video" | "meeting";
export type ProviderTranscriptSurface = Exclude<TranscriptSurface, "chat">;

export interface TavusWebhookCallbackCapability {
  readonly callbackUrl: string;
  readonly capabilityHash: string;
  readonly capabilityExpiresAt: string;
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isStrictCapabilityReceipt(value: unknown): value is {
  readonly acquired: true;
  readonly state: "provider_in_flight";
  readonly capabilityExpiresAt: string;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null)
    && Object.keys(record).sort().join("\u001f") === ["acquired", "capabilityExpiresAt", "state"].join("\u001f")
    && record.acquired === true
    && record.state === "provider_in_flight"
    && typeof record.capabilityExpiresAt === "string"
    && ISO_TIMESTAMP_PATTERN.test(record.capabilityExpiresAt)
    && Number.isFinite(Date.parse(record.capabilityExpiresAt))
    && Date.parse(record.capabilityExpiresAt) > Date.now();
}

/**
 * Creates a one-conversation callback capability and persists only its hash.
 * The raw 256-bit bearer is sent solely to Tavus in the callback URL and is
 * never written to the database, telemetry or an application response.
 * Binding is itself the atomic provider dispatch fence: the RPC stores the
 * hash exactly once and transitions `reserved -> provider_in_flight`. A
 * caller without the strict receipt must never call Tavus.
 */
export async function prepareTavusWebhookCallback(
  reservationId: string,
  serviceClient?: SupabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TavusWebhookCallbackCapability> {
  if (!UUID_V7_PATTERN.test(reservationId)) throw new TypeError("reservationId must be a UUIDv7");
  const publicOrigin = portalPublicOrigin(env);

  const capability = randomBytes(32).toString("base64url");
  const capabilityHash = createHash("sha256").update(capability).digest("hex");
  const supabase = serviceClient ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_bind_tavus_webhook_capability_service", {
    p_reservation_id: reservationId,
    p_capability_hash: capabilityHash,
  });
  if (error || !isStrictCapabilityReceipt(data)) {
    trackError("tavus_webhook_capability_bind_failed", error ?? new Error("capability binding receipt missing"), {});
    throw error ?? new Error("Tavus webhook capability binding receipt missing");
  }

  const query = new URLSearchParams({ reservationId, capability });
  return {
    callbackUrl: `${publicOrigin}/api/tavus/webhook?${query.toString()}`,
    capabilityHash,
    capabilityExpiresAt: data.capabilityExpiresAt,
  };
}

/**
 * Registra o placeholder (turns=[]) assim que a conversa/bot nasce.
 * Best-effort: nunca bloqueia nem atrasa a conversa em si — falha vira
 * telemetria; sem o placeholder, o webhook mais tarde só não vai achar a
 * linha (found=false, também telemetrado lá) e a conversa simplesmente
 * fica sem histórico registrado, nunca um erro visível pro usuário.
 */
export async function registerTranscriptPlaceholder(
  tenantId: string,
  agentId: string,
  surface: ProviderTranscriptSurface,
  externalRef: string,
  serviceClient?: SupabaseClient,
): Promise<boolean> {
  try {
    const supabase = serviceClient ?? createServiceRoleClient();
    const { error } = await supabase.rpc("portal_register_provider_transcript_service", {
      p_id: createUuidV7(),
      p_tenant_id: tenantId,
      p_agent_id: agentId,
      p_surface: surface,
      p_external_ref: externalRef,
    });
    if (error) {
      trackError("transcript_placeholder_register_failed", error, { tenant_id: tenantId, agent_id: agentId, surface, external_ref: externalRef });
      return false;
    }
    return true;
  } catch (error) {
    trackError("transcript_placeholder_register_failed", error, { tenant_id: tenantId, agent_id: agentId, surface, external_ref: externalRef });
    return false;
  }
}
