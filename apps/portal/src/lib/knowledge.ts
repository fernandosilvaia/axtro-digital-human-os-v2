// Módulo exclusivo de servidor: importado apenas por server actions
// ("use server"); o import de node:crypto já impede bundle no cliente.
import { createHash } from "node:crypto";

import { createUuidV7 } from "@axtro/domain";
import { createOpenRouterEmbeddingPort } from "@axtro/provider-openrouter";

import { AI_USAGE_LIMITS } from "./ai-budget/reservations.ts";
import { assertEmbeddingFitsReservedInput } from "./ai-budget/envelope.ts";

/**
 * Ingestão e recuperação de conhecimento real (RAG) do portal.
 * Embeddings via OpenRouter (endpoint OpenAI-compat) com a MESMA chave já
 * configurada para o chat — nenhuma credencial nova (D-V2-070).
 */

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export const MAX_CONTENT_CHARS = 80_000;
export const MAX_EMBEDDING_QUERY_CHARS = 4_000;
const TARGET_CHUNK_CHARS = 1200;
const EMBED_BATCH_SIZE = 32;

/** Modo demonstração sem chaves (T3): providers viram fakes determinísticos. */
export function fakeProvidersEnabled(): boolean {
  return process.env.PORTAL_FAKE_PROVIDERS === "1";
}

/**
 * Embedding fake determinístico: sha256 do texto semeia um PRNG xorshift que
 * preenche as 1536 dimensões, normalizadas. Texto idêntico → vetor idêntico,
 * então ingestão + busca continuam funcionais sem provider real (mesma
 * disciplina dos fakes do kernel M0-M2).
 */
function fakeEmbedding(text: string): number[] {
  const digest = createHash("sha256").update(text, "utf8").digest();
  let state = digest.readUInt32BE(0) || 0x9e3779b9;
  const vector = new Array<number>(EMBEDDING_DIMENSIONS);
  let norm = 0;
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    const value = (state / 0xffffffff) * 2 - 1;
    vector[index] = value;
    norm += value * value;
  }
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    vector[index] = Number(((vector[index] ?? 0) / norm).toFixed(8));
  }
  return vector;
}

/**
 * Quebra o conteúdo em chunks de até ~1200 chars respeitando parágrafos:
 * parágrafos curtos são agrupados, parágrafos longos são fatiados. Nunca
 * produz chunk vazio.
 */
export function chunkContent(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > TARGET_CHUNK_CHARS) {
      flush();
      for (let offset = 0; offset < paragraph.length; offset += TARGET_CHUNK_CHARS) {
        chunks.push(paragraph.slice(offset, offset + TARGET_CHUNK_CHARS));
      }
      continue;
    }
    if (current.length === 0) {
      current = paragraph;
    } else if (current.length + 2 + paragraph.length <= TARGET_CHUNK_CHARS) {
      current = `${current}\n\n${paragraph}`;
    } else {
      flush();
      current = paragraph;
    }
  }
  flush();
  return chunks;
}

export function contentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Verifica todo o material ANTES de uma reserva cruzar a fence de dispatch.
 * O teto usa bytes UTF-8 como limite conservador de tokens e evita que um
 * lote Unicode faça o provider gastar acima do envelope já reservado.
 */
export function assertEmbeddingInputsWithinReservedBudget(
  texts: readonly string[],
  maxInputTokens: number,
): void {
  assertEmbeddingFitsReservedInput(texts, maxInputTokens);
}

/** Normaliza a query e prova o teto antes do caminho pago de busca. */
export function prepareEmbeddingQueryForReservedUsage(
  query: string,
  maxInputTokens = AI_USAGE_LIMITS.knowledge_query_embedding.maxInputTokens,
): string {
  const bounded = query.slice(0, MAX_EMBEDDING_QUERY_CHARS);
  assertEmbeddingInputsWithinReservedBudget([bounded], maxInputTokens);
  return bounded;
}

