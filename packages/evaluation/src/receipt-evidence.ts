import { UUID_V7_PATTERN, canonicalJson, sha256Canonical } from "@axtro/domain";

export const COMMERCIAL_MILESTONES = ["lead_registered", "meeting_confirmed", "checkout_link_created", "payment_confirmed"] as const;
export type CommercialMilestone = typeof COMMERCIAL_MILESTONES[number];
export type EvidenceViolation = "tenant_mismatch" | "session_mismatch" | "conflicting_duplicate" | "missing_intent" | "tool_scope_mismatch" | "invalid_effect" | "invalid_result" | "missing_disclosure" | "missing_essential_consent";
export interface CloserReceiptEvidence {
  readonly schemaVersion: "1.0.0";
  readonly confirmedMilestones: readonly CommercialMilestone[];
  readonly ambiguousEffectCount: number;
  readonly criticalViolations: readonly EvidenceViolation[];
  readonly aiDisclosureDelivered: boolean;
  readonly activeConsentTypes: readonly string[];
  readonly paymentEvidenceAvailable: false;
  readonly uniqueReceiptCount: number;
}
export class ReceiptEvidenceError extends Error {
  constructor() { super("invalid bounded receipt evidence input"); this.name = "ReceiptEvidenceError"; }
}

const INTENT_KEYS = "schema_version intent_id session_id tenant_id actor_id actor_type tool_contract_id action arguments_json purpose idempotency_key requested_at expires_at".split(" ");
const RECEIPT_KEYS = "schema_version execution_id intent_id tenant_id status provider_id attempt result_json error effect_hash started_at completed_at".split(" ");
const DISCLOSURE_KEYS = "schema_version disclosure_id session_id tenant_id disclosure_type version content_hash delivery_channel language delivered_at acknowledged acknowledged_at".split(" ");
const CONSENT_KEYS = "schema_version consent_id session_id tenant_id subject_ref consent_type purpose status method disclosure_version jurisdiction evidence_hash captured_at expires_at revoked_at".split(" ");
const CONSENT_TYPES = ["essential_processing", "recording", "persistent_transcription", "behavioral_analysis", "emotion_inference", "biometric_identity", "marketing_contact", "data_retention"];
const ACTIONS = ["register_lead", "confirm_meeting_slot", "request_checkout"];

/** Read-only projection. Inputs must come from authenticated canonical storage, never model
 * annotations. Structural validation proves consistency, not storage authenticity. No I/O,
 * action execution, raw results, subject references, URLs or identifiers leave this boundary.
 * Portal bridge receipts have a different shape and require their own audited future adapter.
 * No canonical payment tool result exists here, so payment is deliberately unavailable. */
export function projectCloserReceiptEvidence(raw: unknown): CloserReceiptEvidence {
  try { return project(raw); } catch { throw new ReceiptEvidenceError(); }
}

