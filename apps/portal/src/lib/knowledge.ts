// Módulo exclusivo de servidor: importado apenas por server actions
// ("use server"); o import de node:crypto já impede bundle no cliente.
import { createHash } from "node:crypto";

import { createUuidV7 } from "@axtro/domain";
import { createOpenRouterEmbeddingPort } from "@axtro/provider-openrouter";

/**
 * Ingestão e recuperação de conhecimento real (RAG) do portal.
 * Embeddings via OpenRouter (endpoint OpenAI-compat) com a MESMA chave já
 * configurada para o chat — nenhuma credencial nova (D-V2-070).
 */

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export const MAX_CONTENT_CHARS = 80_000;
const TARGET_CHUNK_CHARS = 1200;
const EMBED_BATCH_SIZE = 32;

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
}

/** Gera embeddings em lotes e devolve o payload pronto para `portal_ingest_knowledge`. */
export async function embedChunks(apiKey: string, texts: readonly string[]): Promise<EmbeddingRunResult> {
  const port = createOpenRouterEmbeddingPort({
    apiKey,
    appUrl: "https://portal-production-b43e.up.railway.app",
    appTitle: "Axtro Digital Human OS",
  });

  const chunks: EmbeddedChunk[] = [];
  let inputTokens = 0;
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
    const result = await port.embed({ model: EMBEDDING_MODEL, inputs: batch });
    inputTokens += result.usage.inputTokens;
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
  return { chunks, inputTokens };
}

export interface KnowledgeMatch {
  readonly source_name: string;
  readonly chunk_text: string;
  readonly similarity: number;
}

/** Embeda a pergunta e devolve o embedding como array simples (payload do RPC de busca). */
export async function embedQuery(apiKey: string, query: string): Promise<{ embedding: readonly number[]; inputTokens: number }> {
  const port = createOpenRouterEmbeddingPort({
    apiKey,
    appUrl: "https://portal-production-b43e.up.railway.app",
    appTitle: "Axtro Digital Human OS",
  });
  const result = await port.embed({ model: EMBEDDING_MODEL, inputs: [query.slice(0, 4000)] });
  const embedding = result.embeddings[0];
  if (!embedding) {
    throw new Error("embedding provider returned no vector for the query");
  }
  return { embedding, inputTokens: result.usage.inputTokens };
}
