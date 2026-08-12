/**
 * M3-02: in-memory store mirroring database/migrations/0004_knowledge_governance.sql
 * column-for-column (ADR-031). No PostgreSQL, provider, or network dependency
 * — the real schema is proven separately by scripts/database-integration.mjs.
 */
import { UUID_V7_PATTERN as TENANT_ID_PATTERN } from "@axtro/domain";

export type DataClassification = "public" | "internal" | "confidential" | "restricted";
export type KnowledgeSourceStatus = "pending" | "active" | "stale" | "disabled" | "deleted";
export type AuthorityLevel = "authoritative" | "reference" | "draft";

export interface KnowledgeSource {
  readonly tenantId: string;
  readonly sourceId: string;
  readonly sourceType: string;
  readonly displayName: string;
  readonly dataClassification: DataClassification;
  readonly authorityLevel: AuthorityLevel;
  readonly allowedRolePackIds: readonly string[];
  readonly allowedProducts: readonly string[];
  readonly allowedLocales: readonly string[];
  readonly status: KnowledgeSourceStatus;
}

export interface KnowledgeVersion {
  readonly tenantId: string;
  readonly versionId: string;
  readonly sourceId: string;
  readonly version: string;
  readonly contentHash: string;
  readonly validFromMs: number;
  readonly validToMs: number | null;
}

export interface KnowledgeChunk {
  readonly tenantId: string;
  readonly chunkId: string;
  readonly versionId: string;
  readonly chunkIndex: number;
  readonly contentText: string;
  readonly citationLocator: string;
}

export interface KnowledgeEmbedding {
  readonly tenantId: string;
  readonly embeddingId: string;
  readonly chunkId: string;
  readonly embeddingModel: string;
  readonly embeddingDimensions: number;
  readonly embedding: readonly number[];
}

export class KnowledgeStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeStoreError";
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const DATA_CLASSIFICATIONS: readonly DataClassification[] = ["public", "internal", "confidential", "restricted"];
const AUTHORITY_LEVELS: readonly AuthorityLevel[] = ["authoritative", "reference", "draft"];
const MAX_CHUNK_TEXT_BYTES = 20_000;

export interface RegisterSourceInput {
  readonly tenantId: string;
  readonly sourceId: string;
  readonly sourceType: string;
  readonly displayName: string;
  readonly dataClassification: DataClassification;
  readonly authorityLevel: AuthorityLevel;
  readonly allowedRolePackIds?: readonly string[];
  readonly allowedProducts?: readonly string[];
  readonly allowedLocales?: readonly string[];
}

export interface PublishVersionInput {
  readonly tenantId: string;
  readonly versionId: string;
  readonly sourceId: string;
  readonly version: string;
  readonly contentHash: string;
  readonly validFromMs: number;
  readonly validToMs?: number | null;
}

export interface AddChunkInput {
  readonly tenantId: string;
  readonly chunkId: string;
  readonly versionId: string;
  readonly chunkIndex: number;
  readonly contentText: string;
  readonly citationLocator: string;
}

export interface AddEmbeddingInput {
  readonly tenantId: string;
  readonly embeddingId: string;
  readonly chunkId: string;
  readonly embeddingModel: string;
  readonly embedding: readonly number[];
}

export interface KnowledgeStore {
  registerSource(input: unknown): KnowledgeSource;
  activateSource(tenantId: unknown, sourceId: unknown): void;
  disableSource(tenantId: unknown, sourceId: unknown): void;
  getSource(tenantId: string, sourceId: string): KnowledgeSource | undefined;
  publishVersion(input: unknown, nowMs: unknown): KnowledgeVersion;
  addChunk(input: unknown): KnowledgeChunk;
  addEmbedding(input: unknown): KnowledgeEmbedding;
  listChunksForTenant(tenantId: string): readonly KnowledgeChunk[];
  getVersion(tenantId: string, versionId: string): KnowledgeVersion | undefined;
  getEmbeddingForChunk(tenantId: string, chunkId: string): KnowledgeEmbedding | undefined;
}