function project(raw: unknown): CloserReceiptEvidence {
  const input = exact(raw, ["tenantId", "sessionId", "asOf", "subjectRef", "intents", "receipts", "disclosures", "consents"]);
  const tenantId = uuid(input.tenantId), sessionId = uuid(input.sessionId), asOf = time(input.asOf);
  const subjectRef = text(input.subjectRef, 300);
  const violations = new Set<EvidenceViolation>();
  const milestones = new Set<CommercialMilestone>();
  let budget = 0;
  const boundedList = (value: unknown): Record<string, unknown>[] => {
    if (!Array.isArray(value) || value.length > 128) bad();
    return value.map((entry) => {
      // Bound each serialized record before hashing and the total before projection.
      const record = object(entry);
      boundedTree(record);
      const serialized = canonicalJson(record);
      budget += serialized.length;
      if (serialized.length > 250_000 || budget > 2_000_000) bad();
      return record;
    });
  };
  const scoped = (record: Record<string, unknown>, session = true): boolean => {
    let valid = true;
    if (uuid(record.tenant_id) !== tenantId) { violations.add("tenant_mismatch"); valid = false; }
    if (session && uuid(record.session_id) !== sessionId) { violations.add("session_mismatch"); valid = false; }
    return valid;
  };
  const unique = (items: Record<string, unknown>[], idKey: string): Record<string, unknown>[] => {
    const byId = new Map<string, { fingerprint: string; value: Record<string, unknown> }>();
    for (const item of items) {
      const id = uuid(item[idKey]), fingerprint = sha256Canonical(item), previous = byId.get(id);
      if (previous && previous.fingerprint !== fingerprint) violations.add("conflicting_duplicate");
      else if (!previous) byId.set(id, { fingerprint, value: item });
    }
    return [...byId.values()].map((entry) => entry.value);
  };

  const intents = new Map<string, Record<string, unknown>>();
  for (const value of unique(boundedList(input.intents), "intent_id")) {
    const intent = exact(value, INTENT_KEYS);
    version(intent); uuid(intent.actor_id);
    enumeration(intent.actor_type, ["presenter", "specialist", "workflow", "human_operator", "axtro_agent"]);
    text(intent.tool_contract_id, 200); text(intent.action, 200); text(intent.purpose, 1000); text(intent.idempotency_key, 200, 16);
    object(json(intent.arguments_json, 100_000));
    if (time(intent.expires_at) <= time(intent.requested_at)) bad();
    if (scoped(intent)) intents.set(uuid(intent.intent_id), intent);
  }
  const proofDeadline = Math.min(asOf, ...[...intents.values()].map((intent) => time(intent.requested_at)));
  const receipts = unique(boundedList(input.receipts), "execution_id");
  const receiptByIntent = new Map<string, string>();
  for (const value of receipts) {
    const receipt = exact(value, RECEIPT_KEYS); version(receipt); uuid(receipt.intent_id);
    const status = enumeration(receipt.status, ["started", "succeeded", "failed", "pending", "unknown", "cancelled"]);
    text(receipt.provider_id, 120);
    integer(receipt.attempt, 1, 100);
    const started = time(receipt.started_at), completed = nullableTime(receipt.completed_at);
    if (started > asOf || (completed !== null && (completed < started || completed > asOf))) bad();
    if (receipt.result_json !== null) json(receipt.result_json, 200_000);
    if (receipt.effect_hash !== null) hash(receipt.effect_hash);
    if (receipt.error !== null) {
      const error = exact(receipt.error, ["code", "message", "retryable", "provider_code"]);
      text(error.code, 120); text(error.message, 1000); boolean(error.retryable);
      if (error.provider_code !== null) text(error.provider_code, 200);
    }
    if (!scoped(receipt, false)) continue;
    const identity = uuid(receipt.intent_id);
    const effect = canonicalJson([receipt.status, receipt.result_json, receipt.effect_hash]);
    const previousEffect = receiptByIntent.get(identity);
    if (previousEffect !== undefined && previousEffect !== effect) violations.add("conflicting_duplicate");
    else receiptByIntent.set(identity, effect);
    const intent = intents.get(uuid(receipt.intent_id));
    if (!intent) { violations.add("missing_intent"); continue; }
    if (started < time(intent.requested_at) || started >= time(intent.expires_at)) { violations.add("invalid_effect"); continue; }
    if (status !== "succeeded") {
      if (receipt.effect_hash !== null) violations.add("invalid_effect");
      continue;
    }
    if (receipt.error !== null || completed === null || receipt.result_json === null || receipt.effect_hash === null) { violations.add("invalid_effect"); continue; }
    const result = json(receipt.result_json, 200_000);
    if (sha256Canonical(result) !== receipt.effect_hash) { violations.add("invalid_effect"); continue; }
    if (!ACTIONS.includes(intent.action as string)) continue;
    // Exact recognized tool/action pairing; a model-supplied action name is not sufficient.
    if (intent.tool_contract_id !== intent.action) { violations.add("tool_scope_mismatch"); continue; }
    try {
      const milestone = recognizeResult(intent.action as string, result);
      if (milestone !== null) milestones.add(milestone);
    } catch { violations.add("invalid_result"); }
  }

  const disclosureVersions = new Map<string, number>();
  for (const value of unique(boundedList(input.disclosures), "disclosure_id")) {
    const disclosure = exact(value, DISCLOSURE_KEYS); version(disclosure);
    enumeration(disclosure.disclosure_type, ["ai_identity", "recording", "data_use", "regulated_scope", "marketing_contact"]);
    text(disclosure.version, 100); hash(disclosure.content_hash);
    enumeration(disclosure.delivery_channel, ["spoken", "visual", "chat", "email", "signed_document"]);
    if (typeof disclosure.language !== "string" || !/^[a-z]{2}(-[A-Z]{2})?$/.test(disclosure.language)) bad();
    boolean(disclosure.acknowledged);
    const delivered = time(disclosure.delivered_at), acknowledged = nullableTime(disclosure.acknowledged_at);
    if (acknowledged !== null && (acknowledged < delivered || acknowledged > asOf)) bad();
    if (disclosure.acknowledged !== (acknowledged !== null)) bad();
    if (scoped(disclosure) && delivered <= proofDeadline && disclosure.disclosure_type === "ai_identity") disclosureVersions.set(disclosure.version as string, Math.min(disclosureVersions.get(disclosure.version as string) ?? delivered, delivered));
  }
  const consentBySubjectPurpose = new Map<string, Record<string, unknown>>();
  for (const value of unique(boundedList(input.consents), "consent_id")) {
    const consent = exact(value, CONSENT_KEYS); version(consent); text(consent.subject_ref, 300); text(consent.purpose, 1000);
    enumeration(consent.consent_type, CONSENT_TYPES); enumeration(consent.status, ["granted", "denied", "revoked", "expired"]);
    enumeration(consent.method, ["spoken", "click", "written", "signed", "system_import"]);
    text(consent.disclosure_version, 100); text(consent.jurisdiction, 120, 2); hash(consent.evidence_hash);
    const captured = time(consent.captured_at), expires = nullableTime(consent.expires_at), revoked = nullableTime(consent.revoked_at);
    if (expires !== null && expires <= captured) bad();
    if (revoked !== null && revoked < captured) bad();
    if (scoped(consent) && consent.subject_ref === subjectRef && captured <= asOf) {
      const key = canonicalJson([consent.subject_ref, consent.consent_type, consent.purpose]);
      const previous = consentBySubjectPurpose.get(key);
      if (!previous || time(previous.captured_at) < captured) consentBySubjectPurpose.set(key, consent);
      else if (time(previous.captured_at) === captured && canonicalJson(previous) !== canonicalJson(consent)) violations.add("conflicting_duplicate");
    }
  }
  const activeConsentTypes = new Set<string>();
  const essentialPurposes = new Set<string>();
  for (const consent of consentBySubjectPurpose.values()) {
    const expires = nullableTime(consent.expires_at), revoked = nullableTime(consent.revoked_at);
    if (consent.status === "granted" && time(consent.captured_at) <= proofDeadline && (expires === null || expires > asOf) && (revoked === null || revoked > asOf) && disclosureVersions.has(consent.disclosure_version as string) && disclosureVersions.get(consent.disclosure_version as string)! <= time(consent.captured_at)) {
      activeConsentTypes.add(consent.consent_type as string);
      if (consent.consent_type === "essential_processing") essentialPurposes.add(consent.purpose as string);
    }
  }
  if ([...intents.values()].some((intent) => !essentialPurposes.has(intent.purpose as string))) activeConsentTypes.delete("essential_processing");
  if (disclosureVersions.size === 0) violations.add("missing_disclosure");
  if (!activeConsentTypes.has("essential_processing")) violations.add("missing_essential_consent");
  return Object.freeze({ schemaVersion: "1.0.0", confirmedMilestones: Object.freeze(violations.size ? [] : COMMERCIAL_MILESTONES.filter((item) => milestones.has(item))), ambiguousEffectCount: receipts.filter((receipt) => ["started", "pending", "unknown"].includes(receipt.status as string)).length, criticalViolations: Object.freeze([...violations].sort()), aiDisclosureDelivered: disclosureVersions.size > 0, activeConsentTypes: Object.freeze([...activeConsentTypes].sort()), paymentEvidenceAvailable: false, uniqueReceiptCount: receipts.length });
}

