import assert from "node:assert/strict";
import { test } from "node:test";

const videoConfig = await import("../../apps/portal/src/lib/video-config.ts");
const { providerLanguageCodes } = videoConfig;

/**
 * Tradução do vocabulário do domínio para o código da Tavus (D-V2-175).
 *
 * O risco que estes testes fecham não é a tradução em si, é a ORDEM: a Tavus
 * abre a conversa no primeiro idioma do array. Se o idioma de abertura não for
 * o primeiro, a agente cumprimenta em espanhol alguém que ela deveria receber
 * em inglês, e isso não quebra nada de forma visível, só faz a call começar
 * errada.
 */

test("sem idiomas declarados, devolve undefined e o chamador mantém o campo singular", () => {
  assert.equal(providerLanguageCodes("english", null), undefined);
  assert.equal(providerLanguageCodes("english", undefined), undefined);
  assert.equal(providerLanguageCodes("english", []), undefined);
});

test("o idioma de abertura vem sempre em primeiro, porque é ele que abre a call", () => {
  assert.deepEqual(
    providerLanguageCodes("english", ["portuguese", "spanish", "english"]),
    ["en", "pt", "es"],
  );
  assert.deepEqual(
    providerLanguageCodes("spanish", ["portuguese", "spanish", "english"]),
    ["es", "pt", "en"],
  );
});

test("traduz o vocabulário do domínio, nunca repassa o termo do domínio cru", () => {
  const codes = providerLanguageCodes("portuguese", ["portuguese", "english", "spanish"]);
  assert.deepEqual(codes, ["pt", "en", "es"]);
  for (const code of codes) {
    assert.ok(code.length === 2, `"${code}" não é código de provider`);
  }
});

test("idioma desconhecido é descartado em vez de repassado ao provider", () => {
  // Mandar um código que o provider não entende arrisca a call inteira. Cair
  // no conjunto menor é degradação segura.
  assert.deepEqual(providerLanguageCodes("english", ["english", "klingon"]), ["en"]);
  assert.equal(providerLanguageCodes("english", ["klingon"]), undefined);
});

test("abertura fora da lista não inventa uma entrada nova", () => {
  // O banco proíbe este estado (0066), mas se ele chegar aqui por outro
  // caminho, a função nunca pode acrescentar um idioma que o agente não
  // declarou: ela respeita a lista e deixa a ordem original.
  assert.deepEqual(providerLanguageCodes("english", ["spanish", "portuguese"]), ["es", "pt"]);
});
