import { getAuthorizedTenantContext, type AuthorizedRequestContext } from "@axtro/auth";
import type { CostEvent } from "@axtro/contracts-ts";
import { createDeterministicTransactionCoordinator, type TransactionalStateParticipant } from "@axtro/database";
import { assertTenantMatch, parseTenantId, parseUuidV7, type TenantContext, type TenantId, type UuidV7 } from "@axtro/domain";

declare const costRateCardBrand: unique symbol;
declare const providerRequestReferenceBrand: unique symbol;

export type CostRateCard = object & { readonly [costRateCardBrand]: "CostRateCard" };
export type ProviderRequestReference = object & { readonly [providerRequestReferenceBrand]: "ProviderRequestReference" };
export type CostSource = CostEvent["source"];
export type CostUnit = CostEvent["unit_type"];
export type CostLedgerFaultPoint = "after_cost_event_insert" | "before_commit";

export interface CostRateCardInput {
  readonly rate_card_ref: unknown;
  readonly rate_card_as_of: unknown;
  readonly provider_id: unknown;
  readonly service: unknown;
  readonly unit_type: unknown;
  /** Runtime configuration may preserve decimal input as a string. */
  readonly unit_cost_usd: unknown;
}

export interface CostAttributionAuthority {
  issueRateCard(input: CostRateCardInput): CostRateCard;
  issueProviderRequestReference(input: ProviderRequestReferenceInput): ProviderRequestReference;
}

/** Trusted operation binding supplied by the application after session authorization. */
export interface ProviderRequestReferenceInput {
  readonly rate_card: CostRateCard;
  readonly tenant_id: unknown;
  readonly session_id: unknown;
}

/**
 * Write input is intentionally narrower than the JSON contract. The caller
 * supplies only usage and trusted opaque capabilities. Provider, service,
 * price, and local request references are derived from those capabilities.
 */
export interface CostLedgerWriteInput {
  readonly cost_event_id: unknown;
  readonly tenant_id: unknown;
  readonly session_id: unknown;
  readonly source: unknown;
  readonly quantity: unknown;
  readonly occurred_at: unknown;
  readonly trace_id: unknown;
  readonly rate_card: CostRateCard;
  readonly provider_request: ProviderRequestReference;
  readonly reconciles_cost_event_id?: unknown;
  /** Optional assertion from a trusted caller, never the source of truth. */
  readonly declared_amount_usd?: unknown;
}

export interface CostLedgerFilter {
  readonly session_id?: unknown;
  readonly provider_id?: unknown;
  readonly service?: unknown;
}

export interface CostLedgerRecord {
  readonly event: Readonly<CostEvent>;
  readonly quantity_decimal: string;
  readonly unit_cost_usd_decimal: string;
  readonly amount_usd_decimal: string;
}

export interface CostAggregateBucket {
  readonly source: CostSource;
  readonly provider_id: string;
  readonly service: string;
  readonly unit_type: CostUnit;
  readonly event_count: number;
  readonly quantity_decimal: string;
  readonly amount_usd_decimal: string;
}

export interface CostReconciliation {
  readonly estimated_cost_event_id: UuidV7;
  readonly estimated_amount_usd_decimal: string;
  readonly measured_amount_usd_decimal: string | null;
  readonly provider_reported_amount_usd_decimal: string | null;
  readonly measured_variance_usd_decimal: string | null;
  readonly provider_reported_variance_usd_decimal: string | null;
}

export interface CostLedgerAggregation {
  readonly tenant_id: TenantId;
  readonly session_id: UuidV7 | null;
  readonly buckets: readonly CostAggregateBucket[];
  readonly reconciliations: readonly CostReconciliation[];
}

export interface DeterministicCostLedgerOptions {
  readonly faultPoints?: readonly CostLedgerFaultPoint[];
}

export interface DeterministicCostLedger {
  record(request: AuthorizedRequestContext, input: CostLedgerWriteInput | unknown): CostLedgerRecord;
  get(request: AuthorizedRequestContext, costEventId: unknown): CostLedgerRecord | null;
  list(request: AuthorizedRequestContext, filter?: CostLedgerFilter | unknown): readonly CostLedgerRecord[];
  aggregate(request: AuthorizedRequestContext, filter?: CostLedgerFilter | unknown): CostLedgerAggregation;
}

