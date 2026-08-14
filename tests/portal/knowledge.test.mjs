import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

// Achado P1 da auditoria 2026-08-11: chunkContent/embedChunks/embedQuery
// (caminho pago de ingestão de conhecimento) não tinham nenhum teste,
// direto ou indireto.
const knowledge = await import("../../apps/portal/src/lib/knowledge.ts");

// ---------------------------------------------------------------------------
// chunkContent
// ---------------------------------------------------------------------------

test("chunkContent: conteúdo vazio ou só espaço em branco devolve array vazio", () => {
  assert.deepEqual(knowledge.chunkContent(""), []);
  assert.deepEqual(knowledge.chunkContent("   \n\n  \t "), []);
});

test("chunkContent: um parágrafo curto vira um único chunk", () => {
  const chunks = knowledge.chunkContent("Um parágrafo curto qualquer.");
  assert.deepEqual(chunks, ["Um parágrafo curto qualquer."]);
});

test("chunkContent: parágrafos curtos são agrupados até o teto de caracteres", () => {
  const a = "a".repeat(500);
  const b = "b".repeat(500);
  const chunks = knowledge.chunkContent(`${a}\n\n${b}`);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], `${a}\n\n${b}`);
});

test("chunkContent: parágrafo que estoura o teto por 1 char força novo chunk (limite exclusivo)", () => {
  // TARGET_CHUNK_CHARS = 1200. current.length + 2 (\n\n) + paragraph.length <= 1200
  const first = "x".repeat(600);
  const second = "y".repeat(597); // 600 + 2 + 597 = 1199 <= 1200 -> ainda cabe
  const third = "z".repeat(598); // 600 + 2 + 598 = 1200 <= 1200 -> ainda cabe (limite exato)
  const overflow = "w".repeat(1); // qualquer coisa a mais no MESMO chunk estouraria

  const merged = knowledge.chunkContent(`${first}\n\n${second}`);
  assert.equal(merged.length, 1, "597 chars deveria caber no mesmo chunk (limite exato 1199<=1200)");

  const atLimit = knowledge.chunkContent(`${first}\n\n${third}`);
  assert.equal(atLimit.length, 1, "598 chars deveria caber EXATAMENTE no teto (1200<=1200, comparação é <=)");
  assert.equal(atLimit[0].length, 1200);

  const overLimit = knowledge.chunkContent(`${first}\n\n${third}${overflow}`);
  assert.equal(overLimit.length, 2, "1 char a mais que o teto deve forçar um novo chunk");
});

test("chunkContent: parágrafo maior que o teto é fatiado em pedaços de TARGET_CHUNK_CHARS, sem perder nem duplicar caracteres", () => {
  const long = Array.from({ length: 3000 }, (_, i) => String(i % 10)).join(""); // 3000 chars
  const chunks = knowledge.chunkContent(long);
  assert.equal(chunks.join(""), long, "concatenar os chunks deve reconstruir o conteúdo original exatamente");
  assert.ok(chunks.length >= 3, "3000 chars com teto de 1200 deveria gerar pelo menos 3 fatias");
  for (const chunk of chunks.slice(0, -1)) {
    assert.equal(chunk.length, 1200, "toda fatia exceto a última deve ter exatamente o teto de tamanho");
  }
  assert.ok(chunks[chunks.length - 1].length > 0 && chunks[chunks.length - 1].length <= 1200);
});

test("chunkContent: parágrafo longo seguido de parágrafo curto — o curto começa um chunk novo, não gruda na última fatia", () => {
  const long = "a".repeat(1300);
  const short = "conclusão curta";
  const chunks = knowledge.chunkContent(`${long}\n\n${short}`);
  assert.equal(chunks[chunks.length - 1], short);
});

test("chunkContent: normaliza CRLF para LF antes de dividir por parágrafo", () => {
  const a = "primeiro parágrafo";
  const b = "segundo parágrafo";
  const chunks = knowledge.chunkContent(`${a}\r\n\r\n${b}`);
  assert.deepEqual(chunks, [`${a}\n\n${b}`]);
});

