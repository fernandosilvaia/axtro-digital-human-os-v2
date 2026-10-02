import {
  AI_USAGE_LIMITS, beginAiUsage, commitAiUsage, markAiUsageInFlight, markAiUsageUnknown,
  recordAiUsageProviderFailure, releaseAiUsageNotDispatched, stableAiUsageIdempotencyKey,
  type AiUsageReservation, type AiUsageRpcClient,
} from "../ai-budget/reservations.ts";
import type { BrainKnowledgeMatch } from "./chat-completion-core.ts";
import { parseKnowledgeSearchResult } from "./knowledge-search-result.ts";

export interface KnowledgeRetrievalPorts {
  readonly client: AiUsageRpcClient;
  readonly apiKey: string;
  /** Read-only deadline, clamped to 1..2000ms. Mutating receipts have no race. */
  readonly readTimeoutMs?: number;
  readonly prepare: (text: string, maxTokens: number) => string;
  readonly embed: (key: string, text: string, maxTokens: number) => Promise<{
    embedding: readonly number[]; inputTokens: number; reportedCostUsd?: number;
  }>;
  /** Content-free event codes only. Never forward query, provider error or RPC payload. */
  readonly recordEvent?: (code: string) => void;
}
function validVector(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length === 1536
    && value.every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 3.402823466e38)
    && value.some((v) => v !== 0);
}

async function boundedRead(
  client: AiUsageRpcClient, args: Readonly<Record<string, unknown>>, requestedTimeout: number | undefined,
): Promise<Awaited<ReturnType<AiUsageRpcClient["rpc"]>>> {
  const timeout = typeof requestedTimeout === "number" && Number.isFinite(requestedTimeout)
    ? Math.max(1, Math.min(2000, Math.floor(requestedTimeout))) : 2000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      try { controller.abort(); } finally { reject(new Error("knowledge read deadline exceeded")); }
    }, timeout);
  });
  try {
    let request = client.rpc("portal_search_knowledge_hybrid_service", args);
    // Supabase PostgrestBuilder supports abortSignal. Deterministic port fakes
    // may only expose PromiseLike; the response deadline still applies.
    const abortable = request as typeof request & { abortSignal?: (signal: AbortSignal) => typeof request };
    if (typeof abortable.abortSignal === "function") request = abortable.abortSignal(controller.signal);
    return await Promise.race([Promise.resolve(request), deadline]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

/** Actual route selection, paid fence and lexical degradation, with injectable I/O. */
export async function retrieveBrainKnowledge(
  input: { tenantId: string; agentId: string; queryText: string; idempotencyMaterial: string },
  ports: KnowledgeRetrievalPorts,
): Promise<readonly BrainKnowledgeMatch[]> {
  const query = input.queryText.trim();
  if (query.length === 0 || new TextEncoder().encode(query).byteLength > 2000) return [];
  let embedding: readonly number[] | null = null;
  let reservation: AiUsageReservation | undefined;
  let dispatched = false;
  let terminal = false;
  const event = (code: string): void => { try { ports.recordEvent?.(code); } catch { /* telemetry cannot change paid authority or degradation */ } };
  if (ports.apiKey.trim().length > 0) {
    try {
      const prepared = ports.prepare(query, AI_USAGE_LIMITS.knowledge_query_embedding.maxInputTokens);
      const begin = await beginAiUsage({ client: ports.client, tenantId: input.tenantId,
        operation: "knowledge_query_embedding", agentId: input.agentId,
        idempotencyKey: stableAiUsageIdempotencyKey("knowledge_query_embedding", input.idempotencyMaterial) });
      if (begin.allowed) {
        reservation = begin.reservation;
        dispatched = await markAiUsageInFlight(ports.client, reservation);
        if (dispatched) {
          const result = await ports.embed(ports.apiKey, prepared, AI_USAGE_LIMITS.knowledge_query_embedding.maxInputTokens);
          const committed = await commitAiUsage(ports.client, reservation, { inputTokens: result.inputTokens,
            outputTokens: 0, ...(result.reportedCostUsd === undefined ? {} : { reportedCostUsd: result.reportedCostUsd }) });
          if (committed) {
            terminal = true;
            if (validVector(result.embedding)) embedding = result.embedding;
            else event("brain_knowledge_vector_invalid");
          } else {
            await markAiUsageUnknown(ports.client, reservation, "usage_commit_failed");
            terminal = true;
            event("brain_knowledge_usage_commit_failed");
          }
        } else if (reservation.state === "reserved") {
          await releaseAiUsageNotDispatched(ports.client, reservation);
        }
      }
    } catch (error) {
      // Reconciliation proof remains pending after ANY attempted provider failure.
      try {
        if (reservation !== undefined && dispatched && !terminal) await recordAiUsageProviderFailure(ports.client, reservation, error);
        else if (reservation !== undefined && !dispatched && reservation.state === "reserved") await releaseAiUsageNotDispatched(ports.client, reservation);
      } catch { event("brain_knowledge_usage_receipt_pending"); }
      event("brain_knowledge_embedding_unavailable");
    }
  }
  try {
    const result = await boundedRead(ports.client, {
      p_tenant_id: input.tenantId, p_query_text: query, p_embedding: embedding, p_limit: 5,
    }, ports.readTimeoutMs);
    if (result.error === null) return parseKnowledgeSearchResult(result.data, input.tenantId);
    // No fallback to historical retrieval: unavailable schema cannot prove
    // current validity and policy admission. Never buy another embedding.
    event("brain_knowledge_search_unavailable");
  } catch { event("brain_knowledge_search_unavailable"); }
  return [];
}