export class CostLedgerValidationError extends Error {
  constructor(message = "Cost ledger input is invalid") {
    super(message);
    this.name = "CostLedgerValidationError";
  }
}

export class CostLedgerAuthorizationError extends Error {
  constructor() {
    super("Cost ledger operation is not authorized");
    this.name = "CostLedgerAuthorizationError";
  }
}

export class CostLedgerConflictError extends Error {
  constructor() {
    super("Cost event identity conflicts with immutable ledger evidence");
    this.name = "CostLedgerConflictError";
  }
}

export class CostLedgerReconciliationError extends Error {
  constructor() {
    super("Cost event cannot reconcile the referenced ledger evidence");
    this.name = "CostLedgerReconciliationError";
  }
}

export class CostLedgerTransactionError extends Error {
  constructor() {
    super("Cost ledger transaction could not be completed");
    this.name = "CostLedgerTransactionError";
  }
}

const COST_SOURCES = ["estimated", "measured", "provider_reported"] as const;
const COST_UNITS = ["minute", "second", "token", "character", "megabyte", "request", "seat", "flat", "conversation"] as const;
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]{0,119}$/;
const SERVICE_PATTERN = /^[a-z][a-z0-9._/-]{0,159}$/;
const RATE_CARD_REFERENCE_PATTERN = /^[a-z][a-z0-9._/-]{0,159}$/;
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const PROVIDER_REQUEST_REFERENCE_PATTERN = /^ppr_[a-z0-9]{6,64}$/;
const ISO_UTC_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;
const QUANTITY_SCALE = 8;
const UNIT_COST_SCALE = 10;
const USD_SCALE = 8;
const MAX_QUANTITY_INTEGER_DIGITS = 12;
const MAX_UNIT_COST_INTEGER_DIGITS = 10;
const MAX_USD_INTEGER_DIGITS = 12;
const UNIT_COST_TO_USD_FACTOR = pow10(UNIT_COST_SCALE);
const MAX_USD_SCALED = pow10(MAX_USD_INTEGER_DIGITS + USD_SCALE) - 1n;

interface NormalizedRateCard {
  readonly rateCardRef: string;
  readonly rateCardAsOf: string;
  readonly providerId: string;
  readonly service: string;
  readonly unitType: CostUnit;
  readonly unitCostScaled: bigint;
}

interface NormalizedProviderRequest {
  readonly providerId: string;
  readonly providerRequestRef: string;
  readonly rateCardCapability: object;
  readonly tenantId: TenantId;
  readonly sessionId: UuidV7 | null;
}

interface NormalizedWrite {
  readonly eventId: UuidV7;
  readonly tenantId: TenantId;
  readonly sessionId: UuidV7 | null;
  readonly source: CostSource;
  readonly quantityScaled: bigint;
  readonly amountScaled: bigint;
  readonly occurredAt: string;
  readonly traceId: string;
  readonly rateCard: NormalizedRateCard;
  readonly providerRequest: NormalizedProviderRequest;
  readonly reconcilesCostEventId: UuidV7 | null;
  readonly fingerprint: string;
}

interface StoredCostEvent {
  readonly record: CostLedgerRecord;
  readonly source: CostSource;
  readonly sessionId: UuidV7 | null;
  readonly quantityScaled: bigint;
  readonly amountScaled: bigint;
  readonly reconcilesCostEventId: UuidV7 | null;
  readonly providerRequestKey: string;
  readonly fingerprint: string;
}

interface CostLedgerSnapshot {
  readonly recordsByTenant: Map<TenantId, Map<UuidV7, StoredCostEvent>>;
  readonly providerRequestsByTenant: Map<TenantId, Map<string, UuidV7>>;
}

const RATE_CARDS = new WeakMap<object, NormalizedRateCard>();
const PROVIDER_REQUESTS = new WeakMap<object, NormalizedProviderRequest>();
let attributionAuthoritySequence = 0;

/**
 * Creates local opaque capabilities for trusted application composition. The
 * capability itself is not serializable, so model text and public payloads
 * cannot invent a rate card or provider request reference.
 */
