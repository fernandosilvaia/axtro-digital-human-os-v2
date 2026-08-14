export interface MeetingSessionReceipt {
  readonly ok: true;
  readonly terminal: boolean;
  readonly status: "created" | "ended" | "failed";
  readonly cameraState: "not_requested" | "conversation_created";
  readonly tavusCleanupRequired: boolean;
  readonly tavusConversationId: string | null;
  readonly tavusReservationId: string | null;
}

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

/** Strict contract for the service-role meeting persistence receipt. */
export function parseMeetingSessionReceipt(value: unknown): MeetingSessionReceipt {
  const record = ownRecord(value);
  const expectedKeys = [
    "cameraState",
    "ok",
    "status",
    "tavusCleanupRequired",
    "tavusConversationId",
    "tavusReservationId",
    "terminal",
  ];
  if (!record || Object.keys(record).sort().join("\u001f") !== expectedKeys.join("\u001f")) {
    throw new Error("meeting bot session returned an invalid receipt shape");
  }
  const terminal = record.terminal;
  const status = record.status;
  const cameraState = record.cameraState;
  const cleanupRequired = record.tavusCleanupRequired;
  const conversationId = record.tavusConversationId;
  const reservationId = record.tavusReservationId;
  if (
    record.ok !== true
    || typeof terminal !== "boolean"
    || (status !== "created" && status !== "ended" && status !== "failed")
    || (cameraState !== "not_requested" && cameraState !== "conversation_created")
    || typeof cleanupRequired !== "boolean"
    || (conversationId !== null && typeof conversationId !== "string")
    || (reservationId !== null && typeof reservationId !== "string")
    || (terminal !== (status === "ended" || status === "failed"))
    || (cleanupRequired && (!terminal || conversationId === null || reservationId === null))
  ) {
    throw new Error("meeting bot session returned an invalid receipt");
  }
  return Object.freeze({
    ok: true,
    terminal,
    status,
    cameraState,
    tavusCleanupRequired: cleanupRequired,
    tavusConversationId: conversationId,
    tavusReservationId: reservationId,
  });
}
