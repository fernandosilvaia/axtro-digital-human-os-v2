/**
 * M3-03: tenant-scoped, read-only CRM adapter. No write capability exists in
 * this package at all — structural enforcement, not a permission check.
 * Every read is audited with requester, purpose, and which fields (PII or
 * not) were actually granted vs. denied.
 */
export type CrmRecordType = "lead" | "opportunity";
export type CrmPurpose = "sales_qualification" | "proposal_preparation" | "handoff_context";

export interface CrmFieldDescriptor {
  readonly field: string;
  readonly pii: boolean;
}

/** Purposes that may see PII fields. Everything else only ever sees non-PII fields. */
const PII_ALLOWED_PURPOSES: readonly CrmPurpose[] = ["proposal_preparation", "handoff_context"];

export const LEAD_FIELDS: readonly CrmFieldDescriptor[] = Object.freeze([
  { field: "company_name", pii: false },
  { field: "stage", pii: false },
  { field: "owner_name", pii: false },
  { field: "source", pii: false },
  { field: "contact_email", pii: true },
  { field: "contact_phone", pii: true },
  { field: "notes", pii: true },
]);

export const OPPORTUNITY_FIELDS: readonly CrmFieldDescriptor[] = Object.freeze([
  { field: "account_name", pii: false },
  { field: "stage", pii: false },
  { field: "amount_usd", pii: false },
  { field: "close_date", pii: false },
  { field: "owner_name", pii: false },
  { field: "decision_maker_email", pii: true },
  { field: "decision_maker_phone", pii: true },
]);

const FIELDS_BY_RECORD_TYPE: Readonly<Record<CrmRecordType, readonly CrmFieldDescriptor[]>> = Object.freeze({
  lead: LEAD_FIELDS,
  opportunity: OPPORTUNITY_FIELDS,
});

export interface CrmRecord {
  readonly recordType: CrmRecordType;
  readonly recordRef: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface CrmDataSource {
  fetch(recordType: CrmRecordType, recordRef: string, signal: AbortSignal): Promise<CrmRecord | null>;
}

export interface CrmLiteReadRequest {
  readonly tenantId: string;
  readonly requesterActorId: string;
  readonly purpose: CrmPurpose;
  readonly recordType: CrmRecordType;
  readonly recordRef: string;
  readonly requestedFields: readonly string[];
  readonly deadlineMs: number;
}

export type CrmLiteReadStatus = "completed" | "denied_pii_purpose" | "denied_unknown_field" | "not_found" | "timeout";

export interface CrmLiteReadResult {
  readonly status: CrmLiteReadStatus;
  readonly recordRef: string;
  readonly fields: Readonly<Record<string, unknown>> | null;
  readonly grantedFields: readonly string[];
  readonly deniedFields: readonly string[];
  readonly auditId: string;
}

export interface CrmAuditEntry {
  readonly auditId: string;
  readonly tenantId: string;
  readonly requesterActorId: string;
  readonly purpose: CrmPurpose;
  readonly recordType: CrmRecordType;
  readonly recordRef: string;
  readonly requestedFields: readonly string[];
  readonly grantedFields: readonly string[];
  readonly deniedFields: readonly string[];
  readonly status: CrmLiteReadStatus;
  readonly atMs: number;
}

export interface CrmLiteReadPort {
  read(rawRequest: unknown): Promise<CrmLiteReadResult>;
  auditLog(tenantId: unknown): readonly CrmAuditEntry[];
}

export class CrmLiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmLiteError";
  }
}

export interface CrmLiteScheduler {
  wait(ms: number, signal: AbortSignal): Promise<void>;
}

export interface CrmLiteClock {
  now(): number;
}

const realScheduler: CrmLiteScheduler = Object.freeze({
  wait(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new Error("aborted"));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
    });
  },
});
const systemClock: CrmLiteClock = Object.freeze({ now: () => Date.now() });

const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECORD_TYPES: readonly CrmRecordType[] = ["lead", "opportunity"];
const PURPOSES: readonly CrmPurpose[] = ["sales_qualification", "proposal_preparation", "handoff_context"];
let auditSequence = 0;

export interface CreateCrmLiteReadPortOptions {
  readonly scheduler?: CrmLiteScheduler;
  readonly clock?: CrmLiteClock;
}