test("chunkContent: nunca produz chunk vazio, mesmo com múltiplas quebras de linha extras entre parágrafos", () => {
  const content = "p1\n\n\n\n\np2\n\n\n\np3";
  const chunks = knowledge.chunkContent(content);
  for (const chunk of chunks) {
    assert.ok(chunk.length > 0, "nenhum chunk deveria ficar vazio");
  }
  assert.deepEqual(chunks, ["p1\n\np2\n\np3"]);
});

// ---------------------------------------------------------------------------
// contentSha256
// ---------------------------------------------------------------------------

test("contentSha256: determinístico e bate com sha256 hex padrão", () => {
  const text = "conteúdo de teste com acento é";
  const expected = createHash("sha256").update(text, "utf8").digest("hex");
  assert.equal(knowledge.contentSha256(text), expected);
  assert.equal(knowledge.contentSha256(text), knowledge.contentSha256(text));
});

test("contentSha256: entradas diferentes produzem hashes diferentes", () => {
  assert.notEqual(knowledge.contentSha256("a"), knowledge.contentSha256("b"));
});

// ---------------------------------------------------------------------------
// embedChunks / embedQuery — modo fake (determinístico, sem rede)
// ---------------------------------------------------------------------------

function withFakeProviders(fn) {
  return async () => {
    const original = process.env.PORTAL_FAKE_PROVIDERS;
    process.env.PORTAL_FAKE_PROVIDERS = "1";
    try {
      await fn();
    } finally {
      if (original !== undefined) process.env.PORTAL_FAKE_PROVIDERS = original;
      else delete process.env.PORTAL_FAKE_PROVIDERS;
    }
  };
}

test("embedChunks (fake): lista vazia devolve chunks vazios e 0 tokens", withFakeProviders(async () => {
  const result = await knowledge.embedChunks("any-key", []);
  assert.deepEqual(result, { chunks: [], inputTokens: 0 });
}));

test("embedChunks (fake): shape correto, ordem preservada, vetor com 1536 dims, cid/eid únicos", withFakeProviders(async () => {
  const texts = ["primeiro chunk", "segundo chunk", "terceiro chunk"];
  const result = await knowledge.embedChunks("any-key", texts);
  assert.equal(result.inputTokens, 0);
  assert.equal(result.chunks.length, 3);
  result.chunks.forEach((chunk, index) => {
    assert.equal(chunk.i, index);
    assert.equal(chunk.t, texts[index]);
    assert.equal(chunk.e.length, 1536);
  });
  const cids = new Set(result.chunks.map((c) => c.cid));
  const eids = new Set(result.chunks.map((c) => c.eid));
  assert.equal(cids.size, 3, "cid deve ser único por chunk");
  assert.equal(eids.size, 3, "eid deve ser único por chunk");
}));

test("embedChunks (fake): texto idêntico produz o MESMO vetor (determinístico)", withFakeProviders(async () => {
  const result = await knowledge.embedChunks("any-key", ["repetido", "repetido"]);
  assert.deepEqual(result.chunks[0].e, result.chunks[1].e);
}));

test("embedChunks (fake): textos diferentes produzem vetores diferentes", withFakeProviders(async () => {
  const result = await knowledge.embedChunks("any-key", ["a", "b"]);
  assert.notDeepEqual(result.chunks[0].e, result.chunks[1].e);
}));

test("embedQuery (fake): devolve vetor de 1536 dims e 0 tokens", withFakeProviders(async () => {
  const result = await knowledge.embedQuery("any-key", "qual é o preço do plano Piloto?");
  assert.equal(result.inputTokens, 0);
  assert.equal(result.embedding.length, 1536);
}));

test("embedQuery (fake): trunca em 4000 chars antes de embedar — duas queries que só divergem depois de 4000 chars produzem o mesmo vetor", withFakeProviders(async () => {
  const base = "x".repeat(4000);
  const a = await knowledge.embedQuery("any-key", `${base}cauda-a`);
  const b = await knowledge.embedQuery("any-key", `${base}cauda-b`);
  assert.deepEqual(a.embedding, b.embedding);
}));

