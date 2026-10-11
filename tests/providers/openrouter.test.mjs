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
  assert.equal(result.providerRequestId, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model", "usage"]);
  // usage.include pede o custo faturado real na resposta (0027).
  assert.deepEqual(body.usage, { include: true });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(calls[0].init.headers["HTTP-Referer"], "https://portal.example");
});

test("privacy-fenced generation sends the exact routing object and preserves the opaque response id", async () => {
  const order = [];
  const { calls, implementation } = fakeFetch(async () => {
    order.push("fetch");
    return new Response(JSON.stringify(completionPayload({ id: "gen-preview-001" })), { status: 200 });
  });
  const port = provider.createOpenRouterTextGenerationPort({
    apiKey: API_KEY,
    fetchImplementation: implementation,
    privacy: {
      routingConfiguration: provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION,
      revalidateBeforeDispatch: () => order.push("preflight"),
    },
  });

  const result = await port.generate(request());

  assert.deepEqual(order, ["preflight", "fetch"]);
  assert.equal(result.providerRequestId, "gen-preview-001");
  assert.deepEqual(JSON.parse(calls[0].init.body).provider, {
    data_collection: "deny",
    zdr: true,
    allow_fallbacks: false,
    require_parameters: true,
  });
});

test("privacy preflight occurs once before the sole 429 dispatch", async () => {
  let preflights = 0;
  const { calls, implementation } = fakeFetch(async () =>
    new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }));
  const port = provider.createOpenRouterTextGenerationPort({
    apiKey: API_KEY,
    fetchImplementation: implementation,
    privacy: {
      routingConfiguration: provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION,
      revalidateBeforeDispatch: () => { preflights += 1; },
    },
  });
  await assert.rejects(() => port.generate(request()), (error) => error.code === "provider_rejected");
  assert.equal(preflights, 1);
  assert.equal(calls.length, 1);
});

