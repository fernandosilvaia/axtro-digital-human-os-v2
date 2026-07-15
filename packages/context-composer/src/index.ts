import {
  getAuthorizedTenantContext,
  type AuthorizedRequestContext,
} from "@axtro/auth";
import type { ContextComposition } from "@axtro/contracts-ts";
import {
  CURRENT_SCHEMA_VERSION,
  canonicalJson,
  deepFreeze,
  interactionStateHash,
  parseDataClassification,
  parseSessionId,
  parseTenantId,
  parseUuidV7,
  type DataClassification,
  type InteractionAggregateState,
  type SessionId,
  type TenantId,
} from "@axtro/domain";

export interface ContextComposerClock {
  now(): number;
}

/** Only this factory may create a catalog accepted by the composer. */
export interface ApprovedKnowledgeCatalog {
  readonly kind: "approved_knowledge_catalog";
}

/** Only this factory may create a dynamic snapshot accepted by the composer. */
export interface ContextSuggestionSnapshot {
  readonly kind: "context_suggestion_snapshot";
}

/** A local capability created only from a projected authoritative state. */
export interface ContextStateSnapshot {
  readonly kind: "context_state_snapshot";
}

export interface ApprovedKnowledgeSnippetInput {
  readonly knowledge_id: unknown;
  readonly tenant_id: unknown;
  readonly role_pack_id: unknown;
  readonly role_pack_version: unknown;
  readonly purpose: unknown;
  readonly data_classification: unknown;
  readonly content: unknown;
  readonly source_version: unknown;
  readonly checksum_sha256: unknown;
  readonly approval_receipt: unknown;
  readonly status: unknown;
  readonly observed_at: unknown;
  readonly expires_at: unknown;
}

export interface ContextSuggestionSnapshotEntryInput {
  readonly entry_id: unknown;
  readonly tenant_id: unknown;
  readonly session_id: unknown;
  readonly context_version: unknown;
  readonly kind: unknown;
  readonly content: unknown;
  readonly confidence: unknown;
  readonly evidence_refs: unknown;
  readonly source_version: unknown;
  readonly data_classification: unknown;
  readonly created_at: unknown;
  readonly expires_at: unknown;
  readonly allowed_use: unknown;
  readonly consent_status: unknown;
}

export interface ContextComposerOptions {
  readonly approved_knowledge_catalog?: ApprovedKnowledgeCatalog;
  readonly suggestion_snapshot?: ContextSuggestionSnapshot;
  readonly clock?: ContextComposerClock;
  readonly default_max_context_bytes?: unknown;
}

export interface ContextCompositionInput {
  readonly state_snapshot: ContextStateSnapshot;
  readonly max_context_bytes?: unknown;
}

export interface ContextComposer {
  /** The Turn Driver calls this immediately after the Session Actor projection. */
  captureProjectedState(request: AuthorizedRequestContext, state: InteractionAggregateState): ContextStateSnapshot;
  compose(request: AuthorizedRequestContext, input: ContextCompositionInput): ContextComposition;
}

export class ContextComposerValidationError extends Error {
  constructor() {
    super("Context composition input is invalid");
    this.name = "ContextComposerValidationError";
  }
}

export class ContextComposerAuthorizationError extends Error {
  constructor() {
    super("Context composition is not authorized");
    this.name = "ContextComposerAuthorizationError";
  }
}

export class ContextComposerConfigurationError extends Error {
  constructor() {
    super("Context composer configuration is invalid");
    this.name = "ContextComposerConfigurationError";
  }
}

export class ContextComposerBudgetError extends Error {
  constructor() {
    super("Context composition cannot fit its configured byte budget");
    this.name = "ContextComposerBudgetError";
  }
}

type ContextEntry = ContextComposition["entries"][number];
type EntryKind = ContextEntry["kind"];
type TrustLevel = ContextEntry["trust_level"];
type ProvenanceKind = ContextEntry["provenance"]["source_kind"];

interface NormalizedTimestamp {
  readonly value: string;
  readonly milliseconds: number;
}

interface KnowledgeRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly rolePackId: string;
  readonly rolePackVersion: string;
  readonly purpose: "essential_processing";
  readonly dataClassification: SafeContextClassification;
  readonly content: string;
  readonly sourceVersion: string;
  readonly checksumSha256: string;
  readonly approvalReceipt: string;
  readonly status: "approved" | "revoked";
  readonly observedAt: NormalizedTimestamp;
  readonly expiresAt: NormalizedTimestamp | null;
}

interface SuggestionRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly contextVersion: number;
  readonly kind: "suggestion" | "hypothesis";
  readonly content: string;
  readonly confidence: number;
  readonly evidenceRefs: readonly string[];
  readonly sourceVersion: string;
  readonly dataClassification: SafeContextClassification;
  readonly createdAt: NormalizedTimestamp;
  readonly expiresAt: NormalizedTimestamp;
  readonly allowedUse: "presenter_context" | "prohibited";
  readonly consentStatus: "granted" | "not_required" | "missing";
}

interface Candidate {
  readonly entry: ContextEntry;
  readonly rank: number;
  readonly observedAtMs: number;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly expiresAtMs: number | null;
}

interface NormalizedComposerOptions {
  readonly knowledge: readonly KnowledgeRecord[];
  readonly suggestions: readonly SuggestionRecord[];
  readonly clock: ContextComposerClock;
  readonly defaultMaxContextBytes: number;
}

