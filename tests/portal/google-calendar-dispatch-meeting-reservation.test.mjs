import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { test } from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-google-calendar/dist/index.js")).href);
const dispatchModule = await import("../../apps/portal/src/lib/google-calendar/dispatch-meeting-reservation.ts");

const TENANT_ID = "019b0000-0000-7000-8000-000000000001";
const RESERVATION_ID = "019b0000-0000-7000-8000-000000000002";
const CALENDAR_ID = "closer-demo@group.calendar.google.com";
const GOOGLE_EVENT_ID = "019b00000000700080000000000000ab";
const START_AT = "2026-09-01T13:00:00.000Z";
const END_AT = "2026-09-01T13:30:00.000Z";
const TIMEZONE = "America/Sao_Paulo";

function uuidV7Like(n) {
  return `019b0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

function idSequence(startAt = 9000) {
  let n = startAt;
  return () => uuidV7Like((n += 1));
}

function baseInput(overrides = {}) {
  return { tenantId: TENANT_ID, reservationId: RESERVATION_ID, ...overrides };
}

function dispatchSnapshot(overrides = {}) {
  return Object.freeze({
    acquired: true, state: "provider_in_flight", reservationId: RESERVATION_ID,
    googleEventId: GOOGLE_EVENT_ID, googleCalendarId: CALENDAR_ID,
    startAt: START_AT, endAt: END_AT, timezone: TIMEZONE,
    contactName: "Ana Prospect", contactEmail: "ana@example.test",
    ...overrides,
  });
}

function fakeRpcClient(options = {}) {
  const dispatch = options.dispatch ?? dispatchSnapshot();
  const token = options.token ?? Object.freeze({ outcome: "found", refreshToken: "fake-refresh-token-value-not-a-real-secret" });
  const commit = options.commit ?? Object.freeze({ outcome: "succeeded", reservationId: RESERVATION_ID, state: "committed" });
  const throwFor = options.throwFor ?? {};
  const errorFor = options.errorFor ?? {};
  const calls = [];
  return {
    calls,
    client: {
      async rpc(name, parameters) {
        calls.push({ name, parameters });
        if (throwFor[name] === true) throw new Error(`transport failure for ${name}`);
        if (errorFor[name] !== undefined) return { data: null, error: { message: errorFor[name] } };
        if (name === "portal_dispatch_business_meeting_reservation_service") return { data: dispatch, error: null };
        if (name === "portal_google_calendar_decrypted_refresh_token_service") return { data: token, error: null };
        if (name === "portal_commit_business_meeting_reservation_service") return { data: commit, error: null };
        if (name === "portal_release_business_meeting_reservation_service") return { data: { outcome: "released" }, error: null };
        if (name === "portal_mark_business_meeting_reservation_unknown_service") return { data: true, error: null };
        throw new Error(`unexpected RPC ${name}`);
      },
    },
  };
}

function fakePort(overrides = {}) {
  return {
    async insertEvent(request) {
      if (overrides.insertThrows !== undefined) throw overrides.insertThrows;
      return overrides.insertResult ?? { id: request.eventId, status: "confirmed", htmlLink: `https://calendar.google.com/event?eid=${request.eventId}`, startIso: request.startIso, endIso: request.endIso };
    },
    async getEvent(calendarId, eventId) {
      if (overrides.getThrows !== undefined) throw overrides.getThrows;
      return overrides.getResult ?? { id: eventId, status: "confirmed", htmlLink: `https://calendar.google.com/event?eid=${eventId}`, startIso: START_AT, endIso: END_AT };
    },
  };
}

function withFakeProviders(run, fakeProviders) {
  const before = process.env.PORTAL_FAKE_PROVIDERS;
  process.env.PORTAL_FAKE_PROVIDERS = fakeProviders ? "1" : "0";
  return Promise.resolve().then(run).finally(() => {
    if (before === undefined) delete process.env.PORTAL_FAKE_PROVIDERS;
    else process.env.PORTAL_FAKE_PROVIDERS = before;
  });
}

// ---------------------------------------------------------------------------
// caminho feliz
// ---------------------------------------------------------------------------