test("privacy mode rejects drift and requires an opaque response id", async () => {
  assert.throws(
    () => provider.createOpenRouterTextGenerationPort({
      apiKey: API_KEY,
      privacy: {
        routingConfiguration: { provider: { data_collection: "deny", zdr: true } },
        revalidateBeforeDispatch: () => {},
      },
    }),
    (error) => error.code === "invalid_request",
  );

  const { implementation } = fakeFetch(async () =>
    new Response(JSON.stringify(completionPayload()), { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({
    apiKey: API_KEY,
    fetchImplementation: implementation,
    privacy: {
      routingConfiguration: provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION,
      revalidateBeforeDispatch: () => {},
    },
  });
  await assert.rejects(
    () => port.generate(request()),
    (error) => error.code === "malformed_provider_response",
  );

  const oversized = fakeFetch(async () =>
    new Response(JSON.stringify(completionPayload({ id: "p".repeat(129) })), { status: 200 }));
  const oversizedPort = provider.createOpenRouterTextGenerationPort({
    apiKey: API_KEY,
    fetchImplementation: oversized.implementation,
    privacy: {
      routingConfiguration: provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION,
      revalidateBeforeDispatch: () => {},
    },
  });
  await assert.rejects(
    () => oversizedPort.generate(request()),
    (error) => error.code === "malformed_provider_response",
  );
});

test("privacy routing is snapshotted so caller mutation cannot relax a later dispatch", async () => {
  const routingConfiguration = {
    provider: {
      data_collection: "deny",
      zdr: true,
      allow_fallbacks: false,
      require_parameters: true,
    },
  };
  const { calls, implementation } = fakeFetch(async () =>
    new Response(JSON.stringify(completionPayload({ id: "gen-preview-immutable" })), { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({
    apiKey: API_KEY,
    fetchImplementation: implementation,
    privacy: {
      routingConfiguration,
      revalidateBeforeDispatch: () => {},
    },
  });
  routingConfiguration.provider.data_collection = "allow";
  routingConfiguration.provider.zdr = false;
  routingConfiguration.provider.allow_fallbacks = true;
  routingConfiguration.provider.require_parameters = false;

  await port.generate(request());

  assert.deepEqual(JSON.parse(calls[0].init.body).provider, {
    data_collection: "deny",
    zdr: true,
    allow_fallbacks: false,
    require_parameters: true,
  });
});

test("usage.cost reportado pelo provider vira reportedCostUsd; valor absurdo ou inválido é descartado", async () => {
  const withCost = (cost) => fakeFetch(async () =>
    new Response(JSON.stringify(completionPayload({ usage: { prompt_tokens: 42, completion_tokens: 17, cost } })), { status: 200 }));

  const ok = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: withCost(0.00123).implementation });
  const okResult = await ok.generate(request());
  assert.deepEqual(okResult.usage, { inputTokens: 42, outputTokens: 17, reportedCostUsd: 0.00123 });

  for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, 999, "0.01"]) {
    const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: withCost(bad).implementation });
    const result = await port.generate(request());
    assert.deepEqual(result.usage, { inputTokens: 42, outputTokens: 17 }, `cost=${String(bad)} deveria ser descartado`);
  }
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

for (const kind of ["generation", "embedding"]) {
  for (const status of [429, 503]) {
    test(`${kind} HTTP ${status} cancels the body and never spends on a hidden retry`, async () => {
      let cancelled = 0;
      const { calls, implementation } = fakeFetch(async () => {
        if (calls.length > 1) return new Response(JSON.stringify(completionPayload()));
        return new Response(new ReadableStream({
          cancel() { cancelled += 1; },
        }), { status, headers: { "retry-after": "0" } });
      });
      const options = { apiKey: API_KEY, fetchImplementation: implementation };
      const operation = kind === "generation"
        ? () => provider.createOpenRouterTextGenerationPort(options).generate(request())
        : () => provider.createOpenRouterEmbeddingPort(options).embed({ model: "openai/text-embedding-3-small", inputs: ["chunk"] });
      await assert.rejects(operation, (error) => error.code === (status === 429 ? "provider_rejected" : "provider_unavailable"));
      assert.equal(calls.length, 1);
      assert.equal(cancelled, 1);
    });
  }
  test(`${kind} deadline stays live while reading a stalled response body`, async () => {
    const { calls, implementation } = fakeFetch(async (_url, init) => {
      const stream = new ReadableStream({ start(controller) {
        init.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
      } });
      return new Response(stream);
    });
    const options = { apiKey: API_KEY, fetchImplementation: implementation, timeoutMs: 20 };
    const operation = kind === "generation"
      ? () => provider.createOpenRouterTextGenerationPort(options).generate(request())
      : () => provider.createOpenRouterEmbeddingPort(options).embed({ model: "openai/text-embedding-3-small", inputs: ["chunk"] });
    await assert.rejects(operation, (error) => error.code === "provider_timeout");
    assert.equal(calls.length, 1);
  });
}

test("privacy denial before dispatch creates no physical provider attempt", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify(completionPayload())));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation,
    privacy: { routingConfiguration: provider.OPENROUTER_PRIVACY_ROUTING_CONFIGURATION,
      revalidateBeforeDispatch: () => { throw new Error("attestation expired"); } },
  });
  await assert.rejects(() => port.generate(request()), /attestation expired/);
  assert.equal(calls.length, 0);
});

test("sem chave configurada o port nem é construído", () => {
  assert.throws(
    () => provider.createOpenRouterTextGenerationPort({ apiKey: "" }),
    (error) => error.code === "missing_api_key",
  );
});

function embeddingsPayload(vectors, overrides = {}) {
  return {
    model: "openai/text-embedding-3-small",
    data: vectors.map((embedding, index) => ({ index, embedding })),
    usage: { prompt_tokens: 12 },
    ...overrides,
  };
}

