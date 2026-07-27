import assert from "node:assert/strict";
import { test } from "node:test";

// O portal fica fora do grafo tsc --build (Next compila sozinho); este
// módulo só importa metodo-silva.ts (também sem imports), então o type
// stripping nativo do Node executa a cadeia direto do fonte, sem build.
const core = await import("../../apps/portal/src/lib/brain/chat-completion-core.ts");

function fakeDeps(overrides = {}) {
  const calls = { generate: [], logGenerationUsage: [] };
  return {
    calls,
    deps: {
      generate: async (messages, maxOutputTokens) => {
        calls.generate.push({ messages, maxOutputTokens });
        return overrides.generateResult ?? {
          text: "resposta gerada",
          model: "fake/model",
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      },
      logGenerationUsage: async (inputTokens, outputTokens) => {
        calls.logGenerationUsage.push({ inputTokens, outputTokens });
      },
    },
  };
}

const BASE_REQUEST = {
  agentName: "Rafaela",
  tenantName: "Axtro Solar",
  surface: "chat",
  knowledgeMatches: [],
  history: [],
  userMessage: "Quanto custa a instalação?",
};

test("chat surface composes identity + método system messages and no knowledge block when empty", async () => {
  const { deps, calls } = fakeDeps();
  const result = await core.runBrainChatCompletion(BASE_REQUEST, deps);
  assert.equal(result.reply, "resposta gerada");
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 20 });
  assert.equal(calls.generate.length, 1);
  const { messages } = calls.generate[0];
  assert.equal(messages.filter((m) => m.role === "system").length, 2);
  assert.equal(messages.at(-1).role, "user");
  assert.equal(messages.at(-1).content, "Quanto custa a instalação?");
  assert.equal(calls.logGenerationUsage.length, 1);
  assert.deepEqual(calls.logGenerationUsage[0], { inputTokens: 100, outputTokens: 20 });
});

test("video surface uses the rich video persona prompt instead of the chat identity", async () => {
  const { deps, calls } = fakeDeps();
  await core.runBrainChatCompletion({ ...BASE_REQUEST, surface: "video" }, deps);
  const systemMessages = calls.generate[0].messages.filter((m) => m.role === "system");
  assert.equal(systemMessages.length, 1);
  assert.match(systemMessages[0].content, /VIDEOCHAMADA/);
  assert.match(systemMessages[0].content, /next_slide/);
});

test("knowledge matches produce a labeled, bounded system message", async () => {
  const { deps, calls } = fakeDeps();
  const knowledgeMatches = [
    { source_name: "Manual do Closer", chunk_text: "Preço fixo e publicado, sem negociação." },
    { source_name: "Rate Card", chunk_text: "Instalação residencial parte de R$ 12.000." },
  ];
  await core.runBrainChatCompletion({ ...BASE_REQUEST, knowledgeMatches }, deps);
  const systemMessages = calls.generate[0].messages.filter((m) => m.role === "system");
  const knowledgeMessage = systemMessages.find((m) => m.content.startsWith("FONTES AUTORIZADAS"));
  assert.ok(knowledgeMessage, "knowledge block missing");
  assert.match(knowledgeMessage.content, /Manual do Closer/);
  assert.match(knowledgeMessage.content, /Rate Card/);
});

test("perception context is folded as labeled, untrusted data — never as identity or instruction", async () => {
  const { deps, calls } = fakeDeps();
  const perceptionContext = "<user_emotions>a pessoa parece cética, braços cruzados</user_emotions>";
  await core.runBrainChatCompletion({ ...BASE_REQUEST, surface: "video", perceptionContext }, deps);
  const systemMessages = calls.generate[0].messages.filter((m) => m.role === "system");
  const perceptionMessage = systemMessages.find((m) => m.content.includes(perceptionContext));
  assert.ok(perceptionMessage, "perception block missing");
  assert.match(perceptionMessage.content, /evidência, não fato/);
  assert.match(perceptionMessage.content, /nunca decide preço/);
});