interface NormalizedCompositionInput {
  readonly state: InteractionAggregateState;
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
  readonly maxContextBytes: number;
}

interface CapturedState {
  readonly authority: object;
  readonly state: InteractionAggregateState;
  readonly stateHash: string;
  readonly tenantId: TenantId;
  readonly sessionId: SessionId;
}

type SafeContextClassification = Exclude<DataClassification, "restricted">;

const KNOWLEDGE_CATALOGS = new WeakMap<ApprovedKnowledgeCatalog, readonly KnowledgeRecord[]>();
const SUGGESTION_SNAPSHOTS = new WeakMap<ContextSuggestionSnapshot, readonly SuggestionRecord[]>();
const STATE_SNAPSHOTS = new WeakMap<ContextStateSnapshot, CapturedState>();
const UTF8 = new TextEncoder();
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DEFAULT_MAX_CONTEXT_BYTES = 6_000;
const MIN_CONTEXT_BYTES = 1_024;
const MAX_CONTEXT_BYTES = 12_000;
const MAX_OUTPUT_ENTRIES = 128;
const MAX_CATALOG_ENTRIES = 64;
const MAX_SNAPSHOT_ENTRIES = 64;
const MAX_ENTRY_CONTENT_BYTES = 5_000;
const MAX_CONTENT_CHARACTERS = 5_000;
const SYSTEM_CLOCK: ContextComposerClock = Object.freeze({ now: () => Date.now() });

/**
 * Normalizes an opaque server-created catalog. Request input never contains
 * knowledge approval, role scope, checksum, or catalog selection fields.
 */
export function createDeterministicApprovedKnowledgeCatalog(
  entriesInput: readonly ApprovedKnowledgeSnippetInput[],
): ApprovedKnowledgeCatalog {
  if (!Array.isArray(entriesInput) || entriesInput.length > MAX_CATALOG_ENTRIES) {
    throw new ContextComposerConfigurationError();
  }
  const keys = new Set<string>();
  const entries = entriesInput.map((entry) => {
    const record = strictRecord(entry, [
      "knowledge_id",
      "tenant_id",
      "role_pack_id",
      "role_pack_version",
      "purpose",
      "data_classification",
      "content",
      "source_version",
      "checksum_sha256",
      "approval_receipt",
      "status",
      "observed_at",
      "expires_at",
    ], ContextComposerConfigurationError);
    let normalized: KnowledgeRecord;
    try {
      const id = parseOpaqueId(record.knowledge_id);
      const tenantId = parseTenantId(record.tenant_id);
      const rolePackId = boundedString(record.role_pack_id, 1, 200, ContextComposerConfigurationError);
      const rolePackVersion = boundedString(record.role_pack_version, 1, 50, ContextComposerConfigurationError);
      if (record.purpose !== "essential_processing") throw new ContextComposerConfigurationError();
      const dataClassification = parseSafeContextClassification(record.data_classification, ContextComposerConfigurationError);
      const content = normalizeContent(record.content, ContextComposerConfigurationError);
      const sourceVersion = boundedString(record.source_version, 1, 120, ContextComposerConfigurationError);
      if (typeof record.checksum_sha256 !== "string" || !SHA256_PATTERN.test(record.checksum_sha256)) {
        throw new ContextComposerConfigurationError();
      }
      const approvalReceipt = parseOpaqueId(record.approval_receipt);
      if (record.status !== "approved" && record.status !== "revoked") throw new ContextComposerConfigurationError();
      normalized = Object.freeze({
        id,
        tenantId,
        rolePackId,
        rolePackVersion,
        purpose: "essential_processing",
        dataClassification,
        content,
        sourceVersion,
        checksumSha256: record.checksum_sha256,
        approvalReceipt,
        status: record.status,
        observedAt: parseTimestamp(record.observed_at, ContextComposerConfigurationError),
        expiresAt: record.expires_at === null ? null : parseTimestamp(record.expires_at, ContextComposerConfigurationError),
      });
    } catch (error) {
      if (error instanceof ContextComposerConfigurationError) throw error;
      throw new ContextComposerConfigurationError();
    }
    const key = `${normalized.tenantId}:${normalized.id}`;
    if (keys.has(key)) throw new ContextComposerConfigurationError();
    keys.add(key);
    return normalized;
  });
  const catalog = Object.freeze({ kind: "approved_knowledge_catalog" as const });
  KNOWLEDGE_CATALOGS.set(catalog, Object.freeze(entries));
  return catalog;
}

/**
 * Normalizes late asynchronous work at its server-owned boundary. The public
 * `agent_suggestion` contract is deliberately not widened in this milestone.
 */
