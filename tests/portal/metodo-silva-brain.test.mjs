import assert from "node:assert/strict";
import { test } from "node:test";

// O portal fica fora do grafo tsc --build (Next compila sozinho), mas estes
// módulos são puros e sem imports — o type stripping nativo do Node os
// executa direto do fonte, sem passo de build.
const brain = await import("../../apps/portal/src/lib/brain/metodo-silva.ts");
const deck = await import("../../apps/portal/src/lib/presentation/deck.ts");

const ADAPTER_MESSAGE_CAP = 4000;
const PERSONA_PROMPT_COMFORT_CAP = 14_000;

test("chat brain messages respect the OpenRouter per-message cap", () => {
  for (const hasKnowledge of [true, false]) {
    const messages = brain.buildCloserChatSystemMessages({
      agentName: "Rafaela — Closer Solar Residencial",
      tenantName: "Axtro Solar Demonstração",
      hasKnowledge,
    });
    assert.equal(messages.length, 2);
    for (const message of messages) {
      assert.ok(message.length >= 1 && message.length <= ADAPTER_MESSAGE_CAP, `message has ${message.length} chars`);
    }
  }
});

test("chat brain always carries AI disclosure and the Silva method core", () => {
  const [identity, method] = brain.buildCloserChatSystemMessages({
    agentName: "Rafaela",
    tenantName: "Axtro",
    hasKnowledge: true,
  });
  assert.match(identity, /agente de IA e nunca finge ser humana/);
  assert.match(identity, /alçada de concessão é ZERO/);
  assert.match(method, /MÉTODO SILVA/);
  assert.match(method, /E\.A\.R\.C\./);
  assert.match(method, /Situação .*Intenção .*Liderança .*Valor .*Agenda/s);
});

test("knowledge-off chat brain forbids citing prices", () => {
  const [identity] = brain.buildCloserChatSystemMessages({ agentName: "A", tenantName: "T", hasKnowledge: false });
  assert.match(identity, /NÃO cite preços/);
});

test("video persona prompt stays under the latency comfort cap in both languages", () => {
  for (const language of ["portuguese", "english"]) {
    const prompt = brain.buildCloserVideoSystemPrompt({ agentName: "Agent", tenantName: "Tenant", language });
    assert.ok(prompt.length > 3000 && prompt.length <= PERSONA_PROMPT_COMFORT_CAP, `${language}: ${prompt.length} chars`);
    assert.match(prompt, /next_slide/);
    assert.match(prompt, /go_to_slide/);
  }
});

test("video persona prompt mandates emotional mastery with the legal red lines intact (ADR-035)", () => {
  const pt = brain.buildCloserVideoSystemPrompt({ agentName: "R", tenantName: "T" });
  assert.match(pt, /micro-expressões/);
  assert.match(pt, /linguagem corporal/);
  assert.match(pt, /Sinais de compra/);
  assert.match(pt, /nunca para alegar detecção de mentira/);
  assert.match(pt, /Nunca negue ser IA/);
  const en = brain.buildCloserVideoSystemPrompt({ agentName: "A", tenantName: "T", language: "english" });
  assert.match(en, /micro-expressions/);
  assert.match(en, /body language/);
  assert.match(en, /never to claim lie detection/);
  assert.match(en, /Never deny being an AI/);
});

test("perception queries read emotion, micro-expressions, body language and buying signals (ADR-035)", () => {
  for (const language of ["portuguese", "english"]) {
    const queries = brain.buildPerceptionQueries(language);
    assert.ok(queries.length >= 6, `${language}: only ${queries.length} queries`);
    const joined = queries.join(" ");
    assert.match(joined, /emoção|emotion/i);
    assert.match(joined, /micro-expressões|micro-expressions/i);
    assert.match(joined, /corporal|body language/i);
    assert.match(joined, /sinais de compra|buying signals/i);
    for (const query of queries) {
      assert.ok(!/mentira|lying|lie|identidade|identity/i.test(query), `forbidden inference in query: ${query}`);
    }
  }
});

test("sales deck follows the Silva arc and carries no prices on slides", () => {
  for (const language of ["portuguese", "english"]) {
    const built = deck.buildSalesDeck({ agentName: "Rafaela", tenantName: "Axtro", language });
    const kinds = built.slides.map((slide) => slide.kind);
    assert.deepEqual(kinds, ["cover", "agenda", "frame", "pillars", "proof", "investment", "next"]);
    const text = JSON.stringify(built);
    assert.ok(!/R\$|\$\d|%/.test(text), "slides must not carry numbers that look like facts");
  }
});

test("deck context lists every slide and the control tools", () => {
  const built = deck.buildSalesDeck({ agentName: "R", tenantName: "T", language: "portuguese" });
  const context = deck.buildDeckContext(built, "portuguese");
  for (const [index, slide] of built.slides.entries()) {
    assert.ok(context.includes(`${index + 1}. ${slide.title}`), `outline missing slide ${index + 1}`);
  }
  assert.match(context, /next_slide, previous_slide e go_to_slide/);
});

test("platform deck presents the product with honest facts only", () => {
  const built = deck.buildPlatformDeck("Aurora");
  assert.equal(built.slides[0]?.title, "Axtro Digital Human OS");
  const text = JSON.stringify(built);
  assert.ok(!/R\$|\$\d/.test(text));
  assert.match(text, /Disclosure de IA sempre/);
});