test("null, undefined or blank perception context produces no extra system message", async () => {
  for (const perceptionContext of [null, undefined, "   "]) {
    const { deps, calls } = fakeDeps();
    await core.runBrainChatCompletion({ ...BASE_REQUEST, perceptionContext }, deps);
    const systemMessages = calls.generate[0].messages.filter((m) => m.role === "system");
    assert.equal(systemMessages.length, 2, `unexpected system message for perceptionContext=${JSON.stringify(perceptionContext)}`);
  }
});

test("oversized perception context is truncated, never dropped silently", async () => {
  const { deps, calls } = fakeDeps();
  const huge = "x".repeat(5000);
  await core.runBrainChatCompletion({ ...BASE_REQUEST, perceptionContext: huge }, deps);
  const systemMessages = calls.generate[0].messages.filter((m) => m.role === "system");
  const perceptionMessage = systemMessages.find((m) => m.content.includes("xxxx"));
  assert.ok(perceptionMessage);
  assert.ok(perceptionMessage.content.length < huge.length);
});

test("history is included in order and the final user turn is appended last", async () => {
  const { deps, calls } = fakeDeps();
  const history = [
    { role: "user", content: "Oi" },
    { role: "assistant", content: "Olá! Como posso ajudar?" },
  ];
  await core.runBrainChatCompletion({ ...BASE_REQUEST, history }, deps);
  const { messages } = calls.generate[0];
  const nonSystem = messages.filter((m) => m.role !== "system");
  assert.deepEqual(nonSystem, [
    { role: "user", content: "Oi" },
    { role: "assistant", content: "Olá! Como posso ajudar?" },
    { role: "user", content: "Quanto custa a instalação?" },
  ]);
});

test("total message count never exceeds the OpenRouter adapter cap even with full context and long history", async () => {
  const { deps, calls } = fakeDeps();
  const history = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `turno ${i}`,
  }));
  const knowledgeMatches = [{ source_name: "Fonte", chunk_text: "conteúdo relevante" }];
  await core.runBrainChatCompletion(
    { ...BASE_REQUEST, surface: "video", history, knowledgeMatches, perceptionContext: "<user_emotions>engajada</user_emotions>" },
    deps,
  );
  const { messages } = calls.generate[0];
  assert.ok(messages.length <= 24, `expected <=24 messages, got ${messages.length}`);
  // O turno mais recente do usuário nunca pode ser cortado pela janela de histórico.
  assert.equal(messages.at(-1).content, "Quanto custa a instalação?");
  assert.equal(messages.at(-2).content, "turno 39");
});

test("rejects empty or oversized user message without calling the provider", async () => {
  const { deps, calls } = fakeDeps();
  for (const userMessage of ["", "   ", "x".repeat(2001)]) {
    await assert.rejects(
      () => core.runBrainChatCompletion({ ...BASE_REQUEST, userMessage }, deps),
      core.BrainChatValidationError,
    );
  }
  assert.equal(calls.generate.length, 0);
});

test("rejects a malformed history turn without calling the provider", async () => {
  const { deps, calls } = fakeDeps();
  const badHistories = [
    [{ role: "system", content: "not allowed" }],
    [{ role: "user", content: "" }],
    [{ role: "user" }],
  ];
  for (const history of badHistories) {
    await assert.rejects(
      () => core.runBrainChatCompletion({ ...BASE_REQUEST, history }, deps),
      core.BrainChatValidationError,
    );
  }
  assert.equal(calls.generate.length, 0);
});

test("propagates provider errors and still never logs usage for a failed call", async () => {
  const calls = { generate: [], logGenerationUsage: [] };
  const deps = {
    generate: async () => { throw new Error("provider_unavailable"); },
    logGenerationUsage: async (inputTokens, outputTokens) => {
      calls.logGenerationUsage.push({ inputTokens, outputTokens });
    },
  };
  await assert.rejects(() => core.runBrainChatCompletion(BASE_REQUEST, deps), /provider_unavailable/);
  assert.equal(calls.logGenerationUsage.length, 0);
});
