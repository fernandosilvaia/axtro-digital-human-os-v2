import assert from "node:assert/strict";
import { test } from "node:test";

const envelope = await import("../../apps/portal/src/lib/ai-budget/envelope.ts");
const knowledge = await import("../../apps/portal/src/lib/knowledge.ts");
const brain = await import("../../apps/portal/src/lib/brain/chat-completion-core.ts");

test("embedding preflight rejects Unicode that can exceed its reservation before any provider request", async () => {
  const originalFakeProviders = process.env.PORTAL_FAKE_PROVIDERS;
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  delete process.env.PORTAL_FAKE_PROVIDERS;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error("the provider must not be reached");
  };
  try {
    await assert.rejects(
      () => knowledge.embedChunks("test-openrouter-key-0000000000000000", ["🙂".repeat(6_000)], 20_000),
      envelope.AiUsageEnvelopeError,
    );
    await assert.rejects(
      () => knowledge.embedQuery("test-openrouter-key-0000000000000000", "🙂".repeat(300), 1_000),
      envelope.AiUsageEnvelopeError,
    );
    assert.equal(providerCalls, 0, "input over the reservation cannot cross the provider dispatch boundary");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFakeProviders === undefined) delete process.env.PORTAL_FAKE_PROVIDERS;
    else process.env.PORTAL_FAKE_PROVIDERS = originalFakeProviders;
  }
});

test("generation preflight rejects an oversized video context before deps.generate", async () => {
  let providerCalls = 0;
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: "🙂".repeat(2_000),
  }));

  await assert.rejects(
    () => brain.runBrainChatCompletion(
      {
        agentName: "Camila",
        tenantName: "Axtro",
        surface: "video",
        knowledgeMatches: [],
        history,
        userMessage: "Pode continuar?",
      },
      {
        generate: async () => {
          providerCalls += 1;
          throw new Error("the provider must not be reached");
        },
        logGenerationUsage: async () => {},
      },
    ),
    envelope.AiUsageEnvelopeError,
  );
  assert.equal(providerCalls, 0, "the reservation fence must remain unopened for oversized generation input");
});

test("generation output cannot exceed its reserved envelope", async () => {
  let providerCalls = 0;
  await assert.rejects(
    () => brain.runBrainChatCompletion(
      {
        agentName: "Camila",
        tenantName: "Axtro",
        surface: "chat",
        knowledgeMatches: [],
        history: [],
        userMessage: "Olá",
        maxOutputTokens: 513,
      },
      {
        generate: async () => {
          providerCalls += 1;
          throw new Error("the provider must not be reached");
        },
        logGenerationUsage: async () => {},
      },
    ),
    /reserved output envelope/,
  );
  assert.equal(providerCalls, 0);
});