test("embed envia inputs ao endpoint fixo de embeddings e devolve vetores na ordem", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(
    JSON.stringify(embeddingsPayload([[0.1, 0.2], [0.3, 0.4]])),
    { status: 200 },
  ));
  const port = provider.createOpenRouterEmbeddingPort({ apiKey: API_KEY, fetchImplementation: implementation });

  const result = await port.embed({ model: "openai/text-embedding-3-small", inputs: ["chunk a", "chunk b"] });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/embeddings");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: "openai/text-embedding-3-small",
    input: ["chunk a", "chunk b"],
    usage: { include: true },
  });
  assert.deepEqual(result.embeddings, [[0.1, 0.2], [0.3, 0.4]]);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 0 });
});

test("embed reordena pelo index do payload (contrato OpenAI-compat)", async () => {
  const { implementation } = fakeFetch(async () => new Response(
    JSON.stringify({
      model: "openai/text-embedding-3-small",
      data: [
        { index: 1, embedding: [2, 2] },
        { index: 0, embedding: [1, 1] },
      ],
    }),
    { status: 200 },
  ));
  const port = provider.createOpenRouterEmbeddingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.embed({ model: "openai/text-embedding-3-small", inputs: ["a", "b"] });
  assert.deepEqual(result.embeddings, [[1, 1], [2, 2]]);
});

test("embed preserva usage.cost reportado pelo provider para finalizar a reserva", async () => {
  const { implementation } = fakeFetch(async () => new Response(JSON.stringify({
    ...embeddingsPayload([[0.1, 0.2]]),
    usage: { prompt_tokens: 12, total_tokens: 12, cost: 0.0000042 },
  }), { status: 200 }));
  const port = provider.createOpenRouterEmbeddingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.embed({ model: "openai/text-embedding-3-small", inputs: ["chunk"] });
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 0, reportedCostUsd: 0.0000042 });
});

test("embed valida inputs antes da rede e rejeita payloads inconsistentes", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response("{}", { status: 200 }));
  const port = provider.createOpenRouterEmbeddingPort({ apiKey: API_KEY, fetchImplementation: implementation });

  const invalid = [
    { model: "não é!!", inputs: ["a"] },
    { model: "openai/text-embedding-3-small", inputs: [] },
    { model: "openai/text-embedding-3-small", inputs: Array.from({ length: 65 }, () => "x") },
    { model: "openai/text-embedding-3-small", inputs: ["   "] },
    { model: "openai/text-embedding-3-small", inputs: ["x".repeat(8001)] },
  ];
  for (const bad of invalid) {
    await assert.rejects(() => port.embed(bad), (error) => error.code === "invalid_request");
  }
  assert.equal(calls.length, 0);

  const mismatch = fakeFetch(async () => new Response(
    JSON.stringify(embeddingsPayload([[0.1]])),
    { status: 200 },
  ));
  const portMismatch = provider.createOpenRouterEmbeddingPort({ apiKey: API_KEY, fetchImplementation: mismatch.implementation });
  await assert.rejects(
    () => portMismatch.embed({ model: "openai/text-embedding-3-small", inputs: ["a", "b"] }),
    (error) => error.code === "malformed_provider_response",
  );

  const badVector = fakeFetch(async () => new Response(
    JSON.stringify(embeddingsPayload([[0.1, "x"]])),
    { status: 200 },
  ));
  const portBadVector = provider.createOpenRouterEmbeddingPort({ apiKey: API_KEY, fetchImplementation: badVector.implementation });
  await assert.rejects(
    () => portBadVector.embed({ model: "openai/text-embedding-3-small", inputs: ["a"] }),
    (error) => error.code === "malformed_provider_response",
  );
});

