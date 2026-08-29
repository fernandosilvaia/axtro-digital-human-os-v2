import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { test } from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-google-calendar/dist/index.js")).href);
const proposeModule = await import("../../apps/portal/src/lib/google-calendar/propose-meeting-slots.ts");

const TZ = "America/Sao_Paulo";
const CALENDAR_ID = "closer-demo@group.calendar.google.com";

const TENANT_ID = "019b0000-0000-7000-8000-000000000001";
const AGENT_ID = "019b0000-0000-7000-8000-000000000002";
const SESSION_ID = "019b0000-0000-7000-8000-000000000003";
const PRESENTER_ID = "019b0000-0000-7000-8000-000000000004";
const GRANT_ID = "019b0000-0000-7000-8000-000000000005";

function uuidV7Like(n) {
  return `019b0000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

function idSequence(startAt = 100) {
  let n = startAt;
  return () => uuidV7Like((n += 1));
}

function clockAt(isoUtc) {
  return { now: () => Date.parse(isoUtc) };
}

function baseInput(overrides = {}) {
  return {
    tenantId: TENANT_ID, agentId: AGENT_ID, sessionId: SESSION_ID, presenterId: PRESENTER_ID, grantId: GRANT_ID,
    durationMinutes: 30, contactName: "Ana Prospect", contactEmail: "ana@example.test",
    ...overrides,
  };
}

function fakeRpcClient(options = {}) {
  const connection = options.connection ?? Object.freeze({
    outcome: "found", calendarId: CALENDAR_ID, defaultTimezone: TZ, status: "connected", googleAccountEmail: "demo@example.test",
  });
  const token = options.token ?? Object.freeze({ outcome: "found", refreshToken: "fake-refresh-token-value-not-a-real-secret" });
  const proposeOverride = options.propose ?? null;
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
        if (name === "portal_google_calendar_connection_context_service") return { data: connection, error: null };
        if (name === "portal_google_calendar_decrypted_refresh_token_service") return { data: token, error: null };
        if (name === "portal_propose_business_meeting_slots_service") {
          return {
            data: proposeOverride ?? { outcome: "succeeded", proposalId: parameters.p_proposal_id, receiptId: parameters.p_receipt_id },
            error: null,
          };
        }
        throw new Error(`unexpected RPC ${name}`);
      },
    },
  };
}

function fakePort(overrides = {}) {
  return {
    async queryFreeBusy(request) {
      if (overrides.throws !== undefined) throw overrides.throws;
      return { calendarId: request.calendarId, busy: overrides.busy ?? [] };
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

test("propõe slots ponta a ponta e persiste pela RPC (id/proposalId gerados quando ausentes)", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), {
    rpc, port: fakePort(), idGenerator: idSequence(), clock: clockAt("2026-08-05T12:00:00.000Z"),
    businessDaysCount: 1, maxSlots: 3,
  });
  assert.equal(result.outcome, "succeeded");
  if (result.outcome !== "succeeded") return;
  assert.equal(result.slots.length, 3);

  const proposeCall = calls.find((call) => call.name === "portal_propose_business_meeting_slots_service");
  assert.equal(proposeCall.parameters.p_tenant_id, TENANT_ID);
  assert.equal(proposeCall.parameters.p_agent_id, AGENT_ID);
  assert.equal(proposeCall.parameters.p_session_id, SESSION_ID);
  assert.equal(proposeCall.parameters.p_presenter_id, PRESENTER_ID);
  assert.equal(proposeCall.parameters.p_grant_id, GRANT_ID);
  assert.equal(proposeCall.parameters.p_duration_minutes, 30);
  assert.equal(proposeCall.parameters.p_timezone, TZ);
  assert.equal(proposeCall.parameters.p_contact_name, "Ana Prospect");
  assert.equal(proposeCall.parameters.p_contact_email, "ana@example.test");
  assert.equal(proposeCall.parameters.p_slots.length, 3);
  // Exatamente 3 chaves por slot (id/startAt/endAt) -- a RPC rejeitaria qualquer outra contagem.
  for (const slot of proposeCall.parameters.p_slots) {
    assert.deepEqual(Object.keys(slot).sort(), ["endAt", "id", "startAt"]);
  }
  assert.equal(proposeCall.parameters.p_receipt_id, result.receiptId);
  assert.equal(proposeCall.parameters.p_proposal_id, result.proposalId);

  const connectionCall = calls.find((call) => call.name === "portal_google_calendar_connection_context_service");
  assert.equal(connectionCall.parameters.p_tenant_id, TENANT_ID);
  const tokenCall = calls.find((call) => call.name === "portal_google_calendar_decrypted_refresh_token_service");
  assert.equal(tokenCall.parameters.p_tenant_id, TENANT_ID);
});

test("usa receiptId/proposalId fornecidos pelo chamador em vez de gerar novos (idempotência)", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  const receiptId = uuidV7Like(9001);
  const proposalId = uuidV7Like(9002);
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(
    baseInput({ receiptId, proposalId }),
    { rpc, port: fakePort(), clock: clockAt("2026-08-05T12:00:00.000Z"), businessDaysCount: 1, maxSlots: 1 },
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.receiptId, receiptId);
  assert.equal(result.proposalId, proposalId);
  const proposeCall = calls.find((call) => call.name === "portal_propose_business_meeting_slots_service");
  assert.equal(proposeCall.parameters.p_receipt_id, receiptId);
  assert.equal(proposeCall.parameters.p_proposal_id, proposalId);
});

// ---------------------------------------------------------------------------
// not_connected (duas origens: contexto e credencial decifrada)
// ---------------------------------------------------------------------------

test("devolve not_connected sem tocar credencial nem propose quando o contexto da conexão diz not_connected", async () => {
  const { client: rpc, calls } = fakeRpcClient({ connection: { outcome: "not_connected" } });
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), { rpc, port: fakePort() });
  assert.deepEqual(result, { outcome: "not_connected" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "portal_google_calendar_connection_context_service");
});

test("devolve not_connected sem chamar propose quando a credencial decifrada diz not_connected (corrida rara/reauth_required/revoked)", async () => {
  const { client: rpc, calls } = fakeRpcClient({ token: { outcome: "not_connected" } });
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), { rpc, port: fakePort() });
  assert.deepEqual(result, { outcome: "not_connected" });
  assert.equal(calls.some((call) => call.name === "portal_propose_business_meeting_slots_service"), false);
  assert.equal(calls.filter((call) => call.name === "portal_google_calendar_decrypted_refresh_token_service").length, 1);
});

// ---------------------------------------------------------------------------
// disponibilidade
// ---------------------------------------------------------------------------

test("calendário lotado o período inteiro vira no_availability antes de chamar a RPC de propose", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  const port = fakePort({ busy: [{ startIso: "2026-08-05T00:00:00.000Z", endIso: "2026-08-06T00:00:00.000Z" }] });
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), {
    rpc, port, clock: clockAt("2026-08-05T12:00:00.000Z"), businessDaysCount: 1,
  });
  assert.deepEqual(result, { outcome: "no_availability" });
  assert.equal(calls.some((call) => call.name === "portal_propose_business_meeting_slots_service"), false);
});

// ---------------------------------------------------------------------------
// erros do provider
// ---------------------------------------------------------------------------

test("reauth_required do provider vira outcome próprio, nunca escreve nada na conexão", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  const port = { async queryFreeBusy() { throw new provider.GoogleCalendarProviderError("reauth_required", "invalid refresh token"); } };
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), { rpc, port, clock: clockAt("2026-08-05T12:00:00.000Z") });
  assert.deepEqual(result, { outcome: "reauth_required" });
  assert.equal(calls.some((call) => call.name === "portal_propose_business_meeting_slots_service"), false);
});

test("defaultTimezone armazenado inválido (formato regex-válido no banco, mas não um fuso IANA real) vira service_unavailable, nunca uma exceção", async () => {
  // app.is_bounded_timezone (0052) só valida FORMATO por regex, nunca se o
  // fuso IANA existe de verdade -- um valor tipo "America/Sao_Paolo" (erro
  // de digitação, mas regex-válido) passaria pelo banco e só estouraria
  // dentro de time/florida.ts (FloridaTimeError), antes de qualquer chamada
  // ao port (por isso um `port` é passado explicitamente aqui: se este teste
  // chegasse a chamá-lo, seria sinal de que a checagem de fuso não está
  // acontecendo antes da chamada de rede, como deveria). Isto é dado
  // armazenado ruim pré-existente, não entrada malformada desta chamada.
  const { client: rpc, calls } = fakeRpcClient({
    connection: Object.freeze({ outcome: "found", calendarId: CALENDAR_ID, defaultTimezone: "America/Sao_Paolo_typo_but_regex_valid", status: "connected", googleAccountEmail: "demo@example.test" }),
  });
  const port = { async queryFreeBusy() { throw new Error("should never be called: the timezone check must fail before any network call"); } };
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), { rpc, port, clock: clockAt("2026-08-05T12:00:00.000Z") });
  assert.deepEqual(result, { outcome: "service_unavailable" });
  assert.equal(calls.some((call) => call.name === "portal_propose_business_meeting_slots_service"), false);
});

test("outro erro do provider (timeout/malformed/rejected) vira provider_error com o código original, nunca uma exceção", async () => {
  for (const code of ["provider_timeout", "malformed_provider_response", "provider_rejected", "provider_unavailable"]) {
    const { client: rpc } = fakeRpcClient();
    const port = { async queryFreeBusy() { throw new provider.GoogleCalendarProviderError(code, `simulated ${code}`); } };
    const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), { rpc, port, clock: clockAt("2026-08-05T12:00:00.000Z") });
    assert.deepEqual(result, { outcome: "provider_error", providerErrorCode: code });
  }
});

test("um erro que não é GoogleCalendarProviderError propaga (bug genuíno, nunca silenciado como outcome de negócio)", async () => {
  const { client: rpc } = fakeRpcClient();
  const port = { async queryFreeBusy() { throw new TypeError("boom"); } };
  await assert.rejects(
    () => proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), { rpc, port, clock: clockAt("2026-08-05T12:00:00.000Z") }),
    TypeError,
  );
});

// ---------------------------------------------------------------------------
// resultado da RPC de propose (rejeitado / malformado)
// ---------------------------------------------------------------------------

test("propaga um outcome rejected da RPC de propose com o motivo declarado", async () => {
  const { client: rpc } = fakeRpcClient({ propose: { outcome: "rejected", reason: "grant_expired" } });
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), {
    rpc, port: fakePort(), clock: clockAt("2026-08-05T12:00:00.000Z"),
  });
  assert.deepEqual(result, { outcome: "rejected", reason: "grant_expired" });
});

test("falha de transporte em qualquer uma das três RPCs vira service_unavailable, nunca uma exceção", async () => {
  for (const rpcName of [
    "portal_google_calendar_connection_context_service",
    "portal_google_calendar_decrypted_refresh_token_service",
    "portal_propose_business_meeting_slots_service",
  ]) {
    const { client: rpc } = fakeRpcClient({ throwFor: { [rpcName]: true } });
    const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), {
      rpc, port: fakePort(), clock: clockAt("2026-08-05T12:00:00.000Z"),
    });
    assert.deepEqual(result, { outcome: "service_unavailable" }, `rpc=${rpcName}`);
  }
});

test("erro estruturado ({error}) em qualquer uma das três RPCs vira service_unavailable", async () => {
  for (const rpcName of [
    "portal_google_calendar_connection_context_service",
    "portal_google_calendar_decrypted_refresh_token_service",
    "portal_propose_business_meeting_slots_service",
  ]) {
    const { client: rpc } = fakeRpcClient({ errorFor: { [rpcName]: "db down" } });
    const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), {
      rpc, port: fakePort(), clock: clockAt("2026-08-05T12:00:00.000Z"),
    });
    assert.deepEqual(result, { outcome: "service_unavailable" }, `rpc=${rpcName}`);
  }
});

test("outcome inesperado da RPC de propose vira service_unavailable, nunca é repassado cru", async () => {
  const { client: rpc } = fakeRpcClient({ propose: { outcome: "algo_novo_desconhecido" } });
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), {
    rpc, port: fakePort(), clock: clockAt("2026-08-05T12:00:00.000Z"),
  });
  assert.deepEqual(result, { outcome: "service_unavailable" });
});

// ---------------------------------------------------------------------------
// validação de input (antes de qualquer chamada de rede)
// ---------------------------------------------------------------------------

test("rejeita ids que não são UUIDv7 antes de qualquer RPC", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  for (const field of ["tenantId", "agentId", "sessionId", "presenterId", "grantId"]) {
    await assert.rejects(
      () => proposeModule.proposeGoogleCalendarMeetingSlots(baseInput({ [field]: "not-a-uuid" }), { rpc, port: fakePort() }),
      proposeModule.ProposeGoogleCalendarMeetingSlotsInputError,
    );
  }
  assert.equal(calls.length, 0);
});

test("rejeita durationMinutes fora da allowlist antes de qualquer RPC", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  await assert.rejects(
    () => proposeModule.proposeGoogleCalendarMeetingSlots(baseInput({ durationMinutes: 20 }), { rpc, port: fakePort() }),
    proposeModule.ProposeGoogleCalendarMeetingSlotsInputError,
  );
  assert.equal(calls.length, 0);
});

test("rejeita contactEmail malformado antes de qualquer RPC; contactName/contactEmail ausentes são aceitos (null)", async () => {
  const { client: rpc, calls } = fakeRpcClient();
  await assert.rejects(
    () => proposeModule.proposeGoogleCalendarMeetingSlots(baseInput({ contactEmail: "não-é-email" }), { rpc, port: fakePort() }),
    proposeModule.ProposeGoogleCalendarMeetingSlotsInputError,
  );
  assert.equal(calls.length, 0);

  const { client: rpcOk, calls: callsOk } = fakeRpcClient();
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(
    baseInput({ contactName: undefined, contactEmail: undefined }),
    { rpc: rpcOk, port: fakePort(), clock: clockAt("2026-08-05T12:00:00.000Z"), businessDaysCount: 1, maxSlots: 1 },
  );
  assert.equal(result.outcome, "succeeded");
  const proposeCall = callsOk.find((call) => call.name === "portal_propose_business_meeting_slots_service");
  assert.equal(proposeCall.parameters.p_contact_name, null);
  assert.equal(proposeCall.parameters.p_contact_email, null);
});

// ---------------------------------------------------------------------------
// seleção real/fake por PORTAL_FAKE_PROVIDERS (sem dependencies.port)
// ---------------------------------------------------------------------------

test("modo fake (PORTAL_FAKE_PROVIDERS=1) usa o port fake determinístico sem nenhuma chamada de rede real, mesmo sem dependencies.port", async () => {
  await withFakeProviders(async () => {
    const { client: rpc } = fakeRpcClient();
    const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), {
      rpc, clock: clockAt("2026-08-05T12:00:00.000Z"), businessDaysCount: 1, maxSlots: 1,
    });
    assert.equal(result.outcome, "succeeded");
  }, true);
});

test("modo real sem GOOGLE_OAUTH_CLIENT_ID/SECRET configurados vira provider_error (missing_credentials), nunca lança", async () => {
  const before = { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET };
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  try {
    await withFakeProviders(async () => {
      const { client: rpc } = fakeRpcClient();
      const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), { rpc, clock: clockAt("2026-08-05T12:00:00.000Z") });
      assert.deepEqual(result, { outcome: "provider_error", providerErrorCode: "missing_credentials" });
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
  const port = { async queryFreeBusy() { throw new provider.GoogleCalendarProviderError("provider_rejected", `rejected (${secretToken} would be a bug)`); } };
  const result = await proposeModule.proposeGoogleCalendarMeetingSlots(baseInput(), { rpc, port, clock: clockAt("2026-08-05T12:00:00.000Z") });
  assert.equal(JSON.stringify(result).includes(secretToken), false);
});
