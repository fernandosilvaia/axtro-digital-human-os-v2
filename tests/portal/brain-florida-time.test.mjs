import assert from "node:assert/strict";
import { test } from "node:test";

// Módulo puro, sem imports — mesmo padrão de metodo-silva.ts (node nativo executa direto do fonte).
const florida = await import("../../apps/portal/src/lib/time/florida.ts");

test("converte horário de verão (EDT, UTC-4) corretamente", () => {
  // 1 de agosto é EDT no leste dos EUA (horário de verão).
  assert.equal(florida.floridaWallClockToUtcIso("2026-08-01T14:00:00"), "2026-08-01T18:00:00.000Z");
});

test("converte horário padrão (EST, UTC-5) corretamente", () => {
  // 15 de janeiro é EST (sem horário de verão).
  assert.equal(florida.floridaWallClockToUtcIso("2026-01-15T14:00:00"), "2026-01-15T19:00:00.000Z");
});

test("aceita datetime sem segundos", () => {
  assert.equal(florida.floridaWallClockToUtcIso("2026-08-01T14:00"), "2026-08-01T18:00:00.000Z");
});

test("meia-noite e meio-dia convertem certo nas duas estações", () => {
  assert.equal(florida.floridaWallClockToUtcIso("2026-08-01T00:00:00"), "2026-08-01T04:00:00.000Z");
  assert.equal(florida.floridaWallClockToUtcIso("2026-01-01T12:00:00"), "2026-01-01T17:00:00.000Z");
});

test("rejeita entrada com fuso já embutido ou formato inválido", () => {
  for (const bad of ["2026-08-01T14:00:00Z", "2026-08-01T14:00:00-04:00", "not-a-date", "2026-08-01", "14:00:00"]) {
    assert.throws(() => florida.floridaWallClockToUtcIso(bad), florida.FloridaTimeError);
  }
});

test("a transição de horário de verão de 2026 (8 de março) muda o offset no dia certo", () => {
  // DST 2026 nos EUA começa em 8 de março (segundo domingo). Antes: EST (UTC-5). Depois: EDT (UTC-4).
  assert.equal(florida.floridaWallClockToUtcIso("2026-03-07T10:00:00"), "2026-03-07T15:00:00.000Z");
  assert.equal(florida.floridaWallClockToUtcIso("2026-03-09T10:00:00"), "2026-03-09T14:00:00.000Z");
});

test("madrugada logo APÓS o spring-forward não erra 1 hora (bug da iteração única, auditoria 2026-08-02)", () => {
  // 08/03/2026 03:30 já é EDT (o pulo 02:00→03:00 aconteceu). O chute lido
  // como UTC (03:30Z) ainda avalia EST e devolvia 08:30Z — 1h atrasado.
  assert.equal(florida.floridaWallClockToUtcIso("2026-03-08T03:30:00"), "2026-03-08T07:30:00.000Z");
  // Horas seguintes do mesmo dia também já são EDT.
  assert.equal(florida.floridaWallClockToUtcIso("2026-03-08T05:00:00"), "2026-03-08T09:00:00.000Z");
});

test("madrugada do fall-back de 2026 (1º de novembro) resolve sem erro de 1 hora", () => {
  // DST 2026 termina em 1º de novembro. 03:00 local já é EST inequívoco → 08:00Z.
  assert.equal(florida.floridaWallClockToUtcIso("2026-11-01T03:00:00"), "2026-11-01T08:00:00.000Z");
  // 10:00 do mesmo dia, bem depois da transição, idem.
  assert.equal(florida.floridaWallClockToUtcIso("2026-11-01T10:00:00"), "2026-11-01T15:00:00.000Z");
});

test("wallClockToUtcIso genérico converte no fuso do tenant (multi-tenant, W4)", () => {
  // São Paulo é UTC-3 o ano todo (Brasil aboliu o horário de verão em 2019).
  assert.equal(florida.wallClockToUtcIso("2026-08-05T15:00:00", "America/Sao_Paulo"), "2026-08-05T18:00:00.000Z");
  // Lisboa em agosto é WEST (UTC+1).
  assert.equal(florida.wallClockToUtcIso("2026-08-05T15:00:00", "Europe/Lisbon"), "2026-08-05T14:00:00.000Z");
  // O atalho da Flórida continua batendo com o genérico.
  assert.equal(
    florida.wallClockToUtcIso("2026-08-01T14:00:00", "America/New_York"),
    florida.floridaWallClockToUtcIso("2026-08-01T14:00:00"),
  );
});

test("fuso IANA desconhecido é rejeitado com erro tipado, nunca conversão silenciosa", () => {
  assert.throws(() => florida.wallClockToUtcIso("2026-08-05T15:00:00", "America/Nao_Existe"), florida.FloridaTimeError);
  assert.throws(() => florida.wallClockToUtcIso("2026-08-05T15:00:00", ""), florida.FloridaTimeError);
});