export function createDeterministicContextSuggestionSnapshot(
  entriesInput: readonly ContextSuggestionSnapshotEntryInput[],
): ContextSuggestionSnapshot {
  if (!Array.isArray(entriesInput) || entriesInput.length > MAX_SNAPSHOT_ENTRIES) {
    throw new ContextComposerConfigurationError();
  }
  const keys = new Set<string>();
  const entries = entriesInput.map((entry) => {
    const record = strictRecord(entry, [
      "entry_id",
      "tenant_id",
      "session_id",
      "context_version",
      "kind",
      "content",
      "confidence",
      "evidence_refs",
      "source_version",
      "data_classification",
      "created_at",
      "expires_at",
      "allowed_use",
      "consent_status",
    ], ContextComposerConfigurationError);
    let normalized: SuggestionRecord;
    try {
      const id = parseOpaqueId(record.entry_id);
      const tenantId = parseTenantId(record.tenant_id);
      const sessionId = parseSessionId(record.session_id);
      const contextVersion = boundedInteger(record.context_version, 0, Number.MAX_SAFE_INTEGER, ContextComposerConfigurationError);
      if (record.kind !== "suggestion" && record.kind !== "hypothesis") throw new ContextComposerConfigurationError();
      const content = normalizeContent(record.content, ContextComposerConfigurationError);
      const confidence = boundedConfidence(record.confidence, ContextComposerConfigurationError);
      const evidenceRefs = normalizeEvidenceRefs(record.evidence_refs, ContextComposerConfigurationError);
      const sourceVersion = boundedString(record.source_version, 1, 120, ContextComposerConfigurationError);
      const dataClassification = parseSafeContextClassification(record.data_classification, ContextComposerConfigurationError);
      if (record.allowed_use !== "presenter_context" && record.allowed_use !== "prohibited") {
        throw new ContextComposerConfigurationError();
      }
      if (record.consent_status !== "granted" && record.consent_status !== "not_required" && record.consent_status !== "missing") {
        throw new ContextComposerConfigurationError();
      }
      normalized = Object.freeze({
        id,
        tenantId,
        sessionId,
        contextVersion,
        kind: record.kind,
        content,
        confidence,
        evidenceRefs,
        sourceVersion,
        dataClassification,
        createdAt: parseTimestamp(record.created_at, ContextComposerConfigurationError),
        expiresAt: parseTimestamp(record.expires_at, ContextComposerConfigurationError),
        allowedUse: record.allowed_use,
        consentStatus: record.consent_status,
      });
    } catch (error) {
      if (error instanceof ContextComposerConfigurationError) throw error;
      throw new ContextComposerConfigurationError();
    }
    const key = `${normalized.tenantId}:${normalized.sessionId}:${normalized.id}`;
    if (keys.has(key)) throw new ContextComposerConfigurationError();
    keys.add(key);
    return normalized;
  });
  const snapshot = Object.freeze({ kind: "context_suggestion_snapshot" as const });
  SUGGESTION_SNAPSHOTS.set(snapshot, Object.freeze(entries));
  return snapshot;
}

/**
 * Creates a local, synchronous, deterministic composer. It owns no mutable
 * request state and performs no external work.
 */
export function createDeterministicContextComposer(optionsInput?: ContextComposerOptions): ContextComposer {
  const options = normalizeOptions(optionsInput);
  const authority = Object.freeze({});
  return Object.freeze({
    captureProjectedState(request: AuthorizedRequestContext, stateInput: InteractionAggregateState): ContextStateSnapshot {
      const access = requireContextAccess(request);
      let state: InteractionAggregateState;
      let stateHash: string;
      let tenantId: TenantId;
      let sessionId: SessionId;
      try {
        state = deepFreeze(JSON.parse(canonicalJson(stateInput)) as InteractionAggregateState);
        stateHash = interactionStateHash(state);
        tenantId = parseTenantId(state.session.tenant_id);
        sessionId = parseSessionId(state.session.session_id);
      } catch {
        throw new ContextComposerValidationError();
      }
      if (tenantId !== access.tenantId) throw new ContextComposerAuthorizationError();
      const snapshot = Object.freeze({ kind: "context_state_snapshot" as const });
      STATE_SNAPSHOTS.set(snapshot, Object.freeze({ authority, state, stateHash, tenantId, sessionId }));
      return snapshot;
    },
    compose(request: AuthorizedRequestContext, input: ContextCompositionInput): ContextComposition {
      const access = requireContextAccess(request);
      const normalized = normalizeCompositionInput(input, options.defaultMaxContextBytes, authority);
      if (normalized.tenantId !== access.tenantId) throw new ContextComposerAuthorizationError();
      const now = checkedNow(options.clock);
      const candidates = uniqueSortedCandidates(buildCandidates(normalized, options, now));
      return composeBounded(normalized, candidates, now);
    },
  } satisfies ContextComposer);
}

