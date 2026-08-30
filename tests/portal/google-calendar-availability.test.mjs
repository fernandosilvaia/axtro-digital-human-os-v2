import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { test } from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-google-calendar/dist/index.js")).href);
const availability = await import("../../apps/portal/src/lib/google-calendar/availability.ts");

const TZ = "America/Sao_Paulo"; // UTC-3 o ano todo -- aritmética simples, mesma escolha de google-calendar-business-hours.test.mjs.
const CALENDAR_ID = "closer-demo@group.calendar.google.com";

function clockAt(isoUtc) {
  return { now: () => Date.parse(isoUtc) };
}

function idSequence(prefix) {
  let index = 0;
  return () => `${prefix}-${(index += 1)}`;
}

test("gera até maxSlots candidatos dentro do horário comercial, sem conflito, no shape esperado pela RPC (+timezone)", async () => {
  const port = provider.createFakeGoogleCalendarPort();
  const nowIso = "2026-08-05T12:00:00.000Z"; // 09:00 local exato, quarta-feira
  const slots = await availability.computeGoogleCalendarAvailableSlots(port, {
    durationMinutes: 30,
    timezone: TZ,
    calendarId: CALENDAR_ID,
    maxSlots: 4,
    businessDaysCount: 1,
    clock: clockAt(nowIso),
    idGenerator: idSequence("slot"),
  });
  assert.equal(slots.length, 4);
  assert.deepEqual(slots[0], { id: "slot-1", startAt: "2026-08-05T12:00:00.000Z", endAt: "2026-08-05T12:30:00.000Z", timezone: TZ });
  assert.deepEqual(slots[1], { id: "slot-2", startAt: "2026-08-05T12:30:00.000Z", endAt: "2026-08-05T13:00:00.000Z", timezone: TZ });
  assert.deepEqual(slots[3], { id: "slot-4", startAt: "2026-08-05T13:30:00.000Z", endAt: "2026-08-05T14:00:00.000Z", timezone: TZ });
});

test("uma única chamada a queryFreeBusy cobre a janela inteira (não uma por dia)", async () => {
  const calls = [];
  const port = {
    async queryFreeBusy(request) {
      calls.push(request);
      return { calendarId: request.calendarId, busy: [] };
    },
  };
  await availability.computeGoogleCalendarAvailableSlots(port, {
    durationMinutes: 30,
    timezone: TZ,
    calendarId: CALENDAR_ID,
    businessDaysCount: 3,
    clock: clockAt("2026-08-05T12:00:00.000Z"),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].calendarId, CALENDAR_ID);
  assert.equal(calls[0].timeMinIso, "2026-08-05T12:00:00.000Z");
  assert.equal(calls[0].timeMaxIso, "2026-08-07T21:00:00.000Z"); // fim do 3º dia útil (sexta 18:00 local)
});

test("exclui candidatos que colidem com busy intervals devolvidos pelo provider (fundindo intervalos sobrepostos)", async () => {
  const port = {
    async queryFreeBusy() {
      return {
        calendarId: CALENDAR_ID,
        busy: [
          // Dois intervalos sobrepostos que fundem num só, 12:00-13:00Z --
          // cada um sozinho deixaria um buraco livre que o outro cobre;
          // só a fusão bloqueia os dois primeiros slots de 30min da grade.
          { startIso: "2026-08-05T12:00:00.000Z", endIso: "2026-08-05T12:45:00.000Z" },
          { startIso: "2026-08-05T12:30:00.000Z", endIso: "2026-08-05T13:00:00.000Z" },
        ],
      };
    },
  };
  const slots = await availability.computeGoogleCalendarAvailableSlots(port, {
    durationMinutes: 30,
    timezone: TZ,
    calendarId: CALENDAR_ID,
    businessDaysCount: 1,
    clock: clockAt("2026-08-05T12:00:00.000Z"),
  });
  // A grade de slots de 30min começa em "agora" (12:00Z): 12:00-12:30 e
  // 12:30-13:00 colidem com o intervalo fundido; 13:00-13:30 é o primeiro livre.
  assert.equal(slots[0].startAt, "2026-08-05T13:00:00.000Z");
  assert.equal(slots.every((slot) => Date.parse(slot.startAt) >= Date.parse("2026-08-05T13:00:00.000Z")), true);
});