test("embed nunca vaza a chave em erros do provider", async () => {
  const { implementation } = fakeFetch(async () => new Response(`denied for Bearer ${API_KEY}`, { status: 402 }));
  const port = provider.createOpenRouterEmbeddingPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await assert.rejects(
    () => port.embed({ model: "openai/text-embedding-3-small", inputs: ["a"] }),
    (error) => {
      assert.equal(error.code, "provider_rejected");
      assert.equal(error.message.includes(API_KEY), false);
      assert.equal(error.message.includes("denied"), false);
      return true;
    },
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

for (const kind of ["generation", "embedding"]) {
  for (const cancellation of ["pending", "rejected"]) {
    test(`${kind} ${cancellation} error body cancellation cannot block its terminal error`, async () => {
      let cancellations = 0;
      const { calls, implementation } = fakeFetch(async () => new Response(new ReadableStream({
        cancel() {
          cancellations += 1;
          return cancellation === "pending" ? new Promise(() => {}) : Promise.reject(new Error("cancel failed"));
        },
      }), { status: 503 }));
      const options = { apiKey: API_KEY, fetchImplementation: implementation, timeoutMs: 10 };
      const operation = kind === "generation"
        ? () => provider.createOpenRouterTextGenerationPort(options).generate(request())
        : () => provider.createOpenRouterEmbeddingPort(options).embed({ model: "openai/text-embedding-3-small", inputs: ["chunk"] });
      // Bound this injected failure so an implementation regression cannot hang the suite.
      let watchdog;
      try {
        await Promise.race([
          assert.rejects(operation, (error) => error.code === "provider_unavailable"),
          new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error("error cancellation blocked classification")), 100); }),
        ]);
      } finally { clearTimeout(watchdog); }
      assert.equal(calls.length, 1);
      assert.equal(cancellations, 1);
      assert.equal(calls[0].init.signal.aborted, true);
    });
  }
}

const LEAD_TOOL = Object.freeze({
  name: "register_lead",
  description: "Registers a qualified lead.",
  parameters: { type: "object", properties: { contactName: { type: "string" } }, required: ["contactName"] },
});

function toolCallPayload(toolCalls, content = null) {
  return completionPayload({ choices: [{ message: { role: "assistant", content, tool_calls: toolCalls } }] });
}

test("tools are offered in OpenAI function format and tool_calls come back parsed", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify(toolCallPayload([
    { id: "call_1", type: "function", function: { name: "register_lead", arguments: "{\"contactName\":\"Ana\"}" } },
  ], "Let me save that for the agent.")), { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.generate(request({ tools: [LEAD_TOOL] }));
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.tools, [{ type: "function", function: { name: "register_lead", description: LEAD_TOOL.description, parameters: LEAD_TOOL.parameters } }]);
  assert.equal(body.tool_choice, "auto");
  assert.equal(result.text, "Let me save that for the agent.");
  assert.deepEqual(result.toolCalls, [{ id: "call_1", name: "register_lead", argumentsJson: "{\"contactName\":\"Ana\"}" }]);
});