function recognizeResult(action: string, raw: unknown): CommercialMilestone | null {
  // Existing RegisterBusinessLeadResult, DispatchMeetingReservationResult and
  // CheckoutIntentResult shapes. Reservation/approval success never proves dispatch.
  const value = object(raw);
  if (action === "register_lead") {
    exact(value, ["outcome", "code", "leadId"]);
    if (value.outcome !== "registered" || value.code !== "registered") bad();
    uuid(value.leadId); return "lead_registered";
  }
  if (action === "confirm_meeting_slot") {
    if (value.outcome === "already_committed") { exact(value, ["outcome"]); return "meeting_confirmed"; }
    if (value.outcome === "reserved") {
      exact(value, ["outcome", "code", "reservationId", "googleEventId", "googleCalendarId", "startAt", "endAt", "timezone"]);
      if (value.code !== "reserved") bad(); uuid(value.reservationId); text(value.googleEventId, 1024);
      if (value.googleCalendarId !== null) text(value.googleCalendarId, 1024);
      text(value.timezone, 120); if (time(value.endAt) <= time(value.startAt)) bad();
      return null;
    }
    if (value.outcome === "replayed") {
      exact(value, ["outcome", "code", "reservationId", "state", "googleEventId"]);
      if (value.code !== "replayed") bad(); uuid(value.reservationId);
      enumeration(value.state, ["reserved", "provider_in_flight", "committed", "completed", "unknown", "released"]);
      if (value.googleEventId !== null) text(value.googleEventId, 1024);
      return null;
    }
    exact(value, ["outcome", "reservationId", "googleEventId", "startAt", "endAt", "timezone"]);
    if (value.outcome !== "committed") bad();
    uuid(value.reservationId); text(value.googleEventId, 1024); text(value.timezone, 120);
    if (time(value.endAt) <= time(value.startAt)) bad();
    return "meeting_confirmed";
  }
  if (value.outcome === "pending_approval") {
    exact(value, ["outcome", "code", "reservationId", "receiptId", "approvalExpiresAt"]);
    if (value.code !== "pending_approval") bad(); uuid(value.reservationId); uuid(value.receiptId); time(value.approvalExpiresAt);
    return null;
  }
  exact(value, ["status", "checkoutUrl", "checkoutIntentId"]);
  if (value.status !== "ready") bad(); uuid(value.checkoutIntentId);
  const url = new URL(text(value.checkoutUrl, 2000));
  if (url.protocol !== "https:" || url.username || url.password) bad();
  return "checkout_link_created";
}

