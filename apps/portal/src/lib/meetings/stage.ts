import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { portalPublicOrigin } from "../public-origin.ts";
import { createServiceRoleClient } from "../supabase/service.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGE_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const ALLOWED_ROOM_HOSTS = new Set(["tavus.daily.co"]);

export interface PrepareAgentFaceStageInput {
  readonly tenantId: string;
  readonly agentId: string;
  readonly reservationId: string;
  readonly roomUrl: string;
}

export interface PreparedAgentFaceStage {
  readonly stageUrl: string;
  readonly expiresAt: string;
}

export interface ResolvedAgentFaceStage {
  readonly roomUrl: string;
  readonly expiresAt: string;
}

function isAllowedRoomUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username.length === 0
      && url.password.length === 0
      && url.hash.length === 0
      && ALLOWED_ROOM_HOSTS.has(url.hostname)
      && url.port.length === 0;
  } catch {
    return false;
  }
}

/**
 * Builds the public stage URL from a short, random capability. The room URL
 * is never accepted here, which makes accidental reintroduction of
 * `/rosto-agente?sala=<room bearer>` fail closed.
 */
export function agentFaceStageUrl(
  capability: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!STAGE_CAPABILITY_PATTERN.test(capability)) throw new TypeError("invalid stage capability");
  return `${portalPublicOrigin(env)}/rosto-agente?cap=${capability}`;
}

/**
 * Creates a 192-bit stage capability and persists only its SHA-256 hash.
 * PostgreSQL owns the fixed TTL and tenant/reservation binding; callers must
 * receive the strict receipt before exposing the opaque stage URL to Recall.
 */
export async function prepareAgentFaceStage(
  input: PrepareAgentFaceStageInput,
  serviceClient?: SupabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PreparedAgentFaceStage> {
  if (!UUID_PATTERN.test(input.tenantId)) throw new TypeError("tenantId must be a UUID");
  if (!UUID_PATTERN.test(input.agentId)) throw new TypeError("agentId must be a UUID");
  if (!UUID_V7_PATTERN.test(input.reservationId)) throw new TypeError("reservationId must be a UUIDv7");
  if (!isAllowedRoomUrl(input.roomUrl)) throw new TypeError("roomUrl must be an allowed Tavus room URL");
  const publicOrigin = portalPublicOrigin(env);

  const capability = randomBytes(24).toString("base64url");
  const stageUrl = `${publicOrigin}/rosto-agente?cap=${capability}`;
  const tokenHash = createHash("sha256").update(capability).digest("hex");
  const supabase = serviceClient ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_create_tavus_stage_capability_service", {
    p_tenant_id: input.tenantId,
    p_agent_id: input.agentId,
    p_reservation_id: input.reservationId,
    p_token_hash: tokenHash,
    p_room_url: input.roomUrl,
  });
  const receipt = data as { created?: unknown; expiresAt?: unknown } | null;
  if (error || receipt?.created !== true || typeof receipt.expiresAt !== "string" || !Number.isFinite(Date.parse(receipt.expiresAt))) {
    throw new Error(`stage capability persistence failed: ${error?.message ?? "strict receipt missing"}`);
  }
  return Object.freeze({ stageUrl, expiresAt: receipt.expiresAt });
}

/** Resolves an opaque public capability server-side; raw room URLs never enter request URLs or logs. */
export async function resolveAgentFaceStageCapability(
  capability: string,
  serviceClient?: SupabaseClient,
): Promise<ResolvedAgentFaceStage | null> {
  if (!STAGE_CAPABILITY_PATTERN.test(capability)) return null;
  const tokenHash = createHash("sha256").update(capability).digest("hex");
  const supabase = serviceClient ?? createServiceRoleClient();
  const { data, error } = await supabase.rpc("portal_resolve_tavus_stage_capability_service", { p_token_hash: tokenHash });
  if (error) throw new Error(`stage capability resolution failed: ${error.message}`);
  const receipt = data as { found?: unknown; roomUrl?: unknown; expiresAt?: unknown } | null;
  if (receipt?.found !== true) return null;
  if (typeof receipt.roomUrl !== "string" || !isAllowedRoomUrl(receipt.roomUrl)) return null;
  if (typeof receipt.expiresAt !== "string" || !Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= Date.now()) return null;
  return Object.freeze({ roomUrl: receipt.roomUrl, expiresAt: receipt.expiresAt });
}
