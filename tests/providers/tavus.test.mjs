import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-tavus/dist/index.js")).href);

const API_KEY = "test-key-000000000000";

function fakeFetch(handler) {
  const calls = [];
  return { calls, implementation: async (url, init) => { calls.push({ url, init }); return handler(url, init); } };
}

function request(overrides = {}) {
  return {
    replicaId: "r6ae5b6efc9d",
    conversationName: "teste",
    conversationalContext: "Você é Rafaela, closer da conta demo.",
    maxCallDurationSeconds: 600,
    ...overrides,
  };
}

test("createConversation envia payload fechado ao endpoint fixo e devolve id + url https", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(
    JSON.stringify({ conversation_id: "c123abc", conversation_url: "https://tavus.daily.co/c123abc" }),
    { status: 200 },
  ));
  const port = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.createConversation(request({ greeting: "Olá!", language: "portuguese" }));
  assert.deepEqual(result, { conversationId: "c123abc", conversationUrl: "https://tavus.daily.co/c123abc" });
  assert.equal(calls[0].url, "https://tavusapi.com/v2/conversations");
  assert.equal(calls[0].init.headers["x-api-key"], API_KEY);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.properties.max_call_duration, 600);
  assert.equal(body.properties.language, "portuguese");
});

test("createConversation envia callback_url quando informado, e rejeita se não for https", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(
    JSON.stringify({ conversation_id: "c1", conversation_url: "https://tavus.daily.co/c1" }),
    { status: 200 },
  ));
  const port = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await port.createConversation(request({ callbackUrl: "https://closer.axtroai.com/api/tavus/webhook?token=abc" }));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.callback_url, "https://closer.axtroai.com/api/tavus/webhook?token=abc");

  await assert.rejects(
    () => port.createConversation(request({ callbackUrl: "http://not-https.com/webhook" })),
    (e) => e.code === "invalid_request",
  );
});

test("validação fecha replica, nome, contexto e duração antes da rede; chave nunca vaza em erro", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(`nope ${API_KEY}`, { status: 401 }));
  const port = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  for (const bad of [
    request({ replicaId: "not a replica!!" }),
    request({ conversationName: "" }),
    request({ conversationalContext: "x".repeat(6001) }),
    request({ maxCallDurationSeconds: 10 }),
  ]) {
    await assert.rejects(() => port.createConversation(bad), (e) => e.code === "invalid_request");
  }
  assert.equal(calls.length, 0);
  await assert.rejects(() => port.createConversation(request()), (e) => {
    assert.equal(e.code, "provider_rejected");
    assert.equal(e.message.includes(API_KEY), false);
    return true;
  });
});

test("5xx vira provider_unavailable; payload sem url vira malformed; sem chave nem constrói", async () => {
  const down = fakeFetch(async () => new Response("x", { status: 503 }));
  const portDown = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: down.implementation });
  await assert.rejects(() => portDown.createConversation(request()), (e) => e.code === "provider_unavailable");

  const junk = fakeFetch(async () => new Response(JSON.stringify({ conversation_id: "c1" }), { status: 200 }));
  const portJunk = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: junk.implementation });
  await assert.rejects(() => portJunk.createConversation(request()), (e) => e.code === "malformed_provider_response");

  assert.throws(() => provider.createTavusVideoConversationPort({ apiKey: "" }), (e) => e.code === "missing_api_key");
});

test("modo persona: envia persona_id + language, dispensa contexto, e valida o id", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(
    JSON.stringify({ conversation_id: "cpersona", conversation_url: "https://tavus.daily.co/cpersona" }),
    { status: 200 },
  ));
  const port = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.createConversation({
    personaId: "pdd6c8593976",
    conversationName: "aurora",
    language: "portuguese",
    maxCallDurationSeconds: 300,
  });
  assert.equal(result.conversationUrl, "https://tavus.daily.co/cpersona");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.persona_id, "pdd6c8593976");
  assert.equal(body.replica_id, undefined);
  assert.equal(body.conversational_context, undefined);
  assert.equal(body.properties.language, "portuguese");

  const bad = fakeFetch(async () => new Response("{}", { status: 200 }));
  const portBad = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: bad.implementation });
  await assert.rejects(() => portBad.createConversation({ personaId: "não é id!!", conversationName: "x" }), (e) => e.code === "invalid_request");
  assert.equal(bad.calls.length, 0);
});

test("endConversation valida id e chama o endpoint de encerramento", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response("{}", { status: 200 }));
  const port = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await port.endConversation("c123abc");
  assert.equal(calls[0].url, "https://tavusapi.com/v2/conversations/c123abc/end");
  await assert.rejects(() => port.endConversation("../evil"), (e) => e.code === "invalid_request");
});

// Achado P3 da auto-revisão 2026-08-11: este adapter (e provider-recall,
// provider-stripe antes do fix) já teve o padrão certo de timeout desde a
// auditoria 2026-08-02, mas nunca tinha NENHUM teste de timeout — nada
// pegaria se um refactor futuro reintroduzisse o bug (clearTimeout logo
// após o fetch(), antes de ler o corpo) que já foi achado e corrigido nos
// outros dois adapters.
test("timeout aborta antes dos headers e nunca vaza a chave no erro", async () => {
  const timeoutFetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const port = provider.createTavusVideoConversationPort({ apiKey: API_KEY, timeoutMs: 5, fetchImplementation: timeoutFetch });
  await assert.rejects(
    () => port.createConversation(request()),
    (e) => {
      assert.equal(e.code, "provider_timeout");
      assert.equal(e.message.includes(API_KEY), false);
      return true;
    },
  );
});

test("corpo travado depois dos headers ainda respeita o timeout", async () => {
  const stallingFetch = async (_url, init) => ({
    ok: true,
    status: 200,
    text: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  const port = provider.createTavusVideoConversationPort({ apiKey: API_KEY, timeoutMs: 5, fetchImplementation: stallingFetch });
  await assert.rejects(() => port.createConversation(request()), (e) => e.code === "provider_timeout");
});