export function createKnowledgeStore(): KnowledgeStore {
  const sources = new Map<string, KnowledgeSource>();
  const versions = new Map<string, KnowledgeVersion>();
  const chunks = new Map<string, KnowledgeChunk>();
  const embeddings = new Map<string, KnowledgeEmbedding>();

  const sourceKey = (tenantId: string, sourceId: string): string => `${tenantId}:${sourceId}`;
  const versionKey = (tenantId: string, versionId: string): string => `${tenantId}:${versionId}`;
  const chunkKey = (tenantId: string, chunkId: string): string => `${tenantId}:${chunkId}`;

  const requireSource = (tenantId: string, sourceId: string): KnowledgeSource => {
    const source = sources.get(sourceKey(tenantId, sourceId));
    if (source === undefined) throw new KnowledgeStoreError(`unknown knowledge source: ${sourceId}`);
    return source;
  };

  return Object.freeze({
    registerSource(rawInput: unknown): KnowledgeSource {
      const input = parseRegisterSourceInput(rawInput);
      const key = sourceKey(input.tenantId, input.sourceId);
      if (sources.has(key)) throw new KnowledgeStoreError(`knowledge source already registered: ${input.sourceId}`);
      const source: KnowledgeSource = Object.freeze({
        tenantId: input.tenantId,
        sourceId: input.sourceId,
        sourceType: input.sourceType,
        displayName: input.displayName,
        dataClassification: input.dataClassification,
        authorityLevel: input.authorityLevel,
        allowedRolePackIds: Object.freeze([...(input.allowedRolePackIds ?? [])]),
        allowedProducts: Object.freeze([...(input.allowedProducts ?? [])]),
        allowedLocales: Object.freeze([...(input.allowedLocales ?? [])]),
        status: "pending",
      });
      sources.set(key, source);
      return source;
    },

    activateSource(rawTenantId: unknown, rawSourceId: unknown): void {
      const tenantId = parseTenantId(rawTenantId);
      const sourceId = parseId(rawSourceId, "sourceId");
      const source = requireSource(tenantId, sourceId);
      if (source.status === "deleted") throw new KnowledgeStoreError("a deleted source cannot be activated");
      sources.set(sourceKey(tenantId, sourceId), Object.freeze({ ...source, status: "active" }));
    },

    disableSource(rawTenantId: unknown, rawSourceId: unknown): void {
      const tenantId = parseTenantId(rawTenantId);
      const sourceId = parseId(rawSourceId, "sourceId");
      const source = requireSource(tenantId, sourceId);
      sources.set(sourceKey(tenantId, sourceId), Object.freeze({ ...source, status: "disabled" }));
    },

    getSource(tenantId: string, sourceId: string): KnowledgeSource | undefined {
      return sources.get(sourceKey(tenantId, sourceId));
    },

    publishVersion(rawInput: unknown, rawNowMs: unknown): KnowledgeVersion {
      const input = parsePublishVersionInput(rawInput);
      const nowMs = parseTimestampMs(rawNowMs, "nowMs");
      const source = requireSource(input.tenantId, input.sourceId);
      if (source.status !== "active" && source.status !== "stale") {
        throw new KnowledgeStoreError("a version can only be published for an active source");
      }
      const key = versionKey(input.tenantId, input.versionId);
      if (versions.has(key)) throw new KnowledgeStoreError(`knowledge version already published: ${input.versionId}`);

      // Revocation: the previously current version (validToMs === null) for
      // this source is superseded as of this new version's validFromMs.
      for (const [existingKey, existing] of versions) {
        if (existing.tenantId !== input.tenantId || existing.sourceId !== input.sourceId || existing.validToMs !== null) continue;
        versions.set(existingKey, Object.freeze({ ...existing, validToMs: input.validFromMs }));
      }
      const version: KnowledgeVersion = Object.freeze({
        tenantId: input.tenantId,
        versionId: input.versionId,
        sourceId: input.sourceId,
        version: input.version,
        contentHash: input.contentHash,
        validFromMs: input.validFromMs,
        validToMs: input.validToMs ?? null,
      });
      versions.set(key, version);
      sources.set(sourceKey(input.tenantId, input.sourceId), Object.freeze({ ...source, status: "active" }));
      return version;
    },

    addChunk(rawInput: unknown): KnowledgeChunk {
      const input = parseAddChunkInput(rawInput);
      const version = versions.get(versionKey(input.tenantId, input.versionId));
      if (version === undefined) throw new KnowledgeStoreError(`unknown knowledge version: ${input.versionId}`);
      const key = chunkKey(input.tenantId, input.chunkId);
      if (chunks.has(key)) throw new KnowledgeStoreError(`knowledge chunk already exists: ${input.chunkId}`);
      const chunk: KnowledgeChunk = Object.freeze({ ...input });
      chunks.set(key, chunk);
      return chunk;
    },

    addEmbedding(rawInput: unknown): KnowledgeEmbedding {
      const input = parseAddEmbeddingInput(rawInput);
      const chunk = chunks.get(chunkKey(input.tenantId, input.chunkId));
      if (chunk === undefined) throw new KnowledgeStoreError(`unknown knowledge chunk: ${input.chunkId}`);
      const embedding: KnowledgeEmbedding = Object.freeze({
        tenantId: input.tenantId,
        embeddingId: input.embeddingId,
        chunkId: input.chunkId,
        embeddingModel: input.embeddingModel,
        embeddingDimensions: input.embedding.length,
        embedding: Object.freeze([...input.embedding]),
      });
      embeddings.set(chunkKey(input.tenantId, input.chunkId), embedding);
      return embedding;
    },

    listChunksForTenant(tenantId: string): readonly KnowledgeChunk[] {
      return Object.freeze([...chunks.values()].filter((chunk) => chunk.tenantId === tenantId));
    },

    getVersion(tenantId: string, versionId: string): KnowledgeVersion | undefined {
      return versions.get(versionKey(tenantId, versionId));
    },

    getEmbeddingForChunk(tenantId: string, chunkId: string): KnowledgeEmbedding | undefined {
      return embeddings.get(chunkKey(tenantId, chunkId));
    },
  } satisfies KnowledgeStore);
}

