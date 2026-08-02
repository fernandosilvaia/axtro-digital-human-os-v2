import assert from "node:assert/strict";
import { test } from "node:test";

const maestria = await import("../../apps/portal/src/lib/brain/maestria-humana.ts");
const brain = await import("../../apps/portal/src/lib/brain/metodo-silva.ts");

const PERSONA_PROMPT_COMFORT_CAP = 14_000;

test("doutrina existe nos dois idiomas com as seis seções", () => {
  for (const block of [maestria.MAESTRIA_HUMANA_PT, maestria.MAESTRIA_HUMANA_EN]) {
    assert.ok(block.length > 1500 && block.length < 4000, `bloco com ${block.length} chars`);
  }
  assert.match(maestria.MAESTRIA_HUMANA_PT, /LINHA DE BASE/);
  assert.match(maestria.MAESTRIA_HUMANA_PT, /CLUSTERS/);
  assert.match(maestria.MAESTRIA_HUMANA_PT, /RECIPROCIDADE/);
  assert.match(maestria.MAESTRIA_HUMANA_PT, /PROVA SOCIAL/);
  assert.match(maestria.MAESTRIA_HUMANA_PT, /DINÂMICA DE STATUS/);
  assert.match(maestria.MAESTRIA_HUMANA_PT, /ENQUADRAMENTO DE VALOR/);
  assert.match(maestria.MAESTRIA_HUMANA_EN, /BASELINE/);
  assert.match(maestria.MAESTRIA_HUMANA_EN, /SOCIAL PROOF/);
  assert.match(maestria.MAESTRIA_HUMANA_EN, /VALUE FRAMING/);
});

test("a ética é inegociável dentro da própria doutrina (escassez real, sem detecção de mentira)", () => {
  assert.match(maestria.MAESTRIA_HUMANA_PT, /escassez inventada é proibida/i);
  assert.match(maestria.MAESTRIA_HUMANA_PT, /nunca alegar detecção de mentira/i);
  assert.match(maestria.MAESTRIA_HUMANA_PT, /decidir com MAIS clareza/);
  assert.match(maestria.MAESTRIA_HUMANA_EN, /invented scarcity is forbidden/i);
  assert.match(maestria.MAESTRIA_HUMANA_EN, /never claim lie detection/i);
});

test("o prompt de vídeo carrega a doutrina nos dois idiomas e continua sob o teto de latência", () => {
  const pt = brain.buildCloserVideoSystemPrompt({ agentName: "Raissa", tenantName: "Axtro AI" });
  const en = brain.buildCloserVideoSystemPrompt({ agentName: "Amanda", tenantName: "Ecoloop", language: "english" });
  assert.ok(pt.includes(maestria.MAESTRIA_HUMANA_PT), "PT sem o bloco de maestria");
  assert.ok(en.includes(maestria.MAESTRIA_HUMANA_EN), "EN sem o bloco de maestria");
  assert.ok(pt.length <= PERSONA_PROMPT_COMFORT_CAP, `PT com ${pt.length} chars estourou o teto`);
  assert.ok(en.length <= PERSONA_PROMPT_COMFORT_CAP, `EN com ${en.length} chars estourou o teto`);
  // As linhas vermelhas pré-existentes continuam presentes DEPOIS da adição.
  assert.match(pt, /nunca para alegar detecção de mentira/);
  assert.match(pt, /Nunca negue ser IA/);
});

test("a doutrina reforça, não contradiz, o Método Silva (uma leitura é hipótese, preço depois do valor)", () => {
  assert.match(maestria.MAESTRIA_HUMANA_PT, /hipótese/);
  assert.match(maestria.MAESTRIA_HUMANA_PT, /Preço só entra depois/);
  assert.match(maestria.MAESTRIA_HUMANA_EN, /Price only enters after/);
});
