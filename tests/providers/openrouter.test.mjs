import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-openrouter/dist/index.js")).href);

const API_KEY = "test-key-000000000000";

function completionPayload(overrides = {}) {
  return {
    model: "anthropic/claude-haiku-4.5",
    choices: [{ message: { role: "assistant", content: "Olá! Posso ajudar com a proposta." } }],
    usage: { prompt_tokens: 42, completion_tokens: 17 },
    ...overrides,
  };
}

function fakeFetch(handler) {
  const calls = [];
  const implementation = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, implementation };
}

function request(overrides = {}) {
  return {
    model: "anthropic/claude-haiku-4.5",
    messages: [
      { role: "system", content: "Você é um agente de vendas." },
      { role: "user", content: "Qual o preço?" },
    ],
    maxOutputTokens: 256,
    ...overrides,
  };
}

test("generate envia o payload fechado ao endpoint fixo e devolve texto e usage", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify(completionPayload()), { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({
    apiKey: API_KEY,
    fetchImplementation: implementation,
    appUrl: "https://portal.example",
    appTitle: "Axtro Portal",
  });

  const result = await port.generate(request());

  assert.equal(result.text, "Olá! Posso ajudar com a proposta.");
  assert.equal(result.model, "anthropic/claude-haiku-4.5");
  assert.deepEqual(result.usage, { inputTokens: 42, outputTokens: 17 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model"]);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(calls[0].init.headers["HTTP-Referer"], "https://portal.example");
});

test("a chave nunca vaza em erros e o corpo de erro do provider nunca é repassado", async () => {
  const { implementation } = fakeFetch(async () => new Response(`bad request for Bearer ${API_KEY}`, { status: 400 }));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });

  await assert.rejects(
    () => port.generate(request()),
    (error) => {
      assert.equal(error.name, "TextGenerationError");
      assert.equal(error.code, "provider_rejected");
      assert.equal(error.message.includes(API_KEY), false);
      assert.equal(error.message.includes("bad request"), false);
      return true;
    },
  );
});

test("validação fecha modelo, papéis, tamanho e caps antes de qualquer rede", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response("{}", { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });

  const invalid = [
    request({ model: "not a model id!!" }),
    request({ messages: [] }),
    request({ messages: Array.from({ length: 25 }, () => ({ role: "user", content: "x" })) }),
    request({ messages: [{ role: "tool", content: "x" }] }),
    request({ messages: [{ role: "user", content: "x".repeat(4001) }] }),
    request({ maxOutputTokens: 0 }),
    request({ maxOutputTokens: 4096 }),
  ];
  for (const bad of invalid) {
    await assert.rejects(() => port.generate(bad), (error) => error.code === "invalid_request");
  }
  assert.equal(calls.length, 0);
});

test("HTTP 5xx vira provider_unavailable; JSON malformado vira malformed_provider_response", async () => {
  const server = fakeFetch(async () => new Response("upstream down", { status: 503 }));
  const port5xx = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: server.implementation });
  await assert.rejects(() => port5xx.generate(request()), (error) => error.code === "provider_unavailable");

  const junk = fakeFetch(async () => new Response("<html>not json</html>", { status: 200 }));
  const portJunk = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: junk.implementation });
  await assert.rejects(() => portJunk.generate(request()), (error) => error.code === "malformed_provider_response");

  const empty = fakeFetch(async () => new Response(JSON.stringify(completionPayload({ choices: [] })), { status: 200 }));
  const portEmpty = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: empty.implementation });
  await assert.rejects(() => portEmpty.generate(request()), (error) => error.code === "malformed_provider_response");
});

test("timeout aborta a chamada e vira provider_timeout", async () => {
  const { implementation } = fakeFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  }));
  const port = provider.createOpenRouterTextGenerationPort({
    apiKey: API_KEY,
    timeoutMs: 20,
    fetchImplementation: implementation,
  });
  await assert.rejects(() => port.generate(request()), (error) => error.code === "provider_timeout");
});

test("sem chave configurada o port nem é construído", () => {
  assert.throws(
    () => provider.createOpenRouterTextGenerationPort({ apiKey: "" }),
    (error) => error.code === "missing_api_key",
  );
});

test("usage ausente ou inválida normaliza para zero em vez de inventar número", async () => {
  const { implementation } = fakeFetch(async () => new Response(
    JSON.stringify(completionPayload({ usage: { prompt_tokens: -5, completion_tokens: "muitos" } })),
    { status: 200 },
  ));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.generate(request());
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0 });
});