// Internal accessors used by the retrieval pipeline in the same package.
export function sourceForVersion(store: KnowledgeStore, tenantId: string, versionId: string): { source: KnowledgeSource; version: KnowledgeVersion } | undefined {
  const version = store.getVersion(tenantId, versionId);
  if (version === undefined) return undefined;
  const source = store.getSource(tenantId, version.sourceId);
  if (source === undefined) return undefined;
  return { source, version };
}

function parseTenantId(value: unknown): string {
  if (typeof value !== "string" || !TENANT_ID_PATTERN.test(value)) throw new KnowledgeStoreError("invalid tenantId");
  return value;
}

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new KnowledgeStoreError(`invalid ${label}`);
  return value;
}

function parseTimestampMs(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new KnowledgeStoreError(`invalid ${label}`);
  return value;
}

function parseStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new KnowledgeStoreError(`invalid ${label}`);
  return value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0 || item.length > 200) throw new KnowledgeStoreError(`invalid ${label}[${index}]`);
    return item;
  });
}

function parseDataClassification(value: unknown): DataClassification {
  if (typeof value !== "string" || !DATA_CLASSIFICATIONS.includes(value as DataClassification)) {
    throw new KnowledgeStoreError("invalid dataClassification");
  }
  return value as DataClassification;
}

function parseAuthorityLevel(value: unknown): AuthorityLevel {
  if (typeof value !== "string" || !AUTHORITY_LEVELS.includes(value as AuthorityLevel)) {
    throw new KnowledgeStoreError("invalid authorityLevel");
  }
  return value as AuthorityLevel;
}

