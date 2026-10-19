// Recuperação simulada da base da Billion Leads Pro: dá ao avaliador os mesmos trechos que a busca de
// produção entregaria ao closer, sem rede e sem custo. Pontuação lexical simples (TF-IDF); a produção usa
// busca híbrida, então isto é uma aproximação honesta, não um espelho.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const { chunkContent } = await import("../../apps/portal/src/lib/knowledge.ts");

const directory = new URL("../../knowledge/billion-leads-pro/", import.meta.url);
const STOP = new Set("a o e é de da do das dos em no na nos nas um uma uns umas que para por com sem se eu você voce meu minha seu sua ao aos as os ou mas mais como já ja não nao sim isso essa esse este esta the and of to in is it for on you your my i que el la los las un una y es por con para no si mi tu lo se".split(" "));

function normalize(text) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function tokens(text) {
  return normalize(text).split(/[^a-z0-9$]+/).filter((token) => token.length > 1 && !STOP.has(token));
}

const chunks = [];
for (const name of readdirSync(directory).filter((file) => file.endsWith(".md")).sort()) {
  const text = readFileSync(new URL(name, directory), "utf8").trim();
  chunkContent(text).forEach((chunkText, index) => {
    chunks.push({ source: name, index, text: chunkText, terms: tokens(chunkText) });
  });
}
const documentFrequency = new Map();
for (const chunk of chunks) for (const term of new Set(chunk.terms)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);

function idFor(n) {
  return `019f0000-00b1-7000-8000-${String(n).padStart(12, "0")}`;
}

export function retrieveKnowledge(queryText, limit = 4, prefer = []) {
  const query = tokens(queryText);
  const scored = chunks.map((chunk, position) => {
    const counts = new Map();
    for (const term of chunk.terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of new Set(query)) {
      const tf = counts.get(term) ?? 0;
      if (tf > 0) score += (1 + Math.log(tf)) * Math.log(1 + chunks.length / (documentFrequency.get(term) ?? 1));
    }
    // Documentos que a busca de produção deveria achar: entram com peso, mesmo sem coincidência de palavras.
    if (prefer.some((prefix) => chunk.source.startsWith(`${prefix}-`))) score = score * 2.5 + 1;
    return { chunk, position, score };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return scored.map(({ chunk, position, score }, rank) => {
    const id = idFor(position + 1);
    const citation = { source_id: id, version_id: id, chunk_id: id, chunk_index: chunk.index, content_hash: createHash("sha256").update(chunk.text).digest("hex") };
    return { ...citation, citation, source_name: chunk.source.replace(/^\d+-/, "").replace(/\.md$/, ""), score: 1 / (60 + rank), similarity: null, match_kind: "lexical", trusted: false, chunk_text: chunk.text, _score: score };
  });
}

export function knowledgeChunkCount() {
  return chunks.length;
}