/** Validates the closed Composer to Fast Lane payload before any adapter sees it. */
export function parseContextComposition(value: unknown): ContextComposition {
  const record = strictRecord(value, [
    "schema_version",
    "tenant_id",
    "session_id",
    "context_version",
    "max_context_bytes",
    "content_bytes_used",
    "omitted_entry_count",
    "composed_at",
    "expires_at",
    "entries",
  ], ContextComposerValidationError);
  if (record.schema_version !== CURRENT_SCHEMA_VERSION) throw new ContextComposerValidationError();
  let tenantId: TenantId;
  let sessionId: SessionId;
  try {
    tenantId = parseTenantId(record.tenant_id);
    sessionId = parseSessionId(record.session_id);
  } catch {
    throw new ContextComposerValidationError();
  }
  const contextVersion = boundedInteger(record.context_version, 0, Number.MAX_SAFE_INTEGER, ContextComposerValidationError);
  const maxContextBytes = boundedInteger(record.max_context_bytes, MIN_CONTEXT_BYTES, MAX_CONTEXT_BYTES, ContextComposerValidationError);
  const contentBytesUsed = boundedInteger(record.content_bytes_used, 0, MAX_CONTEXT_BYTES, ContextComposerValidationError);
  const omittedEntryCount = boundedInteger(record.omitted_entry_count, 0, 512, ContextComposerValidationError);
  const composedAt = parseTimestamp(record.composed_at, ContextComposerValidationError);
  const expiresAt = record.expires_at === null ? null : parseTimestamp(record.expires_at, ContextComposerValidationError);
  if (!Array.isArray(record.entries) || record.entries.length > MAX_OUTPUT_ENTRIES) throw new ContextComposerValidationError();
  const entries = record.entries.map((entry) => parseContextEntry(entry));
  assertEntriesOrdered(entries);
  assertEntryLifetimes(entries, composedAt);
  assertCompositionExpiry(entries, expiresAt);
  const composition = Object.freeze({
    schema_version: CURRENT_SCHEMA_VERSION,
    tenant_id: tenantId,
    session_id: sessionId,
    context_version: contextVersion,
    max_context_bytes: maxContextBytes,
    content_bytes_used: contentBytesUsed,
    omitted_entry_count: omittedEntryCount,
    composed_at: composedAt.value,
    expires_at: expiresAt?.value ?? null,
    entries: Object.freeze(entries) as unknown as ContextComposition["entries"],
  });
  const actualContentBytes = entries.reduce((total, entry) => total + UTF8.encode(entry.content).byteLength, 0);
  if (actualContentBytes !== composition.content_bytes_used || serializedBytes(composition) > composition.max_context_bytes) {
    throw new ContextComposerValidationError();
  }
  return composition;
}

function parseContextEntry(value: unknown): ContextEntry {
  const record = strictRecord(value, [
    "kind",
    "trust_level",
    "content",
    "data_classification",
    "confidence",
    "provenance",
  ], ContextComposerValidationError);
  const kind = parseEntryKind(record.kind);
  const trustLevel = parseTrustLevel(record.trust_level);
  const content = normalizeContent(record.content, ContextComposerValidationError);
  const dataClassification = parseContextClassification(record.data_classification);
  const confidence = record.confidence === null ? null : boundedConfidence(record.confidence, ContextComposerValidationError);
  const provenance = parseProvenance(record.provenance);
  const entry: ContextEntry = Object.freeze({
    kind,
    trust_level: trustLevel,
    content,
    data_classification: dataClassification,
    confidence,
    provenance,
  });
  assertEntryBinding(entry);
  return entry;
}

function parseEntryKind(value: unknown): EntryKind {
  if (value !== "conversation_summary" && value !== "confirmed_fact" && value !== "approved_knowledge"
    && value !== "suggestion" && value !== "hypothesis") {
    throw new ContextComposerValidationError();
  }
  return value;
}

function parseTrustLevel(value: unknown): TrustLevel {
  if (value !== "confirmed" && value !== "uncertain" && value !== "untrusted") {
    throw new ContextComposerValidationError();
  }
  return value;
}

function parseContextClassification(value: unknown): DataClassification {
  try {
    if (typeof value !== "string") throw new ContextComposerValidationError();
    return parseDataClassification(value);
  } catch (error) {
    if (error instanceof ContextComposerValidationError) throw error;
    throw new ContextComposerValidationError();
  }
}

function parseProvenance(value: unknown): ContextEntry["provenance"] {
  const record = strictRecord(value, [
    "source_kind",
    "source_id",
    "source_version",
    "checksum_sha256",
    "evidence_refs",
    "observed_at",
    "expires_at",
  ], ContextComposerValidationError);
  const sourceKind = parseProvenanceKind(record.source_kind);
  const sourceId = parseOpaqueId(record.source_id, ContextComposerValidationError);
  const sourceVersion = boundedString(record.source_version, 1, 120, ContextComposerValidationError);
  if (record.checksum_sha256 !== null && (typeof record.checksum_sha256 !== "string" || !SHA256_PATTERN.test(record.checksum_sha256))) {
    throw new ContextComposerValidationError();
  }
  const evidenceRefs = normalizeEvidenceRefs(record.evidence_refs, ContextComposerValidationError);
  const observedAt = parseTimestamp(record.observed_at, ContextComposerValidationError);
  const expiresAt = record.expires_at === null ? null : parseTimestamp(record.expires_at, ContextComposerValidationError);
  return Object.freeze({
    source_kind: sourceKind,
    source_id: sourceId,
    source_version: sourceVersion,
    checksum_sha256: record.checksum_sha256,
    evidence_refs: Object.freeze([...evidenceRefs]) as unknown as string[],
    observed_at: observedAt.value,
    expires_at: expiresAt?.value ?? null,
  });
}

function parseProvenanceKind(value: unknown): ProvenanceKind {
  if (value !== "interaction_state" && value !== "approved_knowledge_catalog" && value !== "server_owned_suggestion_snapshot") {
    throw new ContextComposerValidationError();
  }
  return value;
}

