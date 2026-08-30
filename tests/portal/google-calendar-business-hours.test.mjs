import assert from "node:assert/strict";
import { test } from "node:test";

// Módulo puro, sem imports externos (só time/florida.ts) -- node nativo executa direto do fonte.
const businessHours = await import("../../apps/portal/src/lib/google-calendar/business-hours.ts");

// America/Sao_Paulo é UTC-3 o ano todo (Brasil aboliu o horário de verão em
// 2019) -- escolhida de propósito pra estes testes de janela multi-dia
// poderem fazer aritmética simples (offset fixo), sem misturar com o já
// coberto por `brain-florida-time.test.mjs` (que testa DST em profundidade).
const TZ = "America/Sao_Paulo";
const OFFSET_MS = 3 * 60 * 60 * 1_000; // local + OFFSET_MS = UTC

function clockAt(isoUtc) {
  return { now: () => Date.parse(isoUtc) };
}

function localWindow(dateIso, startHour, endHour) {
  const dayStartUtc = Date.parse(`${dateIso}T00:00:00.000Z`) + OFFSET_MS;
  return {
    startAtMs: dayStartUtc + startHour * 60 * 60 * 1_000,
    endAtMs: dayStartUtc + endHour * 60 * 60 * 1_000,
  };
}

test("dentro do expediente: o restante de hoje é o primeiro dia, começando exatamente em 'agora'", () => {
  // 2026-08-05 é quarta-feira. 17:00Z = 14:00 local.
  const nowIso = "2026-08-05T17:00:00.000Z";
  const windows = businessHours.computeBusinessDayWindows(TZ, { businessDaysCount: 3, clock: clockAt(nowIso) });
  assert.equal(windows.length, 3);
  assert.equal(windows[0].startAtMs, Date.parse(nowIso));
  assert.equal(windows[0].endAtMs, localWindow("2026-08-05", 9, 18).endAtMs);
  assert.deepEqual(windows[1], localWindow("2026-08-06", 9, 18)); // quinta
  assert.deepEqual(windows[2], localWindow("2026-08-07", 9, 18)); // sexta
});

test("depois do expediente: começa no próximo dia útil, com a janela cheia", () => {
  // 19:00 local (já passou das 18:00).
  const nowIso = "2026-08-05T22:00:00.000Z";
  const windows = businessHours.computeBusinessDayWindows(TZ, { businessDaysCount: 3, clock: clockAt(nowIso) });
  assert.equal(windows.length, 3);
  assert.deepEqual(windows[0], localWindow("2026-08-06", 9, 18)); // quinta (hoje é pulado)
  assert.deepEqual(windows[1], localWindow("2026-08-07", 9, 18)); // sexta
  assert.deepEqual(windows[2], localWindow("2026-08-10", 9, 18)); // segunda -- pula sáb 08 e dom 09
});

test("fim de semana: começa na próxima segunda, com a janela cheia", () => {
  // 2026-08-08 é sábado, 12:00 local.
  const nowIso = "2026-08-08T15:00:00.000Z";
  const windows = businessHours.computeBusinessDayWindows(TZ, { businessDaysCount: 3, clock: clockAt(nowIso) });
  assert.deepEqual(windows[0], localWindow("2026-08-10", 9, 18)); // segunda
  assert.deepEqual(windows[1], localWindow("2026-08-11", 9, 18)); // terça
  assert.deepEqual(windows[2], localWindow("2026-08-12", 9, 18)); // quarta
});

test("antes do expediente num dia útil: o dia inteiro (ainda não começado) conta como o primeiro dia cheio", () => {
  // 06:00 local, quarta-feira -- ainda não são 09:00.
  const nowIso = "2026-08-05T09:00:00.000Z";
  const windows = businessHours.computeBusinessDayWindows(TZ, { businessDaysCount: 2, clock: clockAt(nowIso) });
  assert.deepEqual(windows[0], localWindow("2026-08-05", 9, 18)); // hoje, janela cheia (não começa em "agora")
  assert.deepEqual(windows[1], localWindow("2026-08-06", 9, 18));
});

test("exatamente às 18:00 local já conta como expediente encerrado (limite inclusivo no fim)", () => {
  const nowIso = "2026-08-05T21:00:00.000Z"; // 18:00:00.000 local exato
  const windows = businessHours.computeBusinessDayWindows(TZ, { businessDaysCount: 1, clock: clockAt(nowIso) });
  assert.deepEqual(windows[0], localWindow("2026-08-06", 9, 18));
});

test("exatamente às 09:00 local já conta como dentro do expediente (limite inclusivo no início)", () => {
  const nowIso = "2026-08-05T12:00:00.000Z"; // 09:00:00.000 local exato
  const windows = businessHours.computeBusinessDayWindows(TZ, { businessDaysCount: 1, clock: clockAt(nowIso) });
  assert.equal(windows[0].startAtMs, Date.parse(nowIso));
  assert.equal(windows[0].endAtMs, localWindow("2026-08-05", 9, 18).endAtMs);
});

test("respeita businessStartHour/businessEndHour customizados", () => {
  const nowIso = "2026-08-05T09:00:00.000Z"; // 06:00 local, antes de qualquer expediente customizado
  const windows = businessHours.computeBusinessDayWindows(TZ, {
    businessDaysCount: 1, businessStartHour: 8, businessEndHour: 17, clock: clockAt(nowIso),
  });
  assert.deepEqual(windows[0], localWindow("2026-08-05", 8, 17));
});

test("default é 5 dias úteis, 09:00-18:00", () => {
  const nowIso = "2026-08-05T12:00:00.000Z"; // 09:00 local, quarta
  const windows = businessHours.computeBusinessDayWindows(TZ, { clock: clockAt(nowIso) });
  assert.equal(windows.length, 5);
  assert.deepEqual(windows[4], localWindow("2026-08-11", 9, 18)); // qua, qui, sex, (pula fds), seg, ter
});

test("businessDaysCount/businessStartHour/businessEndHour inválidos lançam RangeError, nunca um loop silencioso", () => {
  const clock = clockAt("2026-08-05T12:00:00.000Z");
  assert.throws(() => businessHours.computeBusinessDayWindows(TZ, { businessDaysCount: 0, clock }), RangeError);
  assert.throws(() => businessHours.computeBusinessDayWindows(TZ, { businessDaysCount: 31, clock }), RangeError);
  assert.throws(() => businessHours.computeBusinessDayWindows(TZ, { businessStartHour: 18, businessEndHour: 9, clock }), RangeError);
  assert.throws(() => businessHours.computeBusinessDayWindows(TZ, { businessStartHour: -1, clock }), RangeError);
  assert.throws(() => businessHours.computeBusinessDayWindows(TZ, { businessEndHour: 24, clock }), RangeError);
});

test("propaga o erro tipado de fuso desconhecido (delegado a wallClockPartsAt/wallClockToUtcIso)", async () => {
  const florida = await import("../../apps/portal/src/lib/time/florida.ts");
  assert.throws(
    () => businessHours.computeBusinessDayWindows("Nao/Existe", { clock: clockAt("2026-08-05T12:00:00.000Z") }),
    florida.FloridaTimeError,
  );
});