function bad(): never { throw new ReceiptEvidenceError(); }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) bad();
  return value as Record<string, unknown>;
}
function exact(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  const value = object(raw), actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) bad();
  return value;
}
function text(value: unknown, max: number, min = 1): string {
  if (typeof value !== "string" || value.length < min || value.length > max) bad(); return value;
}
function uuid(value: unknown): string { const id = text(value, 36); if (!UUID_V7_PATTERN.test(id)) bad(); return id; }
function hash(value: unknown): void { if (!/^[0-9a-f]{64}$/.test(text(value, 64))) bad(); }
function version(value: Record<string, unknown>): void { if (value.schema_version !== "2.0.0") bad(); }
function enumeration(value: unknown, values: readonly string[]): string { const item = text(value, 200); if (!values.includes(item)) bad(); return item; }
function boolean(value: unknown): void { if (typeof value !== "boolean") bad(); }
function integer(value: unknown, min: number, max: number): void { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) bad(); }
function time(value: unknown): number {
  const date = text(value, 40);
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?Z$/.exec(date);
  if (!match) bad();
  const ms = Date.parse(date);
  const expected = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== expected) bad();
  return ms;
}
function nullableTime(value: unknown): number | null { return value === null ? null : time(value); }
function boundedTree(value: unknown, depth = 0, counter = { nodes: 0 }): void {
  if (++counter.nodes > 2048 || depth > 16) bad();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { if (value.length > 250_000) bad(); return; }
  if (typeof value === "number") { if (!Number.isFinite(value)) bad(); return; }
  for (const child of Object.values(Array.isArray(value) ? value : object(value))) boundedTree(child, depth + 1, counter);
}
function json(value: unknown, max: number): unknown { const serialized = text(value, max, 2); const parsed: unknown = JSON.parse(serialized); boundedTree(parsed); return parsed; }