// ---------------------------------------------------------------------------
// embedChunks / embedQuery — provider real (OpenRouter via fetch injetado
// globalmente, mesmo padrão de tests/portal/video-cap.test.mjs)
// ---------------------------------------------------------------------------

function withRealProviders(fn) {
  return async () => {
    const original = process.env.PORTAL_FAKE_PROVIDERS;
    delete process.env.PORTAL_FAKE_PROVIDERS;
    const originalFetch = globalThis.fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = originalFetch;
      if (original !== undefined) process.env.PORTAL_FAKE_PROVIDERS = original;
    }
  };
}

test("embedChunks (real): chama o endpoint de embeddings e devolve vetores na ordem certa com tokens somados", withRealProviders(async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      data: body.input.map((_text, index) => ({ index, embedding: new Array(1536).fill(index + 1) })),
      model: "openai/text-embedding-3-small",
      usage: { prompt_tokens: 10, total_tokens: 10 },
    }), { status: 200 });
  };
  const result = await knowledge.embedChunks("test-openrouter-key-0000000000000000", ["c0", "c1"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/embeddings");
  assert.equal(result.inputTokens, 10);
  assert.equal(result.chunks.length, 2);
  assert.deepEqual(result.chunks[0].e, new Array(1536).fill(1));
  assert.deepEqual(result.chunks[1].e, new Array(1536).fill(2));
}));

test("embedChunks (real): mais textos que o tamanho de lote (32) disparam múltiplas chamadas, todas somadas na ordem certa", withRealProviders(async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(init);
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      data: body.input.map((_text, index) => ({ index, embedding: new Array(1536).fill(0.5) })),
      model: "openai/text-embedding-3-small",
      usage: { prompt_tokens: 5, total_tokens: 5 },
    }), { status: 200 });
  };
  const texts = Array.from({ length: 40 }, (_, i) => `chunk-${i}`);
  const result = await knowledge.embedChunks("test-openrouter-key-0000000000000000", texts);
  assert.equal(calls.length, 2, "40 textos com lote de 32 deveria disparar 2 chamadas");
  assert.equal(result.inputTokens, 10, "tokens das 2 chamadas devem ser somados");
  assert.equal(result.chunks.length, 40);
  result.chunks.forEach((chunk, index) => {
    assert.equal(chunk.i, index);
    assert.equal(chunk.t, texts[index]);
  });
}));

test("embedChunks (real): vetor com dimensão errada do provider lança erro explícito, não silencioso", withRealProviders(async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: [{ index: 0, embedding: new Array(10).fill(0.1) }],
    model: "openai/text-embedding-3-small",
    usage: { prompt_tokens: 1, total_tokens: 1 },
  }), { status: 200 });
  await assert.rejects(
    () => knowledge.embedChunks("test-openrouter-key-0000000000000000", ["only chunk"]),
    /1536/,
  );
}));

test("embedQuery (real): devolve o vetor e os tokens da resposta real", withRealProviders(async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.input.length, 1);
    return new Response(JSON.stringify({
      data: [{ index: 0, embedding: new Array(1536).fill(0.25) }],
      model: "openai/text-embedding-3-small",
      usage: { prompt_tokens: 7, total_tokens: 7 },
    }), { status: 200 });
  };
  const result = await knowledge.embedQuery("test-openrouter-key-0000000000000000", "pergunta real");
  assert.equal(result.inputTokens, 7);
  assert.deepEqual(result.embedding, new Array(1536).fill(0.25));
}));

test("embedQuery e embedChunks propagam custo reportado sem expor conteúdo", withRealProviders(async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      data: body.input.map((_text, index) => ({ index, embedding: new Array(1536).fill(0.1) })),
      model: "openai/text-embedding-3-small",
      usage: { prompt_tokens: 9, total_tokens: 9, cost: 0.000004 },
    }), { status: 200 });
  };
  const query = await knowledge.embedQuery("test-openrouter-key-0000000000000000", "pergunta sensível");
  assert.equal(query.reportedCostUsd, 0.000004);
  const chunks = await knowledge.embedChunks("test-openrouter-key-0000000000000000", ["conteúdo sensível"]);
  assert.equal(chunks.reportedCostUsd, 0.000004);
}));
