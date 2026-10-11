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

test("an oversized video history is trimmed to the reserved envelope before deps.generate", async () => {
  // Antes da D-V2-196 este caso era recusado inteiro e virava fallback em todo
  // turno seguinte (o histórico só cresce). Agora os turnos mais antigos saem e
  // o provedor nunca recebe mais do que a reserva cobre.
  const history = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `turno ${index} ${"🙂".repeat(600)}`,
  }));
  const sent = [];
  await brain.runBrainChatCompletion(
    { agentName: "Camila", tenantName: "Axtro", surface: "video", knowledgeMatches: [], history, userMessage: "Pode continuar?" },
    {
      generate: async (messages) => {
        sent.push(messages);
        return { text: "Claro.", model: "fake", usage: { inputTokens: 1, outputTokens: 1 } };
      },
      logGenerationUsage: async () => {},
    },
  );
  assert.equal(sent.length, 1);
  assert.ok(envelope.generationInputTokenUpperBound(sent[0]) <= 20_000, "never more input than the reservation covers");
  const kept = sent[0].filter((message) => message.content.startsWith("turno ")).map((message) => Number(message.content.split(" ")[1]));
  assert.ok(kept.length > 0 && kept.length < history.length);
  assert.equal(kept.at(-1), 19, "the newest turn stays");
});

test("generation preflight still fails closed when the fixed part alone exceeds the envelope", async () => {
  // Prompt da vertical, schemas das quatro tools e uma fala atual de 2.000
  // emojis (8 mil bytes) não cabem em 20 mil. Nada disso é cortável: o
  // provedor nunca é chamado.
  let providerCalls = 0;
  await assert.rejects(
    () => brain.runBrainChatCompletion(
      {
        agentName: "Priscila",
        tenantName: "Axtro",
        surface: "video",
        language: "portuguese",
        closerVertical: "life_insurance_qualification",
        knowledgeMatches: [],
        history: [],
        userMessage: "🙂".repeat(2_000),
        availableTools: ["register_lead", "propose_meeting_slots", "confirm_meeting_slot", "estimate_coverage_need"],
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
