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

test("conversation URL usa allowlist exata do origin Tavus/Daily", () => {
  for (const trusted of [
    "https://tavus.daily.co/c123abc",
    "https://TAVUS.DAILY.CO/room-123?token=opaque",
  ]) assert.equal(provider.isTrustedTavusConversationUrl(trusted), true, trusted);

  for (const hostile of [
    "http://tavus.daily.co/room",
    "https://tavus.daily.co/",
    "https://tavus.daily.co:443/room",
    "https://user@tavus.daily.co/room",
    "https://tavus.daily.co@evil.example/room",
    "https://tavus.daily.co.evil.example/room",
    "https://customer.daily.co/room",
    "https://daily.co/room",
    "https://127.0.0.1/room",
    "https://localhost/room",
    "https://tavus.daily.co\\@evil.example/room",
    "https://tavus.daily.co/room#provider-controlled-fragment",
    " https://tavus.daily.co/room",
  ]) assert.equal(provider.isTrustedTavusConversationUrl(hostile), false, hostile);
});

test("createConversation rejeita origin hostil mesmo quando o payload Tavus tem id válido", async () => {
  for (const conversationUrl of [
    "https://evil.example/room",
    "https://tavus.daily.co.evil.example/room",
    "https://tavus.daily.co:8443/room",
    "https://10.0.0.8/room",
  ]) {
    const hostile = fakeFetch(async () => new Response(
      JSON.stringify({ conversation_id: "conv_001", conversation_url: conversationUrl }),
      { status: 200 },
    ));
    const port = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: hostile.implementation });
    await assert.rejects(
      () => port.createConversation(request()),
      (error) => error.code === "malformed_provider_response",
      conversationUrl,
    );
  }
});

test("createConversation envia callback_url quando informado, e rejeita se não for https", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(
    JSON.stringify({ conversation_id: "conv_001", conversation_url: "https://tavus.daily.co/conv_001" }),
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
    assert.equal(e.httpStatus, 401);
    assert.equal(e.message.includes(API_KEY), false);
    return true;
  });
});

test("5xx vira provider_unavailable; payload sem url vira malformed; sem chave nem constrói", async () => {
  const down = fakeFetch(async () => new Response("x", { status: 503 }));
  const portDown = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: down.implementation });
  await assert.rejects(() => portDown.createConversation(request()), (e) => {
    assert.equal(e.code, "provider_unavailable");
    assert.equal(e.httpStatus, 503);
    return true;
  });

  const junk = fakeFetch(async () => new Response(JSON.stringify({ conversation_id: "conv_001" }), { status: 200 }));
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

test("endConversation trata 404 como compensação idempotente, sem relaxar createConversation", async () => {
  const missing = fakeFetch(async () => new Response("not found", { status: 404 }));
  const port = provider.createTavusVideoConversationPort({ apiKey: API_KEY, fetchImplementation: missing.implementation });
  await port.endConversation("c123abc");
  await assert.rejects(
    () => port.createConversation(request()),
    (error) => error.code === "provider_rejected" && error.httpStatus === 404,
  );
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

// ---------------------------------------------------------------------------
// listTavusTools / findTavusToolByExactName / createTavusTool (ADR-041,
// "Registro real das tools no Tavus" -- provisão de conta, nunca de runtime;
// único chamador pretendido é scripts/provision-tavus-business-tools.mjs).
// ---------------------------------------------------------------------------

const TOOL_DEFINITION = Object.freeze({
  name: "register_lead",
  description: "Registra um lead qualificado a partir desta conversa.",
  parameters: Object.freeze({ type: "object", properties: Object.freeze({ contactName: { type: "string" } }), required: ["contactName"] }),
});
const TOOL_BEHAVIOR = Object.freeze({ onCall: "silent", onResolve: "add_to_context" });

test("listTavusTools envia GET com type=user e name_or_uuid, e mapeia o payload real do Tavus", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(
    JSON.stringify({ data: [{ tool_id: "tabc123def456", name: "register_lead" }], total_count: 1 }),
    { status: 200 },
  ));
  const tools = await provider.listTavusTools({ apiKey: API_KEY, fetchImplementation: implementation }, { nameOrUuid: "register_lead" });
  assert.deepEqual(tools, [{ toolId: "tabc123def456", name: "register_lead" }]);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.body, undefined);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v2/tools");
  assert.equal(url.searchParams.get("type"), "user");
  assert.equal(url.searchParams.get("name_or_uuid"), "register_lead");
});