export function createCostAttributionAuthority(): CostAttributionAuthority {
  attributionAuthoritySequence += 1;
  const authoritySequence = attributionAuthoritySequence;
  let providerRequestSequence = 0;
  return Object.freeze({
    issueRateCard(input: CostRateCardInput): CostRateCard {
      const rateCard = Object.freeze(Object.create(null)) as CostRateCard;
      RATE_CARDS.set(rateCard, normalizeRateCard(input));
      return rateCard;
    },
    issueProviderRequestReference(input: ProviderRequestReferenceInput): ProviderRequestReference {
      const record = plainRecord(input);
      assertExactKeys(record, ["rate_card", "tenant_id", "session_id"]);
      const rateCardCapability = readRequired(record, "rate_card");
      const normalizedRateCard = requireRateCard(rateCardCapability);
      const tenantId = parseTenantId(readRequired(record, "tenant_id"));
      const sessionId = parseNullableUuid(readRequired(record, "session_id"), "session_id");
      providerRequestSequence += 1;
      const providerRequestRef = `ppr_${authoritySequence.toString(36).padStart(6, "0")}${providerRequestSequence.toString(36).padStart(6, "0")}`;
      if (!PROVIDER_REQUEST_REFERENCE_PATTERN.test(providerRequestRef)) throw new CostLedgerValidationError();
      const providerRequest = Object.freeze(Object.create(null)) as ProviderRequestReference;
      PROVIDER_REQUESTS.set(providerRequest, Object.freeze({
        providerId: normalizedRateCard.providerId,
        providerRequestRef,
        rateCardCapability: rateCardCapability as object,
        tenantId,
        sessionId,
      }));
      return providerRequest;
    },
  });
}

export function createDeterministicCostLedger(options: DeterministicCostLedgerOptions = {}): DeterministicCostLedger {
  return new LocalDeterministicCostLedger(options);
}

class LocalDeterministicCostLedger implements DeterministicCostLedger, TransactionalStateParticipant<CostLedgerSnapshot> {
  #recordsByTenant = new Map<TenantId, Map<UuidV7, StoredCostEvent>>();
  #providerRequestsByTenant = new Map<TenantId, Map<string, UuidV7>>();
  readonly #transaction = createDeterministicTransactionCoordinator();
  readonly #faultPoints: Set<CostLedgerFaultPoint>;

  constructor(options: DeterministicCostLedgerOptions) {
    this.#faultPoints = new Set(normalizeFaultPoints(options.faultPoints));
  }

  record(request: AuthorizedRequestContext, input: CostLedgerWriteInput | unknown): CostLedgerRecord {
    const normalized = normalizeWrite(request, input);
    const tenantRecords = this.#recordsByTenant.get(normalized.tenantId);
    const existing = tenantRecords?.get(normalized.eventId);
    if (existing !== undefined) {
      if (existing.fingerprint !== normalized.fingerprint) throw new CostLedgerConflictError();
      return existing.record;
    }

    return this.#transaction.executeSync(this, () => {
      const currentTenantRecords = this.#recordsByTenant.get(normalized.tenantId) ?? new Map<UuidV7, StoredCostEvent>();
      const concurrentExisting = currentTenantRecords.get(normalized.eventId);
      if (concurrentExisting !== undefined) {
        if (concurrentExisting.fingerprint !== normalized.fingerprint) throw new CostLedgerConflictError();
        return concurrentExisting.record;
      }