export function createCrmLiteReadPort(dataSource: CrmDataSource, options: CreateCrmLiteReadPortOptions = {}): CrmLiteReadPort {
  const scheduler = options.scheduler ?? realScheduler;
  const clock = options.clock ?? systemClock;
  const auditByTenant = new Map<string, CrmAuditEntry[]>();

  const recordAudit = (entry: Omit<CrmAuditEntry, "auditId" | "atMs">): CrmAuditEntry => {
    auditSequence += 1;
    const full: CrmAuditEntry = Object.freeze({ ...entry, auditId: `crm-audit-${auditSequence}`, atMs: clock.now() });
    const list = auditByTenant.get(entry.tenantId) ?? [];
    list.push(full);
    auditByTenant.set(entry.tenantId, list);
    return full;
  };

  return Object.freeze({
    async read(rawRequest: unknown): Promise<CrmLiteReadResult> {
      const request = parseReadRequest(rawRequest);
      const knownFields = FIELDS_BY_RECORD_TYPE[request.recordType];
      const piiAllowed = PII_ALLOWED_PURPOSES.includes(request.purpose);

      const grantedFields: string[] = [];
      const deniedFields: string[] = [];
      let anyPiiDenied = false;
      let anyUnknown = false;
      for (const field of request.requestedFields) {
        const descriptor = knownFields.find((candidate) => candidate.field === field);
        if (descriptor === undefined) {
          deniedFields.push(field);
          anyUnknown = true;
          continue;
        }
        if (descriptor.pii && !piiAllowed) {
          deniedFields.push(field);
          anyPiiDenied = true;
          continue;
        }
        grantedFields.push(field);
      }

      const controller = new AbortController();
      const outcome = await Promise.race([
        dataSource.fetch(request.recordType, request.recordRef, controller.signal).then((record) => ({ kind: "fetched" as const, record })),
        scheduler.wait(request.deadlineMs, controller.signal).then(() => ({ kind: "timeout" as const })),
      ]).catch(() => ({ kind: "timeout" as const }));
      controller.abort("settled");

      if (outcome.kind === "timeout") {
        const audit = recordAudit({
          tenantId: request.tenantId,
          requesterActorId: request.requesterActorId,
          purpose: request.purpose,
          recordType: request.recordType,
          recordRef: request.recordRef,
          requestedFields: request.requestedFields,
          grantedFields: [],
          deniedFields: request.requestedFields,
          status: "timeout",
        });
        return Object.freeze({ status: "timeout", recordRef: request.recordRef, fields: null, grantedFields: [], deniedFields: request.requestedFields, auditId: audit.auditId });
      }

      if (outcome.record === null) {
        const audit = recordAudit({
          tenantId: request.tenantId,
          requesterActorId: request.requesterActorId,
          purpose: request.purpose,
          recordType: request.recordType,
          recordRef: request.recordRef,
          requestedFields: request.requestedFields,
          grantedFields: [],
          deniedFields: request.requestedFields,
          status: "not_found",
        });
        return Object.freeze({ status: "not_found", recordRef: request.recordRef, fields: null, grantedFields: [], deniedFields: request.requestedFields, auditId: audit.auditId });
      }

      const status: CrmLiteReadStatus =
        grantedFields.length > 0 ? "completed" : (anyPiiDenied && !anyUnknown ? "denied_pii_purpose" : "denied_unknown_field");
      const fields = grantedFields.length > 0
        ? Object.freeze(Object.fromEntries(grantedFields.map((field) => [field, outcome.record!.fields[field]])))
        : null;
      const audit = recordAudit({
        tenantId: request.tenantId,
        requesterActorId: request.requesterActorId,
        purpose: request.purpose,
        recordType: request.recordType,
        recordRef: request.recordRef,
        requestedFields: request.requestedFields,
        grantedFields: Object.freeze([...grantedFields]),
        deniedFields: Object.freeze([...deniedFields]),
        status,
      });
      return Object.freeze({
        status,
        recordRef: request.recordRef,
        fields,
        grantedFields: Object.freeze([...grantedFields]),
        deniedFields: Object.freeze([...deniedFields]),
        auditId: audit.auditId,
      });
    },

    auditLog(rawTenantId: unknown): readonly CrmAuditEntry[] {
      const tenantId = parseTenantId(rawTenantId);
      return Object.freeze([...(auditByTenant.get(tenantId) ?? [])]);
    },
  });
}

function parseTenantId(value: unknown): string {
  if (typeof value !== "string" || !TENANT_ID_PATTERN.test(value)) throw new CrmLiteError("invalid tenantId");
  return value;
}

function parseReadRequest(value: unknown): CrmLiteReadRequest {
  if (value === null || typeof value !== "object") throw new CrmLiteError("invalid read request");
  const record = value as Record<string, unknown>;
  const tenantId = parseTenantId(record.tenantId);
  if (typeof record.requesterActorId !== "string" || record.requesterActorId.length === 0) throw new CrmLiteError("invalid requesterActorId");
  if (typeof record.purpose !== "string" || !PURPOSES.includes(record.purpose as CrmPurpose)) throw new CrmLiteError("invalid purpose");
  if (typeof record.recordType !== "string" || !RECORD_TYPES.includes(record.recordType as CrmRecordType)) throw new CrmLiteError("invalid recordType");
  if (typeof record.recordRef !== "string" || record.recordRef.length === 0 || record.recordRef.length > 200) throw new CrmLiteError("invalid recordRef");
  if (!Array.isArray(record.requestedFields) || record.requestedFields.length === 0 || record.requestedFields.length > 50) {
    throw new CrmLiteError("invalid requestedFields");
  }
  const requestedFields = record.requestedFields.map((field, index) => {
    if (typeof field !== "string" || field.length === 0) throw new CrmLiteError(`invalid requestedFields[${index}]`);
    return field;
  });
  if (new Set(requestedFields).size !== requestedFields.length) throw new CrmLiteError("requestedFields cannot repeat a field");
  if (typeof record.deadlineMs !== "number" || !Number.isFinite(record.deadlineMs) || record.deadlineMs <= 0 || record.deadlineMs > 60_000) {
    throw new CrmLiteError("invalid deadlineMs");
  }
  return Object.freeze({
    tenantId,
    requesterActorId: record.requesterActorId,
    purpose: record.purpose as CrmPurpose,
    recordType: record.recordType as CrmRecordType,
    recordRef: record.recordRef,
    requestedFields: Object.freeze(requestedFields),
    deadlineMs: record.deadlineMs,
  });
}
