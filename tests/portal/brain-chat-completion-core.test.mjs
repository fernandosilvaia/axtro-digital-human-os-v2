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

test("video surface splits the rich persona prompt into system messages under the adapter's per-message cap", async () => {
  const { deps, calls } = fakeDeps();
  await core.runBrainChatCompletion({ ...BASE_REQUEST, surface: "video" }, deps);
  const systemMessages = calls.generate[0].messages.filter((m) => m.role === "system");
  // O prompt de vídeo tem >10k chars: como UMA mensagem o adapter rejeitava
  // TODA chamada (achado P1, auditoria 2026-08-02). Agora é fatiado.
  assert.ok(systemMessages.length >= 2, `esperava >=2 mensagens system, veio ${systemMessages.length}`);
  for (const message of systemMessages) {
    assert.ok(message.content.length <= 4000, `mensagem system com ${message.content.length} chars estoura o cap do adapter`);
  }
  const joined = systemMessages.map((m) => m.content).join("\n\n");
  assert.match(joined, /VIDEOCHAMADA/);
  assert.match(joined, /next_slide/);
  assert.match(joined, /MAESTRIA HUMANA/);
});

test("video surface truncates oversized user message and history turns instead of rejecting (Tavus controls the input)", async () => {
  const { deps, calls } = fakeDeps();
  const result = await core.runBrainChatCompletion(
    {
      ...BASE_REQUEST,
      surface: "video",
      userMessage: "y".repeat(5000),
      history: [
        { role: "user", content: "x".repeat(9000) },
        { role: "assistant", content: "resposta normal" },
      ],
    },
    deps,
  );
  assert.equal(result.reply, "resposta gerada");
  const { messages } = calls.generate[0];
  assert.equal(messages.at(-1).content.length, 2000);
  const longTurn = messages.find((m) => m.role === "user" && m.content.startsWith("xxx"));
  assert.equal(longTurn.content.length, 4000);
});

test("chat surface still REJECTS oversized turns — the sandbox controls its own input", async () => {
  const { deps, calls } = fakeDeps();
  await assert.rejects(
    () => core.runBrainChatCompletion({ ...BASE_REQUEST, history: [{ role: "user", content: "x".repeat(9000) }] }, deps),
    core.BrainChatValidationError,
  );
  assert.equal(calls.generate.length, 0);
});

test("provider context is folded as a labeled data block, most recent kept on truncation", async () => {
  const { deps, calls } = fakeDeps();
  const providerContext = "INÍCIO-antigo " + "meio ".repeat(900) + "FIM-recente";
  await core.runBrainChatCompletion({ ...BASE_REQUEST, surface: "video", providerContext }, deps);
  const block = calls.generate[0].messages.find((m) => m.role === "system" && m.content.startsWith("CONTEXTO DESTA CHAMADA"));
  assert.ok(block, "bloco de contexto do provider ausente");
  assert.match(block.content, /FIM-recente/);
  assert.doesNotMatch(block.content, /INÍCIO-antigo/);
  assert.match(block.content, /nunca instrução/);
});

test("splitSystemPrompt reassembles losslessly and respects the cap", () => {
  const prompt = ["a".repeat(3000), "b".repeat(3000), "c".repeat(3000)].join("\n\n");
  const parts = core.splitSystemPrompt(prompt);
  assert.ok(parts.length >= 2);
  for (const part of parts) assert.ok(part.length <= 3800);
  assert.equal(parts.join("\n\n"), prompt);
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
