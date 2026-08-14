import { createHash } from "node:crypto";

import { parseUuidV7, uuidV7FromParts, uuidV7Timestamp, type UuidV7 } from "@axtro/domain";

/**
 * A meeting-session row is the durable receipt for one server-authorized
 * command. Provider retries must propose the same row identity, while an
 * attacker in another tenant must not be able to preclaim it by copying the
 * browser-visible command UUID.
 */
export function deriveMeetingSessionId(
  tenantId: string,
  agentId: string,
  commandId: string,
): UuidV7 {
  const tenant = parseUuidV7(tenantId, "tenant_id");
  const agent = parseUuidV7(agentId, "agent_id");
  const command = parseUuidV7(commandId, "command_id");
  const entropy = createHash("sha256")
    .update("axtro:meeting-session:v1\u001f")
    .update(tenant)
    .update("\u001f")
    .update(agent)
    .update("\u001f")
    .update(command)
    .digest()
    .subarray(0, 10);
  return uuidV7FromParts(uuidV7Timestamp(command), entropy);
}
