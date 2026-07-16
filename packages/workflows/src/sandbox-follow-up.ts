/**
 * M3-07: draft a follow-up (email/tasks) tied to session evidence, never
 * sending externally unless a separate approval path is explicitly enabled.
 * This is a standalone, additive module — it does not reuse or modify the
 * M1-08 post-call workflow engine above it in this file, to avoid touching
 * that already-frozen checkpointed machinery.
 */
export interface FollowUpEvidence {
  readonly summary: string;
  readonly confirmedFactIds: readonly string[];
  readonly openActions: readonly string[];
  readonly receiptIds: readonly string[];
}

export interface FollowUpDraftInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly evidence: FollowUpEvidence;
  readonly approvalPathEnabled?: boolean;
}

export interface FollowUpDraftContent {
  readonly subject: string;
  readonly bodyReferences: readonly string[];
}

export interface FollowUpDraftGenerator {
  generate(evidence: FollowUpEvidence): Promise<FollowUpDraftContent>;
}

export interface FollowUpDraft {
  readonly draftId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly subject: string;
  readonly bodyReferences: readonly string[];
}

export interface FollowUpSendSink {
  send(draft: FollowUpDraft): Promise<{ readonly externalRef: string }>;
}

export type FollowUpWorkflowStatus = "drafted" | "send_denied_sandbox" | "sent";

export interface FollowUpWorkflowResult {
  readonly status: FollowUpWorkflowStatus;
  readonly draft: FollowUpDraft;
  readonly attempts: number;
  readonly externalRef: string | null;
}

export class SandboxFollowUpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxFollowUpError";
  }
}

export interface SandboxFollowUpWorkflow {
  run(rawInput: unknown): Promise<FollowUpWorkflowResult>;
  attemptsFor(tenantId: string, idempotencyKey: string): number;
}

const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let draftSequence = 0;

export function createSandboxFollowUpWorkflow(generator: FollowUpDraftGenerator, sendSink: FollowUpSendSink): SandboxFollowUpWorkflow {
  const completed = new Map<string, FollowUpWorkflowResult>();
  const attemptCounts = new Map<string, number>();

  const idempotencyId = (tenantId: string, idempotencyKey: string): string => `${tenantId}:${idempotencyKey}`;

  return Object.freeze({
    async run(rawInput: unknown): Promise<FollowUpWorkflowResult> {
      const input = parseInput(rawInput);
      const key = idempotencyId(input.tenantId, input.idempotencyKey);

      // Duplicate completion: an already-resolved run returns the exact same
      // result and never regenerates the draft or re-sends anything.
      const existing = completed.get(key);
      if (existing !== undefined) return existing;

      attemptCounts.set(key, (attemptCounts.get(key) ?? 0) + 1);
      // A transient failure here propagates to the caller uncaught — the
      // attempt counter already advanced, so a subsequent run() with the
      // same idempotencyKey is a real retry, not a fresh attempt.
      const content = await generator.generate(input.evidence);

      draftSequence += 1;
      const draft: FollowUpDraft = Object.freeze({
        draftId: `follow-up-draft-${draftSequence}`,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        subject: content.subject,
        bodyReferences: Object.freeze([...content.bodyReferences]),
      });

      let result: FollowUpWorkflowResult;
      if (input.approvalPathEnabled === true) {
        const sent = await sendSink.send(draft);
        result = Object.freeze({ status: "sent", draft, attempts: attemptCounts.get(key)!, externalRef: sent.externalRef });
      } else {
        result = Object.freeze({ status: "send_denied_sandbox", draft, attempts: attemptCounts.get(key)!, externalRef: null });
      }
      completed.set(key, result);
      return result;
    },

    attemptsFor(tenantId: string, idempotencyKeyValue: string): number {
      return attemptCounts.get(idempotencyId(tenantId, idempotencyKeyValue)) ?? 0;
    },
  });
}

function parseTenantId(value: unknown): string {
  if (typeof value !== "string" || !TENANT_ID_PATTERN.test(value)) throw new SandboxFollowUpError("invalid tenantId");
  return value;
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) throw new SandboxFollowUpError(`invalid ${label}`);
  return value;
}

function parseStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new SandboxFollowUpError(`invalid ${label}`);
  return value.map((item, index) => parseNonEmptyString(item, `${label}[${index}]`));
}

function parseEvidence(value: unknown): FollowUpEvidence {
  if (value === null || typeof value !== "object") throw new SandboxFollowUpError("invalid evidence");
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string" || record.summary.length === 0 || record.summary.length > 5_000) {
    throw new SandboxFollowUpError("invalid evidence.summary");
  }
  return Object.freeze({
    summary: record.summary,
    confirmedFactIds: Object.freeze(parseStringArray(record.confirmedFactIds, "evidence.confirmedFactIds")),
    openActions: Object.freeze(parseStringArray(record.openActions, "evidence.openActions")),
    receiptIds: Object.freeze(parseStringArray(record.receiptIds, "evidence.receiptIds")),
  });
}

function parseInput(value: unknown): FollowUpDraftInput {
  if (value === null || typeof value !== "object") throw new SandboxFollowUpError("invalid follow-up input");
  const record = value as Record<string, unknown>;
  if (record.approvalPathEnabled !== undefined && typeof record.approvalPathEnabled !== "boolean") {
    throw new SandboxFollowUpError("invalid approvalPathEnabled");
  }
  return Object.freeze({
    tenantId: parseTenantId(record.tenantId),
    sessionId: parseNonEmptyString(record.sessionId, "sessionId"),
    idempotencyKey: parseNonEmptyString(record.idempotencyKey, "idempotencyKey"),
    evidence: parseEvidence(record.evidence),
    ...(record.approvalPathEnabled === undefined ? {} : { approvalPathEnabled: record.approvalPathEnabled as boolean }),
  });
}