function assertEntryBinding(entry: ContextEntry): void {
  const provenance = entry.provenance;
  if (entry.kind === "conversation_summary") {
    if (entry.trust_level !== "untrusted" || entry.confidence !== null || provenance.source_kind !== "interaction_state"
      || provenance.checksum_sha256 !== null || provenance.expires_at !== null) {
      throw new ContextComposerValidationError();
    }
    return;
  }
  if (entry.kind === "confirmed_fact") {
    if (entry.trust_level !== "confirmed" || entry.confidence === null || provenance.source_kind !== "interaction_state"
      || provenance.checksum_sha256 !== null) {
      throw new ContextComposerValidationError();
    }
    return;
  }
  if (entry.kind === "approved_knowledge") {
    if (entry.trust_level !== "untrusted" || entry.confidence !== null || provenance.source_kind !== "approved_knowledge_catalog"
      || provenance.checksum_sha256 === null || provenance.evidence_refs.length === 0
      || entry.data_classification === "restricted") {
      throw new ContextComposerValidationError();
    }
    return;
  }
  if (entry.trust_level !== "uncertain" || entry.confidence === null
    || provenance.source_kind !== "server_owned_suggestion_snapshot" || provenance.checksum_sha256 !== null
    || provenance.expires_at === null || entry.data_classification === "restricted") {
    throw new ContextComposerValidationError();
  }
  if (entry.kind === "hypothesis" && provenance.evidence_refs.length === 0) throw new ContextComposerValidationError();
}

function assertEntriesOrdered(entries: readonly ContextEntry[]): void {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const key = `${entry.kind}:${entry.provenance.source_kind}:${entry.provenance.source_id}`;
    if (seen.has(key)) throw new ContextComposerValidationError();
    seen.add(key);
    const previous = entries[index - 1];
    if (previous !== undefined && compareContextEntries(previous, entry) > 0) throw new ContextComposerValidationError();
  }
}

function compareContextEntries(left: ContextEntry, right: ContextEntry): number {
  const rankDifference = entryRank(left.kind) - entryRank(right.kind);
  if (rankDifference !== 0) return rankDifference;
  const leftObservedAt = parseTimestamp(left.provenance.observed_at, ContextComposerValidationError).milliseconds;
  const rightObservedAt = parseTimestamp(right.provenance.observed_at, ContextComposerValidationError).milliseconds;
  if (leftObservedAt !== rightObservedAt) return rightObservedAt - leftObservedAt;
  const sourceIdComparison = compareText(left.provenance.source_id, right.provenance.source_id);
  if (sourceIdComparison !== 0) return sourceIdComparison;
  const sourceVersionComparison = compareText(left.provenance.source_version, right.provenance.source_version);
  if (sourceVersionComparison !== 0) return sourceVersionComparison;
  return compareText(left.content, right.content);
}

function entryRank(kind: EntryKind): number {
  if (kind === "conversation_summary") return 0;
  if (kind === "confirmed_fact") return 1;
  if (kind === "approved_knowledge") return 2;
  return kind === "suggestion" ? 3 : 4;
}

function assertCompositionExpiry(entries: readonly ContextEntry[], expiresAt: NormalizedTimestamp | null): void {
  const entryExpiry = entries
    .map((entry) => entry.provenance.expires_at === null ? null : parseTimestamp(entry.provenance.expires_at, ContextComposerValidationError).milliseconds)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0];
  if (entryExpiry === undefined && expiresAt !== null) throw new ContextComposerValidationError();
  if (entryExpiry !== undefined && (expiresAt === null || expiresAt.milliseconds !== entryExpiry)) {
    throw new ContextComposerValidationError();
  }
}

function assertEntryLifetimes(entries: readonly ContextEntry[], composedAt: NormalizedTimestamp): void {
  for (const entry of entries) {
    const observedAt = parseTimestamp(entry.provenance.observed_at, ContextComposerValidationError);
    const expiresAt = entry.provenance.expires_at === null
      ? null
      : parseTimestamp(entry.provenance.expires_at, ContextComposerValidationError);
    if (observedAt.milliseconds > composedAt.milliseconds) throw new ContextComposerValidationError();
    if (expiresAt !== null && (observedAt.milliseconds > expiresAt.milliseconds || expiresAt.milliseconds <= composedAt.milliseconds)) {
      throw new ContextComposerValidationError();
    }
  }
}

function normalizeOptions(input: ContextComposerOptions | undefined): NormalizedComposerOptions {
  const record = input === undefined
    ? Object.create(null) as Record<string, unknown>
    : strictRecord(input, [
      "approved_knowledge_catalog",
      "suggestion_snapshot",
      "clock",
      "default_max_context_bytes",
    ], ContextComposerConfigurationError, true);
  const knowledge = record.approved_knowledge_catalog === undefined
    ? Object.freeze([]) as readonly KnowledgeRecord[]
    : resolveCatalog(record.approved_knowledge_catalog);
  const suggestions = record.suggestion_snapshot === undefined
    ? Object.freeze([]) as readonly SuggestionRecord[]
    : resolveSnapshot(record.suggestion_snapshot);
  const clock = record.clock === undefined ? SYSTEM_CLOCK : normalizeClock(record.clock);
  return Object.freeze({
    knowledge,
    suggestions,
    clock,
    defaultMaxContextBytes: boundedInteger(
      record.default_max_context_bytes === undefined ? DEFAULT_MAX_CONTEXT_BYTES : record.default_max_context_bytes,
      MIN_CONTEXT_BYTES,
      MAX_CONTEXT_BYTES,
      ContextComposerConfigurationError,
    ),
  });
}