export interface EmbeddedChunk {
  readonly i: number;
  readonly t: string;
  readonly cid: string;
  readonly eid: string;
  readonly e: readonly number[];
}

export interface EmbeddingRunResult {
  readonly chunks: readonly EmbeddedChunk[];
  readonly inputTokens: number;
  readonly reportedCostUsd?: number;
}

/**
 * Gera embeddings em lotes e devolve o payload pronto para `portal_ingest_knowledge`.
 *
 * Antes do primeiro batch, todo o documento precisa caber no envelope
 * conservador reservado. A soma observada continua sendo checada após cada
 * batch como defesa em profundidade, mas nunca é a primeira barreira.
 */
export async function embedChunks(
  apiKey: string,
  texts: readonly string[],
  maxInputTokens = AI_USAGE_LIMITS.knowledge_ingestion_embedding.maxInputTokens,
): Promise<EmbeddingRunResult> {
  if (fakeProvidersEnabled()) {
    return {
      chunks: texts.map((text, index) => ({
        i: index,
        t: text,
        cid: createUuidV7(),
        eid: createUuidV7(),
        e: fakeEmbedding(text),
      })),
      inputTokens: 0,
    };
  }
  assertEmbeddingInputsWithinReservedBudget(texts, maxInputTokens);
  const port = createOpenRouterEmbeddingPort({
    apiKey,
    appUrl: "https://portal-production-b43e.up.railway.app",
    appTitle: "Axtro Digital Human OS",
  });

  const chunks: EmbeddedChunk[] = [];
  let inputTokens = 0;
  let reportedCostUsd = 0;
  let hasReportedCost = true;
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    const result = await port.embed({ model: EMBEDDING_MODEL, inputs: batch });
    inputTokens += result.usage.inputTokens;
    if (result.usage.reportedCostUsd === undefined) hasReportedCost = false;
    else reportedCostUsd += result.usage.reportedCostUsd;
    if (inputTokens > maxInputTokens) {
      throw new Error(`embedding input exceeded the reserved token budget (${inputTokens} > ${maxInputTokens})`);
    }
    for (const [offset, vector] of result.embeddings.entries()) {
      const text = batch[offset];
      if (text === undefined) {
        throw new Error("embedding provider returned more vectors than inputs");
      }
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`embedding returned ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
      }
      chunks.push({
        i: start + offset,
        t: text,
        cid: createUuidV7(),
        eid: createUuidV7(),
        e: vector,
      });
    }
  }
  return { chunks, inputTokens, ...(hasReportedCost ? { reportedCostUsd } : {}) };
}

export interface KnowledgeMatch {
  readonly source_name: string;
  readonly chunk_text: string;
  readonly similarity: number;
}

/** Embeda a pergunta e devolve o embedding como array simples (payload do RPC de busca). */
export async function embedQuery(
  apiKey: string,
  query: string,
  maxInputTokens = AI_USAGE_LIMITS.knowledge_query_embedding.maxInputTokens,
): Promise<{ embedding: readonly number[]; inputTokens: number; reportedCostUsd?: number }> {
  if (fakeProvidersEnabled()) {
    return { embedding: fakeEmbedding(query.slice(0, MAX_EMBEDDING_QUERY_CHARS)), inputTokens: 0 };
  }
  const boundedQuery = prepareEmbeddingQueryForReservedUsage(query, maxInputTokens);
  const port = createOpenRouterEmbeddingPort({
    apiKey,
    appUrl: "https://portal-production-b43e.up.railway.app",
    appTitle: "Axtro Digital Human OS",
  });
  const result = await port.embed({ model: EMBEDDING_MODEL, inputs: [boundedQuery] });
  const embedding = result.embeddings[0];
  if (!embedding) {
    throw new Error("embedding provider returned no vector for the query");
  }
  return {
    embedding,
    inputTokens: result.usage.inputTokens,
    ...(result.usage.reportedCostUsd === undefined ? {} : { reportedCostUsd: result.usage.reportedCostUsd }),
  };
}