test("despacha, insere o evento real e comita: reservationId/googleEventId/startAt/endAt/timezone corretos em cada chamada", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port: fakePort(), idGenerator: idSequence() });
  assert.equal(result.outcome, "committed");
  if (result.outcome !== "committed") return;
  assert.equal(result.reservationId, RESERVATION_ID);
  assert.equal(result.googleEventId, GOOGLE_EVENT_ID);
  assert.equal(result.startAt, START_AT);
  assert.equal(result.endAt, END_AT);
  assert.equal(result.timezone, TIMEZONE);

  const dispatchCall = calls.find((c) => c.name === "portal_dispatch_business_meeting_reservation_service");
  assert.equal(dispatchCall.parameters.p_tenant_id, TENANT_ID);
  assert.equal(dispatchCall.parameters.p_reservation_id, RESERVATION_ID);

  const commitCall = calls.find((c) => c.name === "portal_commit_business_meeting_reservation_service");
  assert.equal(commitCall.parameters.p_tenant_id, TENANT_ID);
  assert.equal(commitCall.parameters.p_reservation_id, RESERVATION_ID);
  assert.match(commitCall.parameters.p_google_event_html_link, /^https:\/\/calendar\.google\.com/);

  assert.equal(calls.some((c) => c.name === "portal_release_business_meeting_reservation_service"), false);
  assert.equal(calls.some((c) => c.name === "portal_mark_business_meeting_reservation_unknown_service"), false);
});

test("insertEvent recebe calendarId/eventId/summary/startIso/endIso/timeZone/attendeeEmails corretos a partir do snapshot do dispatch", async () => {
  const { client: rpc } = fakeRpcClient();
  let captured = null;
  const port = { ...fakePort(), async insertEvent(request) { captured = request; return { id: request.eventId, status: "confirmed", htmlLink: null, startIso: request.startIso, endIso: request.endIso }; } };
  await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
  assert.equal(captured.calendarId, CALENDAR_ID);
  assert.equal(captured.eventId, GOOGLE_EVENT_ID);
  assert.equal(captured.summary, "Reunião com Ana Prospect");
  assert.equal(captured.startIso, START_AT);
  assert.equal(captured.endIso, END_AT);
  assert.equal(captured.timeZone, TIMEZONE);
  assert.deepEqual(captured.attendeeEmails, ["ana@example.test"]);
});

test("sem contactName/contactEmail no snapshot: summary genérico, sem attendeeEmails", async () => {
  const { client: rpc } = fakeRpcClient({ dispatch: dispatchSnapshot({ contactName: null, contactEmail: null }) });
  let captured = null;
  const port = { ...fakePort(), async insertEvent(request) { captured = request; return { id: request.eventId, status: "confirmed", htmlLink: null, startIso: request.startIso, endIso: request.endIso }; } };
  await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
  assert.equal(captured.summary, "Reunião agendada");
  assert.equal(Object.hasOwn(captured, "attendeeEmails"), false);
});

test("htmlLink null (nenhum devolvido pelo provider) ainda comita normalmente", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), {
    rpc, port: fakePort({ insertResult: { id: GOOGLE_EVENT_ID, status: "confirmed", htmlLink: null, startIso: START_AT, endIso: END_AT } }),
  });
  assert.equal(result.outcome, "committed");
  const commitCall = calls.find((c) => c.name === "portal_commit_business_meeting_reservation_service");
  assert.equal(commitCall.parameters.p_google_event_html_link, null);
});

// ---------------------------------------------------------------------------
// fence de dispatch: acquired:false
// ---------------------------------------------------------------------------

test("acquired:false com state committed/completed é already_committed, nunca toca insertEvent", async () => {
  for (const state of ["committed", "completed"]) {
    const { client: rpc, calls } = fakeRpcClient({ dispatch: dispatchSnapshot({ acquired: false, state }) });
    const port = { async insertEvent() { throw new Error("must not be called"); }, async getEvent() { throw new Error("must not be called"); } };
    const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
    assert.deepEqual(result, { outcome: "already_committed" }, `state=${state}`);
    assert.equal(calls.length, 1, "só a chamada de dispatch, nada mais");
  }
});

test("acquired:false com state provider_in_flight é in_progress (genuinamente incerto), nunca afirma sucesso", async () => {
  const { client: rpc } = fakeRpcClient({ dispatch: dispatchSnapshot({ acquired: false, state: "provider_in_flight" }) });
  const port = { async insertEvent() { throw new Error("must not be called"); }, async getEvent() { throw new Error("must not be called"); } };
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
  assert.deepEqual(result, { outcome: "in_progress" });
});

test("acquired:false com qualquer outro state é not_dispatchable", async () => {
  for (const state of ["released", "unknown", "reserved"]) {
    const { client: rpc } = fakeRpcClient({ dispatch: dispatchSnapshot({ acquired: false, state }) });
    const port = { async insertEvent() { throw new Error("must not be called"); }, async getEvent() { throw new Error("must not be called"); } };
    const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
    assert.deepEqual(result, { outcome: "not_dispatchable" }, `state=${state}`);
  }
});