function resolveCatalog(value: unknown): readonly KnowledgeRecord[] {
  if (value === null || typeof value !== "object") throw new ContextComposerConfigurationError();
  const entries = KNOWLEDGE_CATALOGS.get(value as ApprovedKnowledgeCatalog);
  if (entries === undefined) throw new ContextComposerConfigurationError();
  return entries;
}

function resolveSnapshot(value: unknown): readonly SuggestionRecord[] {
  if (value === null || typeof value !== "object") throw new ContextComposerConfigurationError();
  const entries = SUGGESTION_SNAPSHOTS.get(value as ContextSuggestionSnapshot);
  if (entries === undefined) throw new ContextComposerConfigurationError();
  return entries;
}

function normalizeCompositionInput(
  input: ContextCompositionInput,
  defaultMaxContextBytes: number,
  authority: object,
): NormalizedCompositionInput {
  const record = strictRecord(input, ["state_snapshot", "max_context_bytes"], ContextComposerValidationError, true);
  const captured = resolveCapturedState(record.state_snapshot, authority);
  const maxContextBytes = record.max_context_bytes === undefined
    ? defaultMaxContextBytes
    : boundedInteger(record.max_context_bytes, MIN_CONTEXT_BYTES, MAX_CONTEXT_BYTES, ContextComposerValidationError);
  return Object.freeze({
    state: captured.state,
    tenantId: captured.tenantId,
    sessionId: captured.sessionId,
    maxContextBytes,
  });
}

function resolveCapturedState(value: unknown, authority: object): CapturedState {
  if (value === null || typeof value !== "object") throw new ContextComposerValidationError();
  const captured = STATE_SNAPSHOTS.get(value as ContextStateSnapshot);
  if (captured === undefined || captured.authority !== authority) throw new ContextComposerValidationError();
  try {
    if (interactionStateHash(captured.state) !== captured.stateHash) throw new ContextComposerValidationError();
  } catch (error) {
    if (error instanceof ContextComposerValidationError) throw error;
    throw new ContextComposerValidationError();
  }
  return captured;
}

function requireContextAccess(request: AuthorizedRequestContext): ReturnType<typeof getAuthorizedTenantContext> {
  try {
    const context = getAuthorizedTenantContext(request);
    if (!context.grantedScopes.includes("session:read") || !context.purposes.includes("essential_processing")) {
      throw new ContextComposerAuthorizationError();
    }
    return context;
  } catch (error) {
    if (error instanceof ContextComposerAuthorizationError) throw error;
    throw new ContextComposerAuthorizationError();
  }
}

function buildCandidates(
  input: NormalizedCompositionInput,
  options: NormalizedComposerOptions,
  now: number,
): readonly Candidate[] {
  const candidates: Candidate[] = [];
  const state = input.state;
  const stateVersion = state.session.state_version;
  const summaryObservedAt = tryTimestamp(state.conversation.updated_at);
  if (summaryObservedAt !== null && summaryObservedAt.milliseconds <= now) {
    const summary = tryContent(state.conversation.incremental_summary);
    if (summary !== null) {
      candidates.push(createCandidate({
        kind: "conversation_summary",
        trustLevel: "untrusted",
        content: summary,
        dataClassification: "restricted",
        confidence: null,
        sourceKind: "interaction_state",
        sourceId: "conversation-summary",
        sourceVersion: String(stateVersion),
        checksumSha256: null,
        evidenceRefs: [],
        observedAt: summaryObservedAt,
        expiresAt: null,
        rank: 0,
      }));
    }
  }
  for (const fact of state.conversation.confirmed_facts) {
    if (fact.kind === "derived_hypothesis" || fact.kind === "system_observation") continue;
    const observedAt = tryTimestamp(fact.observed_at);
    const expiresAt = fact.expires_at === null ? null : tryTimestamp(fact.expires_at);
    const content = tryContent(fact.summary);
    if (observedAt === null || observedAt.milliseconds > now || content === null) continue;
    if (expiresAt !== null && (expiresAt.milliseconds <= now || observedAt.milliseconds > expiresAt.milliseconds)) continue;
    candidates.push(createCandidate({
      kind: "confirmed_fact",
      trustLevel: "confirmed",
      content,
      dataClassification: "restricted",
      confidence: fact.confidence,
      sourceKind: "interaction_state",
      sourceId: parseUuidV7(fact.evidence_id, "evidence_id"),
      sourceVersion: String(stateVersion),
      checksumSha256: null,
      evidenceRefs: [parseUuidV7(fact.evidence_id, "evidence_id")],
      observedAt,
      expiresAt,
      rank: 1,
    }));
  }
  for (const knowledge of options.knowledge) {
    if (knowledge.tenantId !== input.tenantId
      || knowledge.rolePackId !== state.role.role_pack_id
      || knowledge.rolePackVersion !== state.role.role_pack_version
      || knowledge.purpose !== "essential_processing"
      || knowledge.status !== "approved"
      || knowledge.observedAt.milliseconds > now
      || knowledge.expiresAt !== null && (knowledge.expiresAt.milliseconds <= now
        || knowledge.observedAt.milliseconds > knowledge.expiresAt.milliseconds)) {
      continue;
    }
    candidates.push(createCandidate({
      kind: "approved_knowledge",
      trustLevel: "untrusted",
      content: knowledge.content,
      dataClassification: knowledge.dataClassification,
      confidence: null,
      sourceKind: "approved_knowledge_catalog",
      sourceId: knowledge.id,
      sourceVersion: knowledge.sourceVersion,
      checksumSha256: knowledge.checksumSha256,
      evidenceRefs: [knowledge.approvalReceipt],
      observedAt: knowledge.observedAt,
      expiresAt: knowledge.expiresAt,
      rank: 2,
    }));
  }
  for (const suggestion of options.suggestions) {
    if (suggestion.tenantId !== input.tenantId
      || suggestion.sessionId !== input.sessionId
      || suggestion.contextVersion !== stateVersion
      || suggestion.createdAt.milliseconds > now
      || suggestion.createdAt.milliseconds > suggestion.expiresAt.milliseconds
      || suggestion.expiresAt.milliseconds <= now
      || suggestion.allowedUse !== "presenter_context"
      || suggestion.consentStatus === "missing"
      || suggestion.kind === "hypothesis" && suggestion.evidenceRefs.length === 0) {
      continue;
    }
    candidates.push(createCandidate({
      kind: suggestion.kind,
      trustLevel: "uncertain",
      content: suggestion.content,
      dataClassification: suggestion.dataClassification,
      confidence: suggestion.confidence,
      sourceKind: "server_owned_suggestion_snapshot",
      sourceId: suggestion.id,
      sourceVersion: suggestion.sourceVersion,
      checksumSha256: null,
      evidenceRefs: suggestion.evidenceRefs,
      observedAt: suggestion.createdAt,
      expiresAt: suggestion.expiresAt,
      rank: suggestion.kind === "suggestion" ? 3 : 4,
    }));
  }
  return candidates;
}

