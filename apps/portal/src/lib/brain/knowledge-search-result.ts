import type { KnowledgeSearchResult } from "@axtro/contracts-ts";
import type { BrainKnowledgeMatch } from "./chat-completion-core.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MATCH_KEYS = ["source_id", "version_id", "chunk_id", "chunk_index", "content_hash", "source_name", "chunk_text", "score", "similarity", "match_kind", "trusted"];
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function text(value: unknown, max: number): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  // JSON Schema maxLength and PostgreSQL length count Unicode code points.
  let points = 0;
  for (const _point of value) { points += 1; if (points > max) return false; }
  return true;
}
function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}
/** Validate the complete closed wire object before projecting any raw content. */
export function parseKnowledgeSearchResult(value: unknown, tenantId: string): readonly BrainKnowledgeMatch[] {
  if (!UUID.test(tenantId) || !closed(value, ["schema_version", "tenant_id", "matches"])
    || value.schema_version !== "2.0.0" || value.tenant_id !== tenantId
    || !Array.isArray(value.matches) || value.matches.length > 12) return [];
  const ids = new Set<string>();
  for (const match of value.matches) {
    if (!closed(match, MATCH_KEYS) || ![match.source_id, match.version_id, match.chunk_id].every((id) => typeof id === "string" && UUID.test(id))
      || !Number.isSafeInteger(match.chunk_index) || (match.chunk_index as number) < 0 || (match.chunk_index as number) > 2147483647
      || typeof match.content_hash !== "string" || !/^[0-9a-f]{64}$/.test(match.content_hash)
      || !text(match.source_name, 300) || !text(match.chunk_text, 20000) || !finite(match.score, 0, 1) || match.trusted !== false
      || !["lexical", "vector", "hybrid"].includes(match.match_kind as string)
      || (match.match_kind === "lexical" ? match.similarity !== null : !finite(match.similarity, 0.25, 1))
      || ids.has(match.chunk_id as string)) return [];
    ids.add(match.chunk_id as string);
  }
  const result = value as unknown as KnowledgeSearchResult;
  return result.matches.map((match) => Object.freeze({
    source_name: match.source_name, chunk_text: match.chunk_text, trusted: false as const,
    citationStatus: "identified" as const,
    citation: Object.freeze({ source_id: match.source_id, version_id: match.version_id,
      chunk_id: match.chunk_id, chunk_index: match.chunk_index, content_hash: match.content_hash }),
  }));
}