// ---------------------------------------------------------------------------
// not_connected: liberado com evidência declarada, nunca marcado unknown
// ---------------------------------------------------------------------------

test("credencial not_connected libera a reserva com calendar_disconnected_at_dispatch, nunca chama insertEvent nem mark_unknown", async () => {
  const { client: rpc, calls } = fakeRpcClient({ token: { outcome: "not_connected" } });
  const port = { async insertEvent() { throw new Error("must not be called"); }, async getEvent() { throw new Error("must not be called"); } };
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port, idGenerator: idSequence() });
  assert.deepEqual(result, { outcome: "not_connected" });
  const releaseCall = calls.find((c) => c.name === "portal_release_business_meeting_reservation_service");
  assert.ok(releaseCall);
  assert.equal(releaseCall.parameters.p_tenant_id, TENANT_ID);
  assert.equal(releaseCall.parameters.p_reservation_id, RESERVATION_ID);
  assert.equal(releaseCall.parameters.p_evidence, "calendar_disconnected_at_dispatch");
  assert.equal(calls.some((c) => c.name === "portal_mark_business_meeting_reservation_unknown_service"), false);
});

test("token RPC devolve refreshToken ausente mesmo com outcome=found: service_unavailable, nunca lança", async () => {
  const { client: rpc } = fakeRpcClient({ token: { outcome: "found" } });
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port: fakePort() });
  assert.deepEqual(result, { outcome: "service_unavailable" });
});

// ---------------------------------------------------------------------------
// event_id_conflict: recuperação idempotente via getEvent
// ---------------------------------------------------------------------------

test("event_id_conflict recupera via getEvent e comita normalmente (o evento já existia de verdade)", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  const port = fakePort({
    insertThrows: new provider.GoogleCalendarProviderError("event_id_conflict", "already exists", 409),
    getResult: { id: GOOGLE_EVENT_ID, status: "confirmed", htmlLink: "https://calendar.google.com/event?eid=recovered", startIso: START_AT, endIso: END_AT },
  });
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
  assert.equal(result.outcome, "committed");
  const commitCall = calls.find((c) => c.name === "portal_commit_business_meeting_reservation_service");
  assert.equal(commitCall.parameters.p_google_event_html_link, "https://calendar.google.com/event?eid=recovered");
  assert.equal(calls.some((c) => c.name === "portal_mark_business_meeting_reservation_unknown_service"), false);
});

test("event_id_conflict cuja recuperação por getEvent também falha vira ambiguous e marca unknown", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  const port = fakePort({
    insertThrows: new provider.GoogleCalendarProviderError("event_id_conflict", "already exists", 409),
    getThrows: new provider.GoogleCalendarProviderError("event_not_found", "not found", 404),
  });
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
  assert.equal(result.outcome, "ambiguous");
  const markUnknownCall = calls.find((c) => c.name === "portal_mark_business_meeting_reservation_unknown_service");
  assert.ok(markUnknownCall);
  assert.equal(markUnknownCall.parameters.p_tenant_id, TENANT_ID);
  assert.equal(markUnknownCall.parameters.p_reservation_id, RESERVATION_ID);
  assert.equal(calls.some((c) => c.name === "portal_commit_business_meeting_reservation_service"), false);
});

// ---------------------------------------------------------------------------
// qualquer outra falha de insertEvent: ambígua, marca unknown
// ---------------------------------------------------------------------------

test("qualquer falha declarada de insertEvent que não seja event_id_conflict marca unknown, nunca release", async () => {
  for (const code of ["provider_timeout", "provider_unavailable", "malformed_provider_response", "provider_rejected", "reauth_required", "invalid_request", "missing_credentials", "missing_refresh_token"]) {
    const { client: rpc, calls } = fakeRpcClient();
    const port = fakePort({ insertThrows: new provider.GoogleCalendarProviderError(code, `simulated ${code}`) });
    const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
    assert.equal(result.outcome, "ambiguous", `code=${code}`);
    assert.equal(calls.some((c) => c.name === "portal_mark_business_meeting_reservation_unknown_service"), true, `code=${code}`);
    assert.equal(calls.some((c) => c.name === "portal_release_business_meeting_reservation_service"), false, `code=${code}`);
  }
});

test("um erro não tipado (não GoogleCalendarProviderError) de insertEvent também marca unknown, nunca propaga", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  const port = fakePort({ insertThrows: new TypeError("boom") });
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
  assert.equal(result.outcome, "ambiguous");
  assert.equal(calls.some((c) => c.name === "portal_mark_business_meeting_reservation_unknown_service"), true);
});

// ---------------------------------------------------------------------------
// commit falha depois de um insertEvent bem-sucedido: marca unknown, nunca perde o evento
// ---------------------------------------------------------------------------

