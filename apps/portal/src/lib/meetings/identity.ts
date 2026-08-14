import { createHash } from "node:crypto";

import { parseUuidV7, uuidV7FromParts, type UuidV7 } from "@axtro/domain";

import { isPaidEffectCommandId } from "../paid-effects/index.ts";

const MAX_UUID_V7_TIMESTAMP = 0xffffffffffff;

/**
 * A meeting-session row is the durable receipt for one server-authorized
 * command. Provider retries must propose the same row identity, while an
 * attacker in another tenant must not be able to preclaim it by copying the
 * browser-visible command UUID.
 *
 * commandId is browser-generated via crypto.randomUUID() (UUIDv4), so it has
 * no embedded UUIDv7 timestamp to reuse. The app.uuid_v7 DB column still
 * requires a syntactically valid v7 value, so both the timestamp and the
 * entropy fields are derived from the same hash, keeping the result fully
 * deterministic (same inputs always produce the same id) without depending
 * on wall-clock time. The colon separators are safe because tenant/agent
 * ids and the lowercased commandId are all fixed-length UUID strings.
 */
export function deriveMeetingSessionId(
  tenantId: string,
  agentId: string,
  commandId: string,
): UuidV7 {
  const tenant = parseUuidV7(tenantId, "tenant_id");
  const agent = parseUuidV7(agentId, "agent_id");
  if (!isPaidEffectCommandId(commandId)) throw new Error("meeting commandId must be a UUID");
  const digest = createHash("sha256")
    .update("axtro:meeting-session:v1:")
    .update(tenant)
    .update(":")
    .update(agent)
    .update(":")
    .update(commandId.toLowerCase())
    .digest();
  const timestampMs = digest.subarray(0, 6).readUIntBE(0, 6) % (MAX_UUID_V7_TIMESTAMP + 1);
  const entropy = digest.subarray(6, 16);
  return uuidV7FromParts(timestampMs, entropy);
}