test("calendário lotado o dia inteiro devolve zero slots (não é erro)", async () => {
  const port = {
    async queryFreeBusy() {
      return { calendarId: CALENDAR_ID, busy: [{ startIso: "2026-08-05T00:00:00.000Z", endIso: "2026-08-06T00:00:00.000Z" }] };
    },
  };
  const slots = await availability.computeGoogleCalendarAvailableSlots(port, {
    durationMinutes: 30,
    timezone: TZ,
    calendarId: CALENDAR_ID,
    businessDaysCount: 1,
    clock: clockAt("2026-08-05T12:00:00.000Z"),
  });
  assert.deepEqual(slots, []);
});

test("propaga GoogleCalendarProviderError de queryFreeBusy sem tratar (o chamador decide o outcome)", async () => {
  const port = {
    async queryFreeBusy() {
      throw new provider.GoogleCalendarProviderError("reauth_required", "invalid refresh token");
    },
  };
  await assert.rejects(
    () => availability.computeGoogleCalendarAvailableSlots(port, {
      durationMinutes: 30, timezone: TZ, calendarId: CALENDAR_ID, clock: clockAt("2026-08-05T12:00:00.000Z"),
    }),
    (error) => error.code === "reauth_required",
  );
});

test("valida durationMinutes/calendarId/maxSlots antes de qualquer chamada de rede", async () => {
  const calls = [];
  const port = { async queryFreeBusy(request) { calls.push(request); return { calendarId: request.calendarId, busy: [] }; } };
  const base = { timezone: TZ, calendarId: CALENDAR_ID, clock: clockAt("2026-08-05T12:00:00.000Z") };

  await assert.rejects(
    () => availability.computeGoogleCalendarAvailableSlots(port, { ...base, durationMinutes: 20 }),
    availability.GoogleCalendarAvailabilityInputError,
  );
  await assert.rejects(
    () => availability.computeGoogleCalendarAvailableSlots(port, { ...base, durationMinutes: 30, calendarId: "" }),
    availability.GoogleCalendarAvailabilityInputError,
  );
  await assert.rejects(
    () => availability.computeGoogleCalendarAvailableSlots(port, { ...base, durationMinutes: 30, maxSlots: 51 }),
    availability.GoogleCalendarAvailabilityInputError,
  );
  await assert.rejects(
    () => availability.computeGoogleCalendarAvailableSlots(port, { ...base, durationMinutes: 30, maxSlots: 0 }),
    availability.GoogleCalendarAvailabilityInputError,
  );
  assert.equal(calls.length, 0);
});

test("default maxSlots é 10, bem abaixo do teto de 50 que a RPC aceita", async () => {
  const port = provider.createFakeGoogleCalendarPort();
  const slots = await availability.computeGoogleCalendarAvailableSlots(port, {
    durationMinutes: 15, timezone: TZ, calendarId: CALENDAR_ID, businessDaysCount: 5,
    clock: clockAt("2026-08-05T12:00:00.000Z"),
  });
  assert.equal(availability.DEFAULT_MAX_PROPOSED_SLOTS, 10);
  assert.equal(slots.length, 10);
});

test("cada id de slot é único (idGenerator real por padrão)", async () => {
  const port = provider.createFakeGoogleCalendarPort();
  const slots = await availability.computeGoogleCalendarAvailableSlots(port, {
    durationMinutes: 60, timezone: TZ, calendarId: CALENDAR_ID, maxSlots: 5, businessDaysCount: 5,
    clock: clockAt("2026-08-05T12:00:00.000Z"),
  });
  const ids = new Set(slots.map((slot) => slot.id));
  assert.equal(ids.size, slots.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