test("commit RPC devolvendo erro de transporte marca unknown -- o evento já existe na Google, só a gravação local falhou", async () => {
  const { client: rpc, calls } = fakeRpcClient({ errorFor: { portal_commit_business_meeting_reservation_service: "db down" } });
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port: fakePort() });
  assert.equal(result.outcome, "ambiguous");
  assert.equal(calls.some((c) => c.name === "portal_mark_business_meeting_reservation_unknown_service"), true);
});

test("commit RPC devolvendo outcome inesperado (não 'succeeded') marca unknown, nunca afirma sucesso", async () => {
  const { client: rpc, calls } = fakeRpcClient({ commit: { outcome: "weird" } });
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port: fakePort() });
  assert.equal(result.outcome, "ambiguous");
  assert.equal(calls.some((c) => c.name === "portal_mark_business_meeting_reservation_unknown_service"), true);
});

// ---------------------------------------------------------------------------
// falha de transporte em qualquer RPC
// ---------------------------------------------------------------------------

test("falha de transporte na RPC de dispatch vira service_unavailable, sem tocar o provider", async () => {
  const { client: rpc } = fakeRpcClient({ throwFor: { portal_dispatch_business_meeting_reservation_service: true } });
  const port = { async insertEvent() { throw new Error("must not be called"); }, async getEvent() { throw new Error("must not be called"); } };
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
  assert.deepEqual(result, { outcome: "service_unavailable" });
});

test("dispatch RPC devolve snapshot malformado (campo obrigatório ausente) vira service_unavailable antes de tocar credencial/provider", async () => {
  const incomplete = { ...dispatchSnapshot() };
  delete incomplete.startAt;
  const { client: rpc, calls } = fakeRpcClient({ dispatch: incomplete });
  const port = { async insertEvent() { throw new Error("must not be called"); }, async getEvent() { throw new Error("must not be called"); } };
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
  assert.deepEqual(result, { outcome: "service_unavailable" });
  assert.equal(calls.some((c) => c.name === "portal_google_calendar_decrypted_refresh_token_service"), false);
});

// ---------------------------------------------------------------------------
// validação de input (antes de qualquer chamada de rede)
// ---------------------------------------------------------------------------

test("rejeita tenantId/reservationId que não são UUIDv7 antes de qualquer RPC", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  for (const field of ["tenantId", "reservationId"]) {
    await assert.rejects(
      () => dispatchModule.dispatchMeetingReservation(baseInput({ [field]: "not-a-uuid" }), { rpc, port: fakePort() }),
      dispatchModule.DispatchMeetingReservationInputError,
    );
  }
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// seleção real/fake por PORTAL_FAKE_PROVIDERS
// ---------------------------------------------------------------------------

test("modo fake (PORTAL_FAKE_PROVIDERS=1) usa o port fake determinístico sem nenhuma chamada de rede real, mesmo sem dependencies.port", async () => {
  await withFakeProviders(async () => {
    const { client: rpc } = fakeRpcClient();
    const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc });
    assert.equal(result.outcome, "committed");
  }, true);
});

test("modo real sem GOOGLE_OAUTH_CLIENT_ID/SECRET configurados marca unknown (missing_credentials), nunca lança", async () => {
  const before = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  try {
    await withFakeProviders(async () => {
      const { client: rpc, calls } = fakeRpcClient();
      const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc });
      assert.equal(result.outcome, "ambiguous");
      assert.equal(calls.some((c) => c.name === "portal_mark_business_meeting_reservation_unknown_service"), true);
    }, false);
  } finally {
    if (before.id === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID; else process.env.GOOGLE_OAUTH_CLIENT_ID = before.id;
    if (before.secret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET; else process.env.GOOGLE_OAUTH_CLIENT_SECRET = before.secret;
  }
});

// ---------------------------------------------------------------------------
// o refresh token nunca aparece em nenhum resultado devolvido
// ---------------------------------------------------------------------------

test("o refresh token decifrado nunca aparece em nenhum outcome devolvido, mesmo em erro", async () => {
  const secretToken = "super-secret-refresh-token-do-not-leak-nkq82hf";
  const { client: rpc } = fakeRpcClient({ token: { outcome: "found", refreshToken: secretToken } });
  const port = fakePort({ insertThrows: new provider.GoogleCalendarProviderError("provider_rejected", `rejected (${secretToken} would be a bug)`) });
  const result = await dispatchModule.dispatchMeetingReservation(baseInput(), { rpc, port });
  assert.equal(JSON.stringify(result).includes(secretToken), false);
});
