import assert from "node:assert/strict";
import { test } from "node:test";

const formatDate = await import("../../apps/portal/src/lib/format-date.ts");

const SAMPLE_ISO = "2026-08-12T15:30:00.000Z";

test("formatDateTime formata no fuso pedido", () => {
  const inSaoPaulo = formatDate.formatDateTime(SAMPLE_ISO, "America/Sao_Paulo");
  const inTokyo = formatDate.formatDateTime(SAMPLE_ISO, "Asia/Tokyo");
  assert.notEqual(inSaoPaulo, inTokyo, "fusos diferentes deveriam produzir horários diferentes");
});

test("achado da auto-revisão D-V2-115: formatDateTime nunca lança pra timeZone IANA inválido — cai pro fallback em vez de derrubar a página", () => {
  assert.doesNotThrow(() => formatDate.formatDateTime(SAMPLE_ISO, "Nao/Existe"));
  assert.doesNotThrow(() => formatDate.formatDateTime(SAMPLE_ISO, ""));
  assert.doesNotThrow(() => formatDate.formatDateTime(SAMPLE_ISO, "lixo-completo"));
  const result = formatDate.formatDateTime(SAMPLE_ISO, "Nao/Existe");
  assert.equal(typeof result, "string");
  assert.ok(result.length > 0);
});

test("formatLongDate formata no fuso pedido", () => {
  const result = formatDate.formatLongDate(SAMPLE_ISO, "America/Sao_Paulo");
  assert.match(result, /2026/);
});

test("achado da auto-revisão D-V2-115: formatLongDate nunca lança pra timeZone IANA inválido — cai pro fallback em vez de derrubar a página", () => {
  assert.doesNotThrow(() => formatDate.formatLongDate(SAMPLE_ISO, "Nao/Existe"));
  const result = formatDate.formatLongDate(SAMPLE_ISO, "Nao/Existe");
  assert.match(result, /2026/);
});
