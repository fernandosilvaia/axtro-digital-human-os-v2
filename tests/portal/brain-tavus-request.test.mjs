import assert from "node:assert/strict";
import { test } from "node:test";

// Sem imports de outros módulos do portal (só o tipo BrainTurn, apagado pelo
// type stripping) — roda direto do fonte, mesmo padrão dos demais testes de brain/.
const tavus = await import("../../apps/portal/src/lib/brain/tavus-request.ts");

test("discards Tavus system messages entirely — identity and method are ours, never theirs", () => {
  const parsed = tavus.parseTavusChatRequest([
    { role: "system", content: "You are a helpful generic assistant for TavusCo." },
    { role: "user", content: "Oi, quanto custa?" },
  ]);
  assert.equal(parsed.history.length, 0);
  assert.equal(parsed.userMessage, "Oi, quanto custa?");
});

test("extracts perception tags found inside a system message before discarding it", () => {
  const parsed = tavus.parseTavusChatRequest([
    { role: "system", content: "<user_emotions>a pessoa parece cética</user_emotions>" },
    { role: "user", content: "Me fala mais sobre o preço" },
  ]);
  assert.match(parsed.perceptionContext ?? "", /a pessoa parece cética/);
});

test("extracts perception tags found inline inside the latest user message and strips them from the visible turn", () => {
  const parsed = tavus.parseTavusChatRequest([
    { role: "user", content: "Isso parece caro. <user_appearance>braços cruzados, testa franzida</user_appearance>" },
  ]);
  assert.equal(parsed.userMessage, "Isso parece caro.");
  assert.match(parsed.perceptionContext ?? "", /braços cruzados/);
});

test("concatenates multiple perception tag types across multiple messages", () => {
  const parsed = tavus.parseTavusChatRequest([
    { role: "system", content: "<user_appearance>inclinada para frente</user_appearance>" },
    { role: "assistant", content: "Faz sentido pra você?" },
    { role: "user", content: "Sim <user_emotions>sorriso genuíno</user_emotions> <user_screenshare>nenhuma tela compartilhada</user_screenshare>" },
  ]);
  assert.match(parsed.perceptionContext ?? "", /inclinada para frente/);
  assert.match(parsed.perceptionContext ?? "", /sorriso genuíno/);
  assert.match(parsed.perceptionContext ?? "", /nenhuma tela compartilhada/);
});

test("returns null perceptionContext when no tags are present anywhere", () => {
  const parsed = tavus.parseTavusChatRequest([{ role: "user", content: "oi" }]);
  assert.equal(parsed.perceptionContext, null);
});

test("preserves user/assistant turn order as history, excluding the trailing user turn", () => {
  const parsed = tavus.parseTavusChatRequest([
    { role: "system", content: "persona prompt" },
    { role: "user", content: "primeira pergunta" },
    { role: "assistant", content: "primeira resposta" },
    { role: "user", content: "segunda pergunta" },
    { role: "assistant", content: "segunda resposta" },
    { role: "user", content: "terceira pergunta" },
  ]);
  assert.deepEqual(parsed.history, [
    { role: "user", content: "primeira pergunta" },
    { role: "assistant", content: "primeira resposta" },
    { role: "user", content: "segunda pergunta" },
    { role: "assistant", content: "segunda resposta" },
  ]);
  assert.equal(parsed.userMessage, "terceira pergunta");
});

test("rejects an empty array", () => {
  assert.throws(() => tavus.parseTavusChatRequest([]), tavus.TavusRequestParseError);
});

test("rejects a non-array payload", () => {
  for (const bad of [null, undefined, "messages", {}, 42]) {
    assert.throws(() => tavus.parseTavusChatRequest(bad), tavus.TavusRequestParseError);
  }
});

test("rejects a message with non-string content (e.g. multimodal parts array)", () => {
  assert.throws(
    () => tavus.parseTavusChatRequest([{ role: "user", content: [{ type: "text", text: "oi" }] }]),
    tavus.TavusRequestParseError,
  );
});

test("rejects an unknown message role", () => {
  assert.throws(
    () => tavus.parseTavusChatRequest([{ role: "tool", content: "oi" }]),
    tavus.TavusRequestParseError,
  );
});

test("rejects when the trailing message is not a non-empty user turn", () => {
  assert.throws(
    () => tavus.parseTavusChatRequest([{ role: "user", content: "oi" }, { role: "assistant", content: "olá" }]),
    tavus.TavusRequestParseError,
  );
  assert.throws(
    () => tavus.parseTavusChatRequest([{ role: "system", content: "persona" }]),
    tavus.TavusRequestParseError,
  );
});

test("rejects when the trailing user message is only perception tags with no real speech", () => {
  assert.throws(
    () => tavus.parseTavusChatRequest([{ role: "user", content: "<user_emotions>tédio</user_emotions>" }]),
    tavus.TavusRequestParseError,
  );
});

test("rejects an oversized message array or an oversized single message", () => {
  const tooManyMessages = Array.from({ length: 201 }, (_, i) => ({ role: "user", content: `m${i}` }));
  assert.throws(() => tavus.parseTavusChatRequest(tooManyMessages), tavus.TavusRequestParseError);

  const tooLongMessage = [{ role: "user", content: "x".repeat(20_001) }];
  assert.throws(() => tavus.parseTavusChatRequest(tooLongMessage), tavus.TavusRequestParseError);
});