      const providerRequests = this.#providerRequestsByTenant.get(normalized.tenantId) ?? new Map<string, UuidV7>();
      const providerRequestKey = providerRequestKeyFor(normalized);
      const previousEventId = providerRequests.get(providerRequestKey);
      if (previousEventId !== undefined && previousEventId !== normalized.eventId) throw new CostLedgerConflictError();
      assertReconciliationTarget(currentTenantRecords, normalized);
      const stored = createStoredCostEvent(normalized);
      currentTenantRecords.set(normalized.eventId, stored);
      this.#recordsByTenant.set(normalized.tenantId, currentTenantRecords);
      providerRequests.set(providerRequestKey, normalized.eventId);
      this.#providerRequestsByTenant.set(normalized.tenantId, providerRequests);
      this.#throwAt("after_cost_event_insert");
      this.#throwAt("before_commit");
      return stored.record;
    });
  }

  get(request: AuthorizedRequestContext, costEventId: unknown): CostLedgerRecord | null {
    const tenantId = requireScope(request, "session:read").tenantId;
    const eventId = parseUuidV7(costEventId, "cost_event_id");
    return this.#recordsByTenant.get(tenantId)?.get(eventId)?.record ?? null;
  }

  list(request: AuthorizedRequestContext, filter: CostLedgerFilter | unknown = {}): readonly CostLedgerRecord[] {
    const tenantId = requireScope(request, "session:read").tenantId;
    const normalizedFilter = normalizeFilter(filter);
    const records = [...(this.#recordsByTenant.get(tenantId)?.values() ?? [])]
      .filter((entry) => matchesFilter(entry, normalizedFilter))
      .sort((left, right) => left.record.event.cost_event_id.localeCompare(right.record.event.cost_event_id))
      .map((entry) => entry.record);
    return Object.freeze(records);
  }

  aggregate(request: AuthorizedRequestContext, filter: CostLedgerFilter | unknown = {}): CostLedgerAggregation {
    const tenantId = requireScope(request, "session:read").tenantId;
    const normalizedFilter = normalizeFilter(filter);
    const entries = [...(this.#recordsByTenant.get(tenantId)?.values() ?? [])]
      .filter((entry) => matchesFilter(entry, normalizedFilter));
    const buckets = aggregateBuckets(entries);
    const reconciliations = aggregateReconciliations(entries);
    return deepFreeze({
      tenant_id: tenantId,
      session_id: normalizedFilter.sessionId,
      buckets,
      reconciliations,
    });
  }

  captureSnapshot(): CostLedgerSnapshot {
    return {
      recordsByTenant: new Map([...this.#recordsByTenant.entries()].map(([tenantId, records]) => [tenantId, new Map(records)])),
      providerRequestsByTenant: new Map([...this.#providerRequestsByTenant.entries()].map(([tenantId, requests]) => [tenantId, new Map(requests)])),
    };
  }

  restoreSnapshot(snapshot: CostLedgerSnapshot): void {
    this.#recordsByTenant = new Map([...snapshot.recordsByTenant.entries()].map(([tenantId, records]) => [tenantId, new Map(records)]));
    this.#providerRequestsByTenant = new Map([...snapshot.providerRequestsByTenant.entries()].map(([tenantId, requests]) => [tenantId, new Map(requests)]));
  }

  #throwAt(point: CostLedgerFaultPoint): void {
    if (this.#faultPoints.delete(point)) throw new CostLedgerTransactionError();
  }
}

function normalizeWrite(request: AuthorizedRequestContext, input: unknown): NormalizedWrite {
  const context = requireScope(request, "provider:use");
  const record = plainRecord(input);
  assertExactKeys(record, [
    "cost_event_id",
    "tenant_id",
    "session_id",
    "source",
    "quantity",
    "occurred_at",
    "trace_id",
    "rate_card",
    "provider_request",
  ], ["reconciles_cost_event_id", "declared_amount_usd"]);
  const tenantId = assertTenantMatch(context, asString(readRequired(record, "tenant_id")));
  const eventId = parseUuidV7(readRequired(record, "cost_event_id"), "cost_event_id");
  const sessionId = parseNullableUuid(readRequired(record, "session_id"), "session_id");
  const source = parseCostSource(readRequired(record, "source"));
  const quantityScaled = parseScaledNumber(readRequired(record, "quantity"), QUANTITY_SCALE, MAX_QUANTITY_INTEGER_DIGITS);
  const occurredAt = parseUtcTimestamp(readRequired(record, "occurred_at"));
  const traceId = parseTraceId(readRequired(record, "trace_id"));
  const rateCardCapability = readRequired(record, "rate_card");
  const rateCard = requireRateCard(rateCardCapability);
  const providerRequest = requireProviderRequest(readRequired(record, "provider_request"));
  if (
    providerRequest.providerId !== rateCard.providerId
    || providerRequest.rateCardCapability !== rateCardCapability
    || providerRequest.tenantId !== tenantId
    || providerRequest.sessionId !== sessionId
  ) {
    throw new CostLedgerValidationError();
  }

  const amountScaled = calculateUsdAmount(quantityScaled, rateCard.unitCostScaled);
  const declaredAmount = readOptional(record, "declared_amount_usd");
  if (declaredAmount !== undefined) {
    const declaredScaled = parseScaledNumber(declaredAmount, USD_SCALE, MAX_USD_INTEGER_DIGITS);
    if (declaredScaled !== amountScaled) throw new CostLedgerValidationError("Declared amount does not reconcile with quantity and unit cost");
  }
  const reconciliationValue = readOptional(record, "reconciles_cost_event_id");
  const reconcilesCostEventId = reconciliationValue === undefined ? null : parseNullableUuid(reconciliationValue, "reconciles_cost_event_id");
  if (reconcilesCostEventId !== null && source === "estimated") throw new CostLedgerReconciliationError();

  const fingerprint = JSON.stringify([
    eventId,
    tenantId,
    sessionId,
    source,
    quantityScaled.toString(),
    amountScaled.toString(),
    occurredAt,
    traceId,
    rateCard.rateCardRef,
    rateCard.rateCardAsOf,
    rateCard.providerId,
    rateCard.service,
    rateCard.unitType,
    rateCard.unitCostScaled.toString(),
    providerRequest.providerRequestRef,
    reconcilesCostEventId,
  ]);
  return Object.freeze({
    eventId,
    tenantId,
    sessionId,
    source,
    quantityScaled,
    amountScaled,
    occurredAt,
    traceId,
    rateCard,
    providerRequest,
    reconcilesCostEventId,
    fingerprint,
  });
}

function createStoredCostEvent(input: NormalizedWrite): StoredCostEvent {
  const event = deepFreeze({
    schema_version: "2.1.0",
    cost_event_id: input.eventId,
    tenant_id: input.tenantId,
    session_id: input.sessionId,
    provider_id: input.rateCard.providerId,
    service: input.rateCard.service,
    unit_type: input.rateCard.unitType,
    quantity: toContractNumber(input.quantityScaled, QUANTITY_SCALE, MAX_QUANTITY_INTEGER_DIGITS),
    unit_cost_usd: toContractNumber(input.rateCard.unitCostScaled, UNIT_COST_SCALE, MAX_UNIT_COST_INTEGER_DIGITS),
    amount_usd: toContractNumber(input.amountScaled, USD_SCALE, MAX_USD_INTEGER_DIGITS),
    currency: "USD",
    source: input.source,
    rate_card_ref: input.rateCard.rateCardRef,
    rate_card_as_of: input.rateCard.rateCardAsOf,
    reconciles_cost_event_id: input.reconcilesCostEventId,
    trace_id: input.traceId,
    provider_request_ref: input.providerRequest.providerRequestRef,
    occurred_at: input.occurredAt,
  } satisfies CostEvent);
  const record = deepFreeze({
    event,
    quantity_decimal: formatScaled(input.quantityScaled, QUANTITY_SCALE),
    unit_cost_usd_decimal: formatScaled(input.rateCard.unitCostScaled, UNIT_COST_SCALE),
    amount_usd_decimal: formatScaled(input.amountScaled, USD_SCALE),
  });
  return Object.freeze({
    record,
    source: input.source,
    sessionId: input.sessionId,
    quantityScaled: input.quantityScaled,
    amountScaled: input.amountScaled,
    reconcilesCostEventId: input.reconcilesCostEventId,
    providerRequestKey: providerRequestKeyFor(input),
    fingerprint: input.fingerprint,
  });
}

function providerRequestKeyFor(input: NormalizedWrite): string {
  return `${input.source}\u0000${input.providerRequest.providerRequestRef}`;
}

function assertReconciliationTarget(records: ReadonlyMap<UuidV7, StoredCostEvent>, input: NormalizedWrite): void {
  if (input.reconcilesCostEventId === null) return;
  const target = records.get(input.reconcilesCostEventId);
  if (target === undefined || target.source !== "estimated") throw new CostLedgerReconciliationError();
  const targetEvent = target.record.event;
  if (
    targetEvent.session_id !== input.sessionId
    || targetEvent.provider_id !== input.rateCard.providerId
    || targetEvent.service !== input.rateCard.service
    || targetEvent.unit_type !== input.rateCard.unitType
  ) {
    throw new CostLedgerReconciliationError();
  }
}

function aggregateBuckets(entries: readonly StoredCostEvent[]): readonly CostAggregateBucket[] {
  const totals = new Map<string, { source: CostSource; providerId: string; service: string; unitType: CostUnit; count: number; quantity: bigint; amount: bigint }>();
  for (const entry of entries) {
    const event = entry.record.event;
    const key = [entry.source, event.provider_id, event.service, event.unit_type].join("\u0000");
    const current = totals.get(key);
    if (current === undefined) {
      totals.set(key, {
        source: entry.source,
        providerId: event.provider_id,
        service: event.service,
        unitType: event.unit_type,
        count: 1,
        quantity: entry.quantityScaled,
        amount: entry.amountScaled,
      });
    } else {
      current.count += 1;
      current.quantity += entry.quantityScaled;
      current.amount += entry.amountScaled;
    }
  }
  return Object.freeze([...totals.values()]
    .sort((left, right) => [left.source, left.providerId, left.service, left.unitType].join("\u0000").localeCompare(
      [right.source, right.providerId, right.service, right.unitType].join("\u0000"),
    ))
    .map((entry) => deepFreeze({
      source: entry.source,
      provider_id: entry.providerId,
      service: entry.service,
      unit_type: entry.unitType,
      event_count: entry.count,
      quantity_decimal: formatScaled(entry.quantity, QUANTITY_SCALE),
      amount_usd_decimal: formatScaled(entry.amount, USD_SCALE),
    })));
}

function aggregateReconciliations(entries: readonly StoredCostEvent[]): readonly CostReconciliation[] {
  const estimates = new Map<UuidV7, StoredCostEvent>();
  const linked = new Map<UuidV7, { measured: bigint; providerReported: bigint; hasMeasured: boolean; hasProviderReported: boolean }>();
  for (const entry of entries) {
    if (entry.source === "estimated") estimates.set(entry.record.event.cost_event_id as UuidV7, entry);
    if (entry.reconcilesCostEventId !== null) {
      const current = linked.get(entry.reconcilesCostEventId) ?? {
        measured: 0n,
        providerReported: 0n,
        hasMeasured: false,
        hasProviderReported: false,
      };
      if (entry.source === "measured") {
        current.measured += entry.amountScaled;
        current.hasMeasured = true;
      } else if (entry.source === "provider_reported") {
        current.providerReported += entry.amountScaled;
        current.hasProviderReported = true;
      }
      linked.set(entry.reconcilesCostEventId, current);
    }
  }
  return Object.freeze([...linked.entries()]
    .filter(([estimateId]) => estimates.has(estimateId))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([estimateId, reconciled]) => {
      const estimate = estimates.get(estimateId)!;
      return deepFreeze({
        estimated_cost_event_id: estimateId,
        estimated_amount_usd_decimal: formatScaled(estimate.amountScaled, USD_SCALE),
        measured_amount_usd_decimal: reconciled.hasMeasured ? formatScaled(reconciled.measured, USD_SCALE) : null,
        provider_reported_amount_usd_decimal: reconciled.hasProviderReported ? formatScaled(reconciled.providerReported, USD_SCALE) : null,
        measured_variance_usd_decimal: reconciled.hasMeasured
          ? formatSignedScaled(reconciled.measured - estimate.amountScaled, USD_SCALE)
          : null,
        provider_reported_variance_usd_decimal: reconciled.hasProviderReported
          ? formatSignedScaled(reconciled.providerReported - estimate.amountScaled, USD_SCALE)
          : null,
      });
    }));
}

function normalizeFilter(value: unknown): { readonly sessionId: UuidV7 | null; readonly providerId: string | null; readonly service: string | null } {
  const record = plainRecord(value);
  assertExactKeys(record, [], ["session_id", "provider_id", "service"]);
  const sessionValue = readOptional(record, "session_id");
  const providerValue = readOptional(record, "provider_id");
  const serviceValue = readOptional(record, "service");
  return Object.freeze({
    sessionId: sessionValue === undefined ? null : parseNullableUuid(sessionValue, "session_id"),
    providerId: providerValue === undefined ? null : parseProviderId(providerValue),
    service: serviceValue === undefined ? null : parseService(serviceValue),
  });
}

function matchesFilter(entry: StoredCostEvent, filter: { readonly sessionId: UuidV7 | null; readonly providerId: string | null; readonly service: string | null }): boolean {
  const event = entry.record.event;
  return (filter.sessionId === null || event.session_id === filter.sessionId)
    && (filter.providerId === null || event.provider_id === filter.providerId)
    && (filter.service === null || event.service === filter.service);
}

function normalizeRateCard(input: CostRateCardInput): NormalizedRateCard {
  const record = plainRecord(input);
  assertExactKeys(record, ["rate_card_ref", "rate_card_as_of", "provider_id", "service", "unit_type", "unit_cost_usd"]);
  return Object.freeze({
    rateCardRef: parseRateCardReference(readRequired(record, "rate_card_ref")),
    rateCardAsOf: parseUtcTimestamp(readRequired(record, "rate_card_as_of")),
    providerId: parseProviderId(readRequired(record, "provider_id")),
    service: parseService(readRequired(record, "service")),
    unitType: parseCostUnit(readRequired(record, "unit_type")),
    unitCostScaled: parseScaledDecimal(readRequired(record, "unit_cost_usd"), UNIT_COST_SCALE, MAX_UNIT_COST_INTEGER_DIGITS),
  });
}

function requireRateCard(value: unknown): NormalizedRateCard {
  if (value === null || typeof value !== "object") throw new CostLedgerValidationError();
  const rateCard = RATE_CARDS.get(value);
  if (rateCard === undefined) throw new CostLedgerValidationError();
  return rateCard;
}

function requireProviderRequest(value: unknown): NormalizedProviderRequest {
  if (value === null || typeof value !== "object") throw new CostLedgerValidationError();
  const providerRequest = PROVIDER_REQUESTS.get(value);
  if (providerRequest === undefined) throw new CostLedgerValidationError();
  return providerRequest;
}

function requireScope(request: AuthorizedRequestContext, scope: string): TenantContext {
  const context = getAuthorizedTenantContext(request);
  if (
    !context.grantedScopes.includes(scope)
    || !context.purposes.includes("essential_processing")
  ) throw new CostLedgerAuthorizationError();
  return context;
}

function calculateUsdAmount(quantityScaled: bigint, unitCostScaled: bigint): bigint {
  const product = quantityScaled * unitCostScaled;
  const amountScaled = (product + (UNIT_COST_TO_USD_FACTOR / 2n)) / UNIT_COST_TO_USD_FACTOR;
  if (amountScaled > MAX_USD_SCALED) throw new CostLedgerValidationError("Cost amount exceeds database precision");
  return amountScaled;
}

function parseScaledNumber(value: unknown, scale: number, maximumIntegerDigits: number): bigint {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0) || value < 0) {
    throw new CostLedgerValidationError();
  }
  return parseScaledText(value.toString(), scale, maximumIntegerDigits);
}

function parseScaledDecimal(value: unknown, scale: number, maximumIntegerDigits: number): bigint {
  if (typeof value === "number") return parseScaledNumber(value, scale, maximumIntegerDigits);
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || value.trim() !== value) {
    throw new CostLedgerValidationError();
  }
  return parseScaledText(value, scale, maximumIntegerDigits);
}

function parseScaledText(value: string, scale: number, maximumIntegerDigits: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value);
  if (match === null) throw new CostLedgerValidationError();
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent) || exponent < -30 || exponent > 30) throw new CostLedgerValidationError();
  const integral = match[1]!;
  const fractional = match[2] ?? "";
  const digits = `${integral}${fractional}`;
  const decimalIndex = integral.length + exponent;
  let normalizedIntegral: string;
  let normalizedFractional: string;
  if (decimalIndex <= 0) {
    normalizedIntegral = "0";
    normalizedFractional = `${"0".repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    normalizedIntegral = `${digits}${"0".repeat(decimalIndex - digits.length)}`;
    normalizedFractional = "";
  } else {
    normalizedIntegral = digits.slice(0, decimalIndex);
    normalizedFractional = digits.slice(decimalIndex);
  }
  normalizedIntegral = normalizedIntegral.replace(/^0+(?=\d)/, "");
  if (normalizedIntegral.length > maximumIntegerDigits || normalizedFractional.length > scale) {
    throw new CostLedgerValidationError("Cost decimal exceeds supported precision");
  }
  const scaled = BigInt(normalizedIntegral) * pow10(scale)
    + BigInt((normalizedFractional || "").padEnd(scale, "0") || "0");
  const maximum = pow10(maximumIntegerDigits + scale) - 1n;
  if (scaled > maximum) throw new CostLedgerValidationError("Cost decimal exceeds database precision");
  return scaled;
}

function parseNullableUuid(value: unknown, field: string): UuidV7 | null {
  return value === null ? null : parseUuidV7(value, field);
}

function parseCostSource(value: unknown): CostSource {
  if (typeof value !== "string" || !(COST_SOURCES as readonly string[]).includes(value)) throw new CostLedgerValidationError();
  return value as CostSource;
}

function parseCostUnit(value: unknown): CostUnit {
  if (typeof value !== "string" || !(COST_UNITS as readonly string[]).includes(value)) throw new CostLedgerValidationError();
  return value as CostUnit;
}

function parseProviderId(value: unknown): string {
  if (typeof value !== "string" || !PROVIDER_ID_PATTERN.test(value)) throw new CostLedgerValidationError();
  return value;
}

function parseService(value: unknown): string {
  if (typeof value !== "string" || !SERVICE_PATTERN.test(value)) throw new CostLedgerValidationError();
  return value;
}

function parseRateCardReference(value: unknown): string {
  if (typeof value !== "string" || !RATE_CARD_REFERENCE_PATTERN.test(value) || value.includes("://")) {
    throw new CostLedgerValidationError();
  }
  return value;
}

function parseTraceId(value: unknown): string {
  if (typeof value !== "string" || !TRACE_ID_PATTERN.test(value)) throw new CostLedgerValidationError();
  return value;
}

function parseUtcTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new CostLedgerValidationError();
  const match = ISO_UTC_PATTERN.exec(value);
  if (match === null) throw new CostLedgerValidationError();
  const canonicalInput = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new CostLedgerValidationError();
  if (parsed.toISOString() !== canonicalInput) throw new CostLedgerValidationError();
  return canonicalInput;
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw new CostLedgerValidationError();
  return value;
}

function normalizeFaultPoints(value: readonly CostLedgerFaultPoint[] | undefined): readonly CostLedgerFaultPoint[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.some((point) => point !== "after_cost_event_insert" && point !== "before_commit")) {
    throw new CostLedgerValidationError();
  }
  return Object.freeze([...new Set(value)]);
}

function formatScaled(value: bigint, scale: number): string {
  const integral = value / pow10(scale);
  const fractional = (value % pow10(scale)).toString().padStart(scale, "0").replace(/0+$/, "");
  return fractional.length === 0 ? integral.toString() : `${integral}.${fractional}`;
}

function formatSignedScaled(value: bigint, scale: number): string {
  return value < 0n ? `-${formatScaled(-value, scale)}` : formatScaled(value, scale);
}

function toContractNumber(value: bigint, scale: number, maximumIntegerDigits: number): number {
  const decimal = formatScaled(value, scale);
  const numeric = Number(decimal);
  if (!Number.isFinite(numeric)) throw new CostLedgerValidationError();
  if (parseScaledNumber(numeric, scale, maximumIntegerDigits) !== value) {
    throw new CostLedgerValidationError("Cost decimal cannot be represented losslessly by the generated contract");
  }
  return numeric;
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function plainRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new CostLedgerValidationError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new CostLedgerValidationError();
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(record);
  if (
    keys.length < required.length
    || keys.some((key) => typeof key !== "string" || !allowed.has(key))
    || required.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new CostLedgerValidationError();
  }
}

function readRequired(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) throw new CostLedgerValidationError();
  return descriptor.value;
}

function readOptional(record: Record<string, unknown>, key: string): unknown | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  return readRequired(record, key);
}

function deepFreeze<const Value>(value: Value): Value {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return Object.freeze(value);
}