test("a tool call alone, with no text, is a valid completion", async () => {
  const { implementation } = fakeFetch(async () => new Response(JSON.stringify(toolCallPayload([
    { id: "call_2", type: "function", function: { name: "register_lead", arguments: "{}" } },
  ])), { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.generate(request({ tools: [LEAD_TOOL] }));
  assert.equal(result.text, "");
  assert.equal(result.toolCalls.length, 1);
});

test("a tool the request never offered is dropped, never turned into an action", async () => {
  const { implementation } = fakeFetch(async () => new Response(JSON.stringify(toolCallPayload([
    { id: "call_3", type: "function", function: { name: "issue_refund", arguments: "{\"amount\":999}" } },
  ], "Sure.")), { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.generate(request({ tools: [LEAD_TOOL] }));
  assert.equal(result.text, "Sure.");
  assert.equal(result.toolCalls, undefined);
});

test("each malformed tool call is dropped on its own, so a paid answer is never thrown away", async () => {
  const valid = { id: "call_ok", type: "function", function: { name: "register_lead", arguments: "{\"contactName\":\"Ana\"}" } };
  for (const [toolCalls, dropped] of [
    [[{ id: "call 4", type: "function", function: { name: "register_lead", arguments: "{}" } }, valid], 1],
    [[{ id: "call_5", type: "function", function: { name: "register_lead", arguments: "{\"contactName\":\"An" } }, valid], 1],
    [[{ id: "call_6", type: "function", function: { name: "register_lead", arguments: "[1,2]" } }, valid], 1],
    [[valid, ...Array.from({ length: 4 }, (_, index) => ({ ...valid, id: `call_${index}` }))], 1],
  ]) {
    const { implementation } = fakeFetch(async () => new Response(JSON.stringify(toolCallPayload(toolCalls, "One moment.")), { status: 200 }));
    const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });
    const result = await port.generate(request({ tools: [LEAD_TOOL] }));
    assert.equal(result.text, "One moment.");
    assert.equal(result.droppedToolCalls, dropped);
    assert.ok(result.toolCalls.length >= 1 && result.toolCalls.length <= 4);
    assert.ok(result.toolCalls.every((call) => JSON.parse(call.argumentsJson) !== null));
  }
});

test("nothing usable left: the error carries the billed usage so the ledger can close", async () => {
  const truncated = [{ id: "call_7", type: "function", function: { name: "register_lead", arguments: "{\"qualificationSummary\":\"long" } }];
  const { implementation } = fakeFetch(async () => new Response(JSON.stringify(toolCallPayload(truncated)), { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await assert.rejects(() => port.generate(request({ tools: [LEAD_TOOL] })), (error) => {
    assert.equal(error.code, "malformed_provider_response");
    assert.deepEqual({ ...error.billedUsage }, { inputTokens: 42, outputTokens: 17 });
    return true;
  });

  const unreported = completionPayload({ choices: [{ message: { role: "assistant", content: "" } }], usage: {} });
  const second = fakeFetch(async () => new Response(JSON.stringify(unreported), { status: 200 }));
  const unknownPort = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: second.implementation });
  await assert.rejects(() => unknownPort.generate(request()), (error) => error.code === "malformed_provider_response" && error.billedUsage === undefined);
});

test("invalid tool definitions are rejected before any request", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify(completionPayload()), { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  for (const tools of [
    [{ ...LEAD_TOOL, name: "Register Lead" }],
    [LEAD_TOOL, LEAD_TOOL],
    [{ ...LEAD_TOOL, parameters: { type: "string" } }],
    [{ ...LEAD_TOOL, description: "" }],
  ]) {
    await assert.rejects(() => port.generate(request({ tools })), (error) => error.code === "invalid_request");
  }
  assert.equal(calls.length, 0);
});

test("prompt caching marks only the last system message, and only for Anthropic models", async () => {
  const messages = [
    { role: "system", content: "Static persona part one." },
    { role: "system", content: "Static persona part two." },
    { role: "user", content: "Hello" },
  ];
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify(completionPayload()), { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await port.generate(request({ messages, cacheSystemPrompt: true }));
  const anthropic = JSON.parse(calls[0].init.body).messages;
  assert.equal(anthropic[0].content, "Static persona part one.");
  assert.deepEqual(anthropic[1].content, [{ type: "text", text: "Static persona part two.", cache_control: { type: "ephemeral" } }]);
  assert.equal(anthropic[2].content, "Hello");
  await port.generate(request({ model: "openai/gpt-4o-mini", messages, cacheSystemPrompt: true }));
  const other = JSON.parse(calls[1].init.body).messages;
  assert.ok(other.every((message) => typeof message.content === "string"), "other providers cache automatically");
  await port.generate(request({ messages }));
  assert.ok(JSON.parse(calls[2].init.body).messages.every((message) => typeof message.content === "string"));
});

test("cached input tokens are reported only when coherent with the input total", async () => {
  const usage = (details) => completionPayload({ usage: { prompt_tokens: 3000, completion_tokens: 40, prompt_tokens_details: details } });
  const responses = [usage({ cached_tokens: 2800 }), usage({ cached_tokens: 9000 }), usage({ cached_tokens: "2800" }), usage(undefined)];
  const { implementation } = fakeFetch(async () => new Response(JSON.stringify(responses.shift()), { status: 200 }));
  const port = provider.createOpenRouterTextGenerationPort({ apiKey: API_KEY, fetchImplementation: implementation });
  assert.equal((await port.generate(request({ cacheSystemPrompt: true }))).usage.cachedInputTokens, 2800);
  for (let index = 0; index < 3; index += 1) {
    assert.equal("cachedInputTokens" in (await port.generate(request({ cacheSystemPrompt: true }))).usage, false);
  }
});