function parseRegisterSourceInput(value: unknown): RegisterSourceInput {
  if (value === null || typeof value !== "object") throw new KnowledgeStoreError("invalid registerSource input");
  const record = value as Record<string, unknown>;
  return {
    tenantId: parseTenantId(record.tenantId),
    sourceId: parseId(record.sourceId, "sourceId"),
    sourceType: parseId(record.sourceType, "sourceType"),
    displayName: stringValue(record.displayName, "displayName", 1, 300),
    dataClassification: parseDataClassification(record.dataClassification),
    authorityLevel: parseAuthorityLevel(record.authorityLevel),
    allowedRolePackIds: parseStringArray(record.allowedRolePackIds, "allowedRolePackIds"),
    allowedProducts: parseStringArray(record.allowedProducts, "allowedProducts"),
    allowedLocales: parseStringArray(record.allowedLocales, "allowedLocales"),
  };
}

function parsePublishVersionInput(value: unknown): PublishVersionInput {
  if (value === null || typeof value !== "object") throw new KnowledgeStoreError("invalid publishVersion input");
  const record = value as Record<string, unknown>;
  const validToMs = record.validToMs === undefined || record.validToMs === null ? null : parseTimestampMs(record.validToMs, "validToMs");
  return {
    tenantId: parseTenantId(record.tenantId),
    versionId: parseId(record.versionId, "versionId"),
    sourceId: parseId(record.sourceId, "sourceId"),
    version: stringValue(record.version, "version", 1, 50),
    contentHash: patternValue(record.contentHash, "contentHash", CONTENT_HASH_PATTERN),
    validFromMs: parseTimestampMs(record.validFromMs, "validFromMs"),
    validToMs,
  };
}

function parseAddChunkInput(value: unknown): AddChunkInput {
  if (value === null || typeof value !== "object") throw new KnowledgeStoreError("invalid addChunk input");
  const record = value as Record<string, unknown>;
  const contentText = stringValue(record.contentText, "contentText", 1, MAX_CHUNK_TEXT_BYTES);
  if (new TextEncoder().encode(contentText).byteLength > MAX_CHUNK_TEXT_BYTES) {
    throw new KnowledgeStoreError("contentText exceeds the maximum chunk size");
  }
  return {
    tenantId: parseTenantId(record.tenantId),
    chunkId: parseId(record.chunkId, "chunkId"),
    versionId: parseId(record.versionId, "versionId"),
    chunkIndex: integerValue(record.chunkIndex, "chunkIndex"),
    contentText,
    citationLocator: stringValue(record.citationLocator, "citationLocator", 1, 300),
  };
}

function parseAddEmbeddingInput(value: unknown): AddEmbeddingInput {
  if (value === null || typeof value !== "object") throw new KnowledgeStoreError("invalid addEmbedding input");
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.embedding) || record.embedding.length === 0 || record.embedding.length > 4_096) {
    throw new KnowledgeStoreError("invalid embedding vector");
  }
  const embedding = record.embedding.map((component, index) => {
    if (typeof component !== "number" || !Number.isFinite(component)) throw new KnowledgeStoreError(`invalid embedding[${index}]`);
    return component;
  });
  return {
    tenantId: parseTenantId(record.tenantId),
    embeddingId: parseId(record.embeddingId, "embeddingId"),
    chunkId: parseId(record.chunkId, "chunkId"),
    embeddingModel: stringValue(record.embeddingModel, "embeddingModel", 1, 120),
    embedding,
  };
}

function stringValue(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new KnowledgeStoreError(`${label} must be a string between ${minimum} and ${maximum} characters`);
  }
  return value;
}

function patternValue(value: unknown, label: string, pattern: RegExp): string {
  const text = stringValue(value, label, 1, 200);
  if (!pattern.test(text)) throw new KnowledgeStoreError(`${label} does not match the required pattern`);
  return text;
}

function integerValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new KnowledgeStoreError(`${label} must be a non-negative integer`);
  return value;
}