test("listTavusTools rejeita um payload sem array data, e uma entrada sem tool_id/name válidos", async () => {
  const missingData = fakeFetch(async () => new Response(JSON.stringify({ total_count: 0 }), { status: 200 }));
  await assert.rejects(
    () => provider.listTavusTools({ apiKey: API_KEY, fetchImplementation: missingData.implementation }),
    (e) => e.code === "malformed_provider_response",
  );

  const badEntry = fakeFetch(async () => new Response(JSON.stringify({ data: [{ tool_id: "not an id!!", name: "x" }] }), { status: 200 }));
  await assert.rejects(
    () => provider.listTavusTools({ apiKey: API_KEY, fetchImplementation: badEntry.implementation }),
    (e) => e.code === "malformed_provider_response",
  );
});

test("findTavusToolByExactName nunca aceita um match de substring como a mesma tool", async () => {
  const { implementation } = fakeFetch(async () => new Response(
    JSON.stringify({ data: [{ tool_id: "tabc123def456", name: "register_lead_v2" }] }),
    { status: 200 },
  ));
  const found = await provider.findTavusToolByExactName({ apiKey: API_KEY, fetchImplementation: implementation }, "register_lead");
  assert.equal(found, null);
});

test("createTavusTool envia o payload fechado (delivery/trigger_type/origin/on_call/on_resolve) e devolve o tool_id criado", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(
    JSON.stringify({ tool_id: "tnewbusiness001", name: "register_lead" }),
    { status: 200 },
  ));
  const result = await provider.createTavusTool({ apiKey: API_KEY, fetchImplementation: implementation }, TOOL_DEFINITION, TOOL_BEHAVIOR);
  assert.deepEqual(result, { outcome: "created", tool: { toolId: "tnewbusiness001", name: "register_lead" } });
  assert.equal(calls[0].url, "https://tavusapi.com/v2/tools");
  assert.equal(calls[0].init.method, "POST");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.name, "register_lead");
  assert.deepEqual(body.delivery, { app_message: true });
  assert.equal(body.trigger_type, "in_call");
  assert.equal(body.origin, "llm");
  assert.equal(body.on_call, "silent");
  assert.equal(body.on_resolve, "add_to_context");
});

test("createTavusTool trata HTTP 409 (nome já existe) como outcome already_exists, nunca como erro", async () => {
  const { implementation } = fakeFetch(async () => new Response(JSON.stringify({ error: "duplicate name" }), { status: 409 }));
  const result = await provider.createTavusTool({ apiKey: API_KEY, fetchImplementation: implementation }, TOOL_DEFINITION, TOOL_BEHAVIOR);
  assert.deepEqual(result, { outcome: "already_exists" });
});

test("createTavusTool valida nome, descrição e parameters antes da rede", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response("{}", { status: 200 }));
  for (const bad of [
    { ...TOOL_DEFINITION, name: "9starts_with_digit" },
    { ...TOOL_DEFINITION, name: "has spaces" },
    { ...TOOL_DEFINITION, description: "" },
    { ...TOOL_DEFINITION, description: "x".repeat(2001) },
    { ...TOOL_DEFINITION, parameters: { type: "string" } },
  ]) {
    await assert.rejects(
      () => provider.createTavusTool({ apiKey: API_KEY, fetchImplementation: implementation }, bad, TOOL_BEHAVIOR),
      (e) => e.code === "invalid_request",
    );
  }
  assert.equal(calls.length, 0);
});

test("createTavusTool rejeita um payload de sucesso incompleto ou com nome divergente", async () => {
  const noId = fakeFetch(async () => new Response(JSON.stringify({ name: "register_lead" }), { status: 200 }));
  await assert.rejects(
    () => provider.createTavusTool({ apiKey: API_KEY, fetchImplementation: noId.implementation }, TOOL_DEFINITION, TOOL_BEHAVIOR),
    (e) => e.code === "malformed_provider_response",
  );

  const wrongName = fakeFetch(async () => new Response(JSON.stringify({ tool_id: "tabc123def456", name: "outra_coisa" }), { status: 200 }));
  await assert.rejects(
    () => provider.createTavusTool({ apiKey: API_KEY, fetchImplementation: wrongName.implementation }, TOOL_DEFINITION, TOOL_BEHAVIOR),
    (e) => e.code === "malformed_provider_response",
  );
});