function createCandidate(input: {
  readonly kind: EntryKind;
  readonly trustLevel: TrustLevel;
  readonly content: string;
  readonly dataClassification: DataClassification;
  readonly confidence: number | null;
  readonly sourceKind: ProvenanceKind;
  readonly sourceId: string;
  readonly sourceVersion: string;
  readonly checksumSha256: string | null;
  readonly evidenceRefs: readonly string[];
  readonly observedAt: NormalizedTimestamp;
  readonly expiresAt: NormalizedTimestamp | null;
  readonly rank: number;
}): Candidate {
  const entry: ContextEntry = Object.freeze({
    kind: input.kind,
    trust_level: input.trustLevel,
    content: input.content,
    data_classification: input.dataClassification,
    confidence: input.confidence,
    provenance: Object.freeze({
      source_kind: input.sourceKind,
      source_id: input.sourceId,
      source_version: input.sourceVersion,
      checksum_sha256: input.checksumSha256,
      evidence_refs: Object.freeze([...input.evidenceRefs]) as unknown as string[],
      observed_at: input.observedAt.value,
      expires_at: input.expiresAt?.value ?? null,
    }),
  });
  return Object.freeze({
    entry,
    rank: input.rank,
    observedAtMs: input.observedAt.milliseconds,
    sourceId: input.sourceId,
    sourceVersion: input.sourceVersion,
    expiresAtMs: input.expiresAt?.milliseconds ?? null,
  });
}

function uniqueSortedCandidates(candidates: readonly Candidate[]): readonly Candidate[] {
  const sorted = [...candidates].sort(compareCandidates);
  const keys = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of sorted) {
    const key = `${candidate.entry.kind}:${candidate.entry.provenance.source_kind}:${candidate.sourceId}`;
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(candidate);
  }
  return Object.freeze(unique);
}

function compareCandidates(left: Candidate, right: Candidate): number {
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.observedAtMs !== right.observedAtMs) return right.observedAtMs - left.observedAtMs;
  const sourceIdComparison = compareText(left.sourceId, right.sourceId);
  if (sourceIdComparison !== 0) return sourceIdComparison;
  const sourceVersionComparison = compareText(left.sourceVersion, right.sourceVersion);
  if (sourceVersionComparison !== 0) return sourceVersionComparison;
  return compareText(left.entry.content, right.entry.content);
}

function composeBounded(
  input: NormalizedCompositionInput,
  candidates: readonly Candidate[],
  now: number,
): ContextComposition {
  const selected: Candidate[] = [];
  let omitted = 0;
  for (const candidate of candidates) {
    if (selected.length >= MAX_OUTPUT_ENTRIES) {
      omitted += 1;
      continue;
    }
    const prospective = buildComposition(input, [...selected, candidate], omitted, now);
    if (serializedBytes(prospective) <= input.maxContextBytes) {
      selected.push(candidate);
    } else {
      omitted += 1;
    }
  }
  let composition = buildComposition(input, selected, omitted, now);
  while (serializedBytes(composition) > input.maxContextBytes && selected.length > 0) {
    selected.pop();
    omitted += 1;
    composition = buildComposition(input, selected, omitted, now);
  }
  if (serializedBytes(composition) > input.maxContextBytes) throw new ContextComposerBudgetError();
  return composition;
}

function buildComposition(
  input: NormalizedCompositionInput,
  candidates: readonly Candidate[],
  omittedEntryCount: number,
  now: number,
): ContextComposition {
  const entries = candidates.map((candidate) => cloneEntry(candidate.entry));
  const expiry = candidates
    .map((candidate) => candidate.expiresAtMs)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0];
  const contentBytesUsed = entries.reduce((total, entry) => total + UTF8.encode(entry.content).byteLength, 0);
  return Object.freeze({
    schema_version: CURRENT_SCHEMA_VERSION,
    tenant_id: input.tenantId,
    session_id: input.sessionId,
    context_version: input.state.session.state_version,
    max_context_bytes: input.maxContextBytes,
    content_bytes_used: contentBytesUsed,
    omitted_entry_count: omittedEntryCount,
    composed_at: new Date(now).toISOString(),
    expires_at: expiry === undefined ? null : new Date(expiry).toISOString(),
    entries: Object.freeze(entries) as unknown as ContextComposition["entries"],
  });
}

function cloneEntry(entry: ContextEntry): ContextEntry {
  return Object.freeze({
    kind: entry.kind,
    trust_level: entry.trust_level,
    content: entry.content,
    data_classification: entry.data_classification,
    confidence: entry.confidence,
    provenance: Object.freeze({
      source_kind: entry.provenance.source_kind,
      source_id: entry.provenance.source_id,
      source_version: entry.provenance.source_version,
      checksum_sha256: entry.provenance.checksum_sha256,
      evidence_refs: Object.freeze([...entry.provenance.evidence_refs]) as unknown as string[],
      observed_at: entry.provenance.observed_at,
      expires_at: entry.provenance.expires_at,
    }),
  });
}

function serializedBytes(value: ContextComposition): number {
  return UTF8.encode(JSON.stringify(value)).byteLength;
}

function normalizeClock(value: unknown): ContextComposerClock {
  if (value === null || typeof value !== "object" || typeof (value as ContextComposerClock).now !== "function") {
    throw new ContextComposerConfigurationError();
  }
  return value as ContextComposerClock;
}

function checkedNow(clock: ContextComposerClock): number {
  const now = clock.now();
  if (!Number.isSafeInteger(now) || now < 0) throw new ContextComposerConfigurationError();
  return now;
}

function parseSafeContextClassification(value: unknown, ErrorType: new () => Error): SafeContextClassification {
  try {
    if (typeof value !== "string") throw new ErrorType();
    const classification = parseDataClassification(value);
    if (classification === "restricted") throw new ErrorType();
    return classification;
  } catch (error) {
    if (error instanceof ErrorType) throw error;
    throw new ErrorType();
  }
}

function normalizeContent(value: unknown, ErrorType: new () => Error): string {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_CONTENT_CHARACTERS
    || value.includes("\u0000") || UTF8.encode(value).byteLength > MAX_ENTRY_CONTENT_BYTES) {
    throw new ErrorType();
  }
  return value;
}

function tryContent(value: unknown): string | null {
  try {
    return normalizeContent(value, ContextComposerValidationError);
  } catch {
    return null;
  }
}

function normalizeEvidenceRefs(value: unknown, ErrorType: new () => Error): readonly string[] {
  if (!Array.isArray(value) || value.length > 100) throw new ErrorType();
  const references = value.map((entry) => parseOpaqueId(entry, ErrorType));
  if (new Set(references).size !== references.length) throw new ErrorType();
  return Object.freeze(references);
}

function parseOpaqueId(value: unknown, ErrorType: new () => Error = ContextComposerConfigurationError): string {
  if (typeof value !== "string" || !OPAQUE_ID_PATTERN.test(value)) throw new ErrorType();
  return value;
}

function parseTimestamp(value: unknown, ErrorType: new () => Error): NormalizedTimestamp {
  if (typeof value !== "string" || value.length < 20 || value.length > 64) {
    throw new ErrorType();
  }
  const match = RFC3339_PATTERN.exec(value);
  if (match === null) throw new ErrorType();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const timezone = match[8]!;
  if (!Number.isSafeInteger(year) || year < 1 || year > 9_999
    || month < 1 || month > 12
    || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59
    || !validTimezoneOffset(timezone)) {
    throw new ErrorType();
  }
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds)) throw new ErrorType();
  return Object.freeze({ value, milliseconds });
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validTimezoneOffset(value: string): boolean {
  if (value === "Z") return true;
  const hours = Number(value.slice(1, 3));
  const minutes = Number(value.slice(4, 6));
  return hours <= 23 && minutes <= 59;
}

function tryTimestamp(value: unknown): NormalizedTimestamp | null {
  try {
    return parseTimestamp(value, ContextComposerValidationError);
  } catch {
    return null;
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number, ErrorType: new () => Error): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ErrorType();
  }
  return value;
}

function boundedConfidence(value: unknown, ErrorType: new () => Error): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new ErrorType();
  return value;
}

function boundedString(value: unknown, minimum: number, maximum: number, ErrorType: new () => Error): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.includes("\u0000")) {
    throw new ErrorType();
  }
  return value;
}

function strictRecord(
  value: unknown,
  allowedKeys: readonly string[],
  ErrorType: new () => Error,
  optional = false,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new ErrorType();
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error();
    }
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new ErrorType();
  }
  const keys = Object.keys(descriptors);
  if (keys.some((key) => !allowedKeys.includes(key))) throw new ErrorType();
  if (!optional && allowedKeys.some((key) => descriptors[key] === undefined)) throw new ErrorType();
  for (const descriptor of Object.values(descriptors)) {
    if (!("value" in descriptor)) throw new ErrorType();
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
