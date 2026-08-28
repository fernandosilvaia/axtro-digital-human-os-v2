import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-google-calendar/dist/index.js")).href);

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "test-client-secret-000000000000";
const REFRESH_TOKEN = "test-refresh-token-000000000000";
const CALENDAR_ID = "closer-demo@group.calendar.google.com";
// Formato exigido pela doc oficial para um eventId fornecido pelo chamador: base32hex (a-v0-9), 5..1024 chars.
const EVENT_ID = "aa11bb22cc33dd44ee55";

function fakeFetch(routeHandler) {
  const calls = [];
  return {
    calls,
    implementation: async (url, init) => {
      calls.push({ url: url.toString(), init });
      return routeHandler(url.toString(), init);
    },
  };
}

function tokenOkResponse(overrides = {}) {
  return new Response(JSON.stringify({
    access_token: "fake-access-token-abc",
    expires_in: 3600,
    scope: "https://www.googleapis.com/auth/calendar",
    token_type: "Bearer",
    ...overrides,
  }), { status: 200 });
}

function router(handlers) {
  return fakeFetch((url, init) => {
    if (url.startsWith("https://oauth2.googleapis.com/token")) return handlers.token(url, init);
    return handlers.calendar(url, init);
  });
}

function insertRequest(overrides = {}) {
  return {
    calendarId: CALENDAR_ID,
    eventId: EVENT_ID,
    summary: "Reunião de descoberta — Raissa",
    startIso: "2026-09-01T14:00:00-03:00",
    endIso: "2026-09-01T14:30:00-03:00",
    timeZone: "America/Sao_Paulo",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// refreshGoogleAccessToken (OAuth2 token endpoint)
// ---------------------------------------------------------------------------

test("refreshGoogleAccessToken troca o refresh_token pelo access_token no endpoint oficial", async () => {
  const { calls, implementation } = fakeFetch(async () => tokenOkResponse());
  const result = await provider.refreshGoogleAccessToken({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    refreshToken: REFRESH_TOKEN,
    fetchImplementation: implementation,
  });
  assert.deepEqual(result, {
    accessToken: "fake-access-token-abc",
    expiresInSeconds: 3600,
    scope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get("client_id"), CLIENT_ID);
  assert.equal(body.get("client_secret"), CLIENT_SECRET);
  assert.equal(body.get("refresh_token"), REFRESH_TOKEN);
  assert.equal(body.get("grant_type"), "refresh_token");
});

test("refreshGoogleAccessToken: invalid_grant do Google vira reauth_required; client_secret e refresh_token nunca vazam no erro", async () => {
  const { implementation } = fakeFetch(async () => new Response(
    JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }),
    { status: 400 },
  ));
  await assert.rejects(
    () => provider.refreshGoogleAccessToken({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
    }),
    (error) => {
      assert.equal(error.code, "reauth_required");
      assert.equal(error.httpStatus, 400);
      assert.equal(error.message.includes(CLIENT_SECRET), false);
      assert.equal(error.message.includes(REFRESH_TOKEN), false);
      return true;
    },
  );
});

test("refreshGoogleAccessToken: outro erro 400 vira provider_rejected (não reauth_required); 5xx vira provider_unavailable", async () => {
  const badRequest = fakeFetch(async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 400 }));
  await assert.rejects(
    () => provider.refreshGoogleAccessToken({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: badRequest.implementation,
    }),
    (e) => e.code === "provider_rejected" && e.httpStatus === 400,
  );

  const down = fakeFetch(async () => new Response("service down", { status: 503 }));
  await assert.rejects(
    () => provider.refreshGoogleAccessToken({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: down.implementation,
    }),
    (e) => e.code === "provider_unavailable" && e.httpStatus === 503,
  );
});

test("refreshGoogleAccessToken: payload incompleto vira malformed_provider_response; credencial ausente nem chama a rede", async () => {
  const junk = fakeFetch(async () => new Response(JSON.stringify({ access_token: "x" }), { status: 200 }));
  await assert.rejects(
    () => provider.refreshGoogleAccessToken({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: junk.implementation,
    }),
    (e) => e.code === "malformed_provider_response",
  );

  const { calls, implementation } = fakeFetch(async () => tokenOkResponse());
  await assert.rejects(
    () => provider.refreshGoogleAccessToken({ clientId: "", clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation }),
    (e) => e.code === "missing_credentials",
  );
  assert.equal(calls.length, 0);
});

test("refreshGoogleAccessToken: timeout aborta antes dos headers e nunca vaza credencial no erro", async () => {
  const timeoutFetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  await assert.rejects(
    () => provider.refreshGoogleAccessToken({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, timeoutMs: 5, fetchImplementation: timeoutFetch,
    }),
    (e) => {
      assert.equal(e.code, "provider_timeout");
      assert.equal(e.message.includes(CLIENT_SECRET), false);
      assert.equal(e.message.includes(REFRESH_TOKEN), false);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// exchangeGoogleAuthorizationCode (troca inicial code -> refresh_token, onda 1b-ii)
// ---------------------------------------------------------------------------

const AUTH_CODE = "test-authorization-code-000000000";
const REDIRECT_URI = "https://portal.test/api/google-calendar/oauth/callback";

function authorizationCodeTokenOkResponse(overrides = {}) {
  return new Response(JSON.stringify({
    access_token: "fake-access-token-abc",
    refresh_token: "fake-refresh-token-xyz",
    expires_in: 3600,
    scope: "https://www.googleapis.com/auth/calendar openid email",
    token_type: "Bearer",
    id_token: "header.payload.signature",
    ...overrides,
  }), { status: 200 });
}

test("exchangeGoogleAuthorizationCode troca o code por refresh_token/access_token/id_token no endpoint oficial", async () => {
  const { calls, implementation } = fakeFetch(async () => authorizationCodeTokenOkResponse());
  const result = await provider.exchangeGoogleAuthorizationCode({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    code: AUTH_CODE,
    redirectUri: REDIRECT_URI,
    fetchImplementation: implementation,
  });
  assert.deepEqual(result, {
    accessToken: "fake-access-token-abc",
    expiresInSeconds: 3600,
    scope: "https://www.googleapis.com/auth/calendar openid email",
    tokenType: "Bearer",
    refreshToken: "fake-refresh-token-xyz",
    idToken: "header.payload.signature",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get("client_id"), CLIENT_ID);
  assert.equal(body.get("client_secret"), CLIENT_SECRET);
  assert.equal(body.get("code"), AUTH_CODE);
  assert.equal(body.get("redirect_uri"), REDIRECT_URI);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.has("refresh_token"), false);
});

test("exchangeGoogleAuthorizationCode: 2xx sem refresh_token vira missing_refresh_token, nunca finge sucesso incompleto", async () => {
  const { implementation } = fakeFetch(async () => authorizationCodeTokenOkResponse({ refresh_token: undefined }));
  await assert.rejects(
    () => provider.exchangeGoogleAuthorizationCode({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI, fetchImplementation: implementation,
    }),
    (e) => {
      assert.equal(e.code, "missing_refresh_token");
      assert.equal(e.message.includes("myaccount.google.com/permissions"), true);
      return true;
    },
  );
});

test("exchangeGoogleAuthorizationCode: idToken ausente no envelope vira null (não é erro — openid é opcional na URL de autorização)", async () => {
  const { implementation } = fakeFetch(async () => authorizationCodeTokenOkResponse({ id_token: undefined }));
  const result = await provider.exchangeGoogleAuthorizationCode({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI, fetchImplementation: implementation,
  });
  assert.equal(result.idToken, null);
});

test("exchangeGoogleAuthorizationCode: invalid_grant do code NUNCA vira reauth_required (não existe conexão a reautenticar); outro 400 vira provider_rejected, 5xx vira provider_unavailable", async () => {
  const invalidGrant = fakeFetch(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Malformed auth code." }), { status: 400 }));
  await assert.rejects(
    () => provider.exchangeGoogleAuthorizationCode({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI, fetchImplementation: invalidGrant.implementation,
    }),
    (e) => e.code === "provider_rejected" && e.httpStatus === 400,
  );

  const down = fakeFetch(async () => new Response("service down", { status: 503 }));
  await assert.rejects(
    () => provider.exchangeGoogleAuthorizationCode({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI, fetchImplementation: down.implementation,
    }),
    (e) => e.code === "provider_unavailable" && e.httpStatus === 503,
  );
});

test("exchangeGoogleAuthorizationCode: payload incompleto vira malformed_provider_response; credencial/code/redirect_uri ausente nem chama a rede", async () => {
  const junk = fakeFetch(async () => new Response(JSON.stringify({ access_token: "x" }), { status: 200 }));
  await assert.rejects(
    () => provider.exchangeGoogleAuthorizationCode({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI, fetchImplementation: junk.implementation,
    }),
    (e) => e.code === "malformed_provider_response",
  );

  for (const missing of [
    { clientId: "", clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI },
    { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: "", redirectUri: REDIRECT_URI },
    { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: "" },
  ]) {
    const { calls, implementation } = fakeFetch(async () => authorizationCodeTokenOkResponse());
    await assert.rejects(
      () => provider.exchangeGoogleAuthorizationCode({ ...missing, fetchImplementation: implementation }),
      (e) => e.code === "missing_credentials",
    );
    assert.equal(calls.length, 0);
  }
});

test("exchangeGoogleAuthorizationCode: timeout aborta antes dos headers e nunca vaza code/client_secret no erro", async () => {
  const timeoutFetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  await assert.rejects(
    () => provider.exchangeGoogleAuthorizationCode({
      clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI, timeoutMs: 5, fetchImplementation: timeoutFetch,
    }),
    (e) => {
      assert.equal(e.code, "provider_timeout");
      assert.equal(e.message.includes(CLIENT_SECRET), false);
      assert.equal(e.message.includes(AUTH_CODE), false);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// createFakeGoogleAuthorizationCodeExchange (modo fake determinístico, onda 1b-ii)
// ---------------------------------------------------------------------------

test("fake: createFakeGoogleAuthorizationCodeExchange é determinístico e reaplica a mesma validação do modo real, sem rede", async () => {
  const exchange = provider.createFakeGoogleAuthorizationCodeExchange();
  const first = await exchange({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI });
  const second = await exchange({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: "outro-code-qualquer", redirectUri: REDIRECT_URI });
  assert.deepEqual(first, second);
  assert.equal(typeof first.refreshToken, "string");
  assert.equal(first.refreshToken.length > 0, true);
  assert.equal(typeof first.idToken, "string");
  assert.equal(first.idToken.split(".").length, 3);

  await assert.rejects(
    () => exchange({ clientId: "", clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI }),
    (e) => e.code === "missing_credentials",
  );
});

test("fake: simulateMissingRefreshToken força missing_refresh_token sem rede", async () => {
  const exchange = provider.createFakeGoogleAuthorizationCodeExchange({ simulateMissingRefreshToken: true });
  await assert.rejects(
    () => exchange({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI }),
    (e) => e.code === "missing_refresh_token",
  );
});

test("fake: idToken devolvido é um JWT decodificável (header.payload.signature) com a claim email — o mesmo caminho que a rota de callback do portal decodifica", async () => {
  const exchange = provider.createFakeGoogleAuthorizationCodeExchange();
  const result = await exchange({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: AUTH_CODE, redirectUri: REDIRECT_URI });
  const [, payloadSegment] = result.idToken.split(".");
  const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  assert.equal(typeof payload.email, "string");
  assert.match(payload.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
});

// ---------------------------------------------------------------------------
// createGoogleCalendarPort — queryFreeBusy
// ---------------------------------------------------------------------------

test("queryFreeBusy refresca o access token e envia items/timeMin/timeMax reais ao endpoint oficial", async () => {
  const { calls, implementation } = router({
    token: async () => tokenOkResponse(),
    calendar: async () => new Response(JSON.stringify({
      calendars: { [CALENDAR_ID]: { busy: [{ start: "2026-09-01T14:00:00-03:00", end: "2026-09-01T14:30:00-03:00" }] } },
    }), { status: 200 }),
  });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  const result = await port.queryFreeBusy({
    calendarId: CALENDAR_ID, timeMinIso: "2026-09-01T12:00:00-03:00", timeMaxIso: "2026-09-01T18:00:00-03:00",
  });
  assert.deepEqual(result, {
    calendarId: CALENDAR_ID,
    busy: [{ startIso: "2026-09-01T14:00:00-03:00", endIso: "2026-09-01T14:30:00-03:00" }],
  });
  const calendarCall = calls.find((c) => c.url.includes("/freeBusy"));
  assert.equal(calendarCall.url, "https://www.googleapis.com/calendar/v3/freeBusy");
  assert.equal(calendarCall.init.headers.Authorization, "Bearer fake-access-token-abc");
  const body = JSON.parse(calendarCall.init.body);
  assert.deepEqual(body.items, [{ id: CALENDAR_ID }]);
  assert.equal(body.timeMin, "2026-09-01T12:00:00-03:00");
  assert.equal(body.timeMax, "2026-09-01T18:00:00-03:00");
});

test("queryFreeBusy valida calendarId e janela ISO antes de qualquer rede; janela invertida é rejeitada", async () => {
  const { calls, implementation } = router({ token: async () => tokenOkResponse(), calendar: async () => new Response("{}", { status: 200 }) });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  for (const bad of [
    { calendarId: "", timeMinIso: "2026-09-01T12:00:00Z", timeMaxIso: "2026-09-01T18:00:00Z" },
    { calendarId: CALENDAR_ID, timeMinIso: "não é data", timeMaxIso: "2026-09-01T18:00:00Z" },
    { calendarId: CALENDAR_ID, timeMinIso: "2026-09-01T18:00:00Z", timeMaxIso: "2026-09-01T12:00:00Z" },
  ]) {
    await assert.rejects(() => port.queryFreeBusy(bad), (e) => e.code === "invalid_request");
  }
  assert.equal(calls.length, 0);
});

test("queryFreeBusy: erro por-calendário no corpo do Google (ex.: notFound) vira provider_rejected", async () => {
  const { implementation } = router({
    token: async () => tokenOkResponse(),
    calendar: async () => new Response(JSON.stringify({
      calendars: { [CALENDAR_ID]: { errors: [{ domain: "global", reason: "notFound" }] } },
    }), { status: 200 }),
  });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  await assert.rejects(
    () => port.queryFreeBusy({ calendarId: CALENDAR_ID, timeMinIso: "2026-09-01T12:00:00Z", timeMaxIso: "2026-09-01T18:00:00Z" }),
    (e) => e.code === "provider_rejected" && e.message.includes("notFound"),
  );
});

// ---------------------------------------------------------------------------
// createGoogleCalendarPort — insertEvent (o coração da hipótese confirmada)
// ---------------------------------------------------------------------------

test("insertEvent envia o id gerado pelo chamador e devolve o evento confirmado", async () => {
  const { calls, implementation } = router({
    token: async () => tokenOkResponse(),
    calendar: async () => new Response(JSON.stringify({
      id: EVENT_ID,
      status: "confirmed",
      htmlLink: "https://calendar.google.com/event?eid=abc",
      start: { dateTime: "2026-09-01T14:00:00-03:00" },
      end: { dateTime: "2026-09-01T14:30:00-03:00" },
    }), { status: 200 }),
  });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  const result = await port.insertEvent(insertRequest({ attendeeEmails: ["prospect@example.com"], sendUpdates: "all" }));
  assert.deepEqual(result, {
    id: EVENT_ID,
    status: "confirmed",
    htmlLink: "https://calendar.google.com/event?eid=abc",
    startIso: "2026-09-01T14:00:00-03:00",
    endIso: "2026-09-01T14:30:00-03:00",
  });
  const calendarCall = calls.find((c) => c.url.includes("/events"));
  assert.equal(calendarCall.url, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events?sendUpdates=all`);
  const body = JSON.parse(calendarCall.init.body);
  assert.equal(body.id, EVENT_ID);
  assert.deepEqual(body.start, { dateTime: insertRequest().startIso, timeZone: "America/Sao_Paulo" });
  assert.deepEqual(body.attendees, [{ email: "prospect@example.com" }]);
});

test("insertEvent: retry com o MESMO id vira event_id_conflict (409) — nunca duplicado (comportamento confirmado na doc oficial)", async () => {
  const { implementation } = router({
    token: async () => tokenOkResponse(),
    calendar: async () => new Response(
      JSON.stringify({ error: { errors: [{ domain: "global", reason: "duplicate", message: "The requested identifier already exists." }], code: 409 } }),
      { status: 409 },
    ),
  });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  await assert.rejects(() => port.insertEvent(insertRequest()), (e) => {
    assert.equal(e.code, "event_id_conflict");
    assert.equal(e.httpStatus, 409);
    return true;
  });
});

test("insertEvent valida eventId (formato base32hex do Google), datas, fuso e e-mails de convidados antes da rede", async () => {
  const { calls, implementation } = router({ token: async () => tokenOkResponse(), calendar: async () => new Response("{}", { status: 200 }) });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  for (const bad of [
    insertRequest({ eventId: "abcd" }), // 4 chars, mínimo é 5
    insertRequest({ eventId: "has-hyphen-not-allowed" }), // hífen fora do alfabeto base32hex
    insertRequest({ eventId: "UPPERCASE1234" }), // maiúsculas fora do alfabeto
    insertRequest({ summary: "" }),
    insertRequest({ startIso: "não é data" }),
    insertRequest({ endIso: insertRequest().startIso }), // end não é depois de start
    insertRequest({ timeZone: "" }),
    insertRequest({ attendeeEmails: ["não-é-email"] }),
    insertRequest({ sendUpdates: "todos" }),
  ]) {
    await assert.rejects(() => port.insertEvent(bad), (e) => e.code === "invalid_request", JSON.stringify(bad));
  }
  const calendarCalls = calls.filter((c) => c.url.includes("/events"));
  assert.equal(calendarCalls.length, 0);
});

test("insertEvent: payload do Google com id diferente do pedido vira malformed_provider_response (defensivo)", async () => {
  const { implementation } = router({
    token: async () => tokenOkResponse(),
    calendar: async () => new Response(JSON.stringify({ id: "outro-id-qualquer", status: "confirmed" }), { status: 200 }),
  });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  await assert.rejects(() => port.insertEvent(insertRequest()), (e) => e.code === "malformed_provider_response");
});

// ---------------------------------------------------------------------------
// createGoogleCalendarPort — getEvent / deleteEvent (reconciliação e rollback)
// ---------------------------------------------------------------------------

test("getEvent busca por id e devolve o evento; 404 vira event_not_found (reconciliação de linha unknown)", async () => {
  const { calls, implementation } = router({
    token: async () => tokenOkResponse(),
    calendar: async (url) => (url.includes(EVENT_ID)
      ? new Response(JSON.stringify({ id: EVENT_ID, status: "confirmed" }), { status: 200 })
      : new Response("not found", { status: 404 })),
  });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  const event = await port.getEvent(CALENDAR_ID, EVENT_ID);
  assert.equal(event.id, EVENT_ID);
  assert.equal(calls.find((c) => c.url.includes("/events/")).url, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events/${EVENT_ID}`);

  await assert.rejects(() => port.getEvent(CALENDAR_ID, "nunca-existiu-000"), (e) => e.code === "event_not_found" && e.httpStatus === 404);
});

test("deleteEvent apaga o evento; um evento já ausente (404) é sucesso idempotente (rollback seguro)", async () => {
  const { calls, implementation } = router({
    token: async () => tokenOkResponse(),
    calendar: async () => new Response(null, { status: 204 }),
  });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  await port.deleteEvent(CALENDAR_ID, EVENT_ID);
  assert.equal(calls.find((c) => c.url.includes("/events/")).init.method, "DELETE");

  const missing = router({ token: async () => tokenOkResponse(), calendar: async () => new Response("gone", { status: 404 }) });
  const portMissing = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: missing.implementation,
  });
  await portMissing.deleteEvent(CALENDAR_ID, EVENT_ID); // não deve lançar
});

// ---------------------------------------------------------------------------
// Cache de access token + refreshAccessToken explícito
// ---------------------------------------------------------------------------

test("o access token é cacheado entre chamadas e só é renovado perto de expirar (clock injetável)", async () => {
  let now = 0;
  const tokenCalls = [];
  const { implementation } = router({
    token: async () => { tokenCalls.push(now); return tokenOkResponse({ expires_in: 3600 }); },
    calendar: async () => new Response(JSON.stringify({ id: EVENT_ID, status: "confirmed" }), { status: 200 }),
  });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN,
    fetchImplementation: implementation, clock: { now: () => now },
  });
  await port.getEvent(CALENDAR_ID, EVENT_ID);
  await port.getEvent(CALENDAR_ID, EVENT_ID);
  assert.equal(tokenCalls.length, 1, "segunda chamada deveria reusar o token cacheado");

  now = 3600 * 1_000; // token expirado (buffer de 60s já estourado também)
  await port.getEvent(CALENDAR_ID, EVENT_ID);
  assert.equal(tokenCalls.length, 2, "terceira chamada deveria renovar o token expirado");
});

test("refreshAccessToken força uma renovação real e atualiza o cache interno", async () => {
  let tokenCallCount = 0;
  const { implementation } = router({
    token: async () => { tokenCallCount += 1; return tokenOkResponse(); },
    calendar: async () => new Response(JSON.stringify({ id: EVENT_ID, status: "confirmed" }), { status: 200 }),
  });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  const token = await port.refreshAccessToken();
  assert.equal(token.accessToken, "fake-access-token-abc");
  assert.equal(tokenCallCount, 1);
  await port.getEvent(CALENDAR_ID, EVENT_ID);
  assert.equal(tokenCallCount, 1, "getEvent deveria reusar o token que refreshAccessToken acabou de cachear");
});

test("refresh token revogado (invalid_grant) durante uma chamada de calendário propaga reauth_required, sem tentar a chamada real", async () => {
  const { calls, implementation } = router({
    token: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    calendar: async () => new Response(JSON.stringify({ id: EVENT_ID, status: "confirmed" }), { status: 200 }),
  });
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, fetchImplementation: implementation,
  });
  await assert.rejects(() => port.getEvent(CALENDAR_ID, EVENT_ID), (e) => e.code === "reauth_required");
  assert.equal(calls.some((c) => c.url.includes("/events/")), false);
});

test("timeout na chamada de calendário aborta antes dos headers", async () => {
  const timeoutFetch = async (url, init) => {
    if (url.toString().startsWith("https://oauth2.googleapis.com/token")) return tokenOkResponse();
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  };
  const port = provider.createGoogleCalendarPort({
    clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: REFRESH_TOKEN, timeoutMs: 5, fetchImplementation: timeoutFetch,
  });
  await assert.rejects(() => port.getEvent(CALENDAR_ID, EVENT_ID), (e) => e.code === "provider_timeout");
});

// ---------------------------------------------------------------------------
// isValidGoogleCalendarEventId (helper puro)
// ---------------------------------------------------------------------------

test("isValidGoogleCalendarEventId aceita só o alfabeto base32hex documentado (a-v0-9), 5..1024 chars", () => {
  assert.equal(provider.isValidGoogleCalendarEventId(EVENT_ID), true);
  assert.equal(provider.isValidGoogleCalendarEventId("0123456789abcdef"), true); // hex minúsculo puro — subconjunto válido
  for (const bad of ["abcd", "UPPER123", "has-hyphen", "has_underscore", "com espaço", "w".repeat(6), "x".repeat(1025), 42, null, undefined]) {
    assert.equal(provider.isValidGoogleCalendarEventId(bad), false, JSON.stringify(bad));
  }
});

// ---------------------------------------------------------------------------
// Modo fake determinístico
// ---------------------------------------------------------------------------

test("googleCalendarFakeProvidersEnabled lê PORTAL_FAKE_PROVIDERS=1, mesmo mecanismo do resto do repo", () => {
  const original = process.env.PORTAL_FAKE_PROVIDERS;
  try {
    delete process.env.PORTAL_FAKE_PROVIDERS;
    assert.equal(provider.googleCalendarFakeProvidersEnabled(), false);
    process.env.PORTAL_FAKE_PROVIDERS = "1";
    assert.equal(provider.googleCalendarFakeProvidersEnabled(), true);
    process.env.PORTAL_FAKE_PROVIDERS = "true";
    assert.equal(provider.googleCalendarFakeProvidersEnabled(), false);
  } finally {
    if (original === undefined) delete process.env.PORTAL_FAKE_PROVIDERS; else process.env.PORTAL_FAKE_PROVIDERS = original;
  }
});

test("fake: insertEvent é determinístico e reaplica a mesma validação do modo real, sem rede", async () => {
  const port = provider.createFakeGoogleCalendarPort();
  const event = await port.insertEvent(insertRequest());
  assert.equal(event.id, EVENT_ID);
  assert.equal(event.status, "confirmed");
  await assert.rejects(() => port.insertEvent(insertRequest({ eventId: "abcd" })), (e) => e.code === "invalid_request");
});

test("fake: retry do mesmo eventId no mesmo calendarId vira event_id_conflict, nunca duplica — espelha o comportamento confirmado real", async () => {
  const port = provider.createFakeGoogleCalendarPort();
  await port.insertEvent(insertRequest());
  await assert.rejects(() => port.insertEvent(insertRequest()), (e) => e.code === "event_id_conflict" && e.httpStatus === 409);
  // Em outro calendário, o mesmo id é livre — o conflito é por (calendarId, eventId), igual ao Google real.
  const other = await port.insertEvent(insertRequest({ calendarId: "outro-calendario@group.calendar.google.com" }));
  assert.equal(other.id, EVENT_ID);
});

test("fake: getEvent devolve o evento inserido; evento nunca criado vira event_not_found", async () => {
  const port = provider.createFakeGoogleCalendarPort();
  await port.insertEvent(insertRequest());
  const found = await port.getEvent(CALENDAR_ID, EVENT_ID);
  assert.equal(found.id, EVENT_ID);
  await assert.rejects(() => port.getEvent(CALENDAR_ID, "nunca-existiu-000"), (e) => e.code === "event_not_found");
});

test("fake: deleteEvent remove o evento (idempotente) e ele some do freebusy subsequente", async () => {
  const port = provider.createFakeGoogleCalendarPort();
  await port.insertEvent(insertRequest());
  const before = await port.queryFreeBusy({ calendarId: CALENDAR_ID, timeMinIso: "2026-09-01T00:00:00Z", timeMaxIso: "2026-09-02T00:00:00Z" });
  assert.equal(before.busy.length, 1);

  await port.deleteEvent(CALENDAR_ID, EVENT_ID);
  await port.deleteEvent(CALENDAR_ID, EVENT_ID); // segunda vez não deve lançar (idempotente)
  await assert.rejects(() => port.getEvent(CALENDAR_ID, EVENT_ID), (e) => e.code === "event_not_found");

  const after = await port.queryFreeBusy({ calendarId: CALENDAR_ID, timeMinIso: "2026-09-01T00:00:00Z", timeMaxIso: "2026-09-02T00:00:00Z" });
  assert.equal(after.busy.length, 0);
});

test("fake: simulateInvalidRefreshToken força reauth_required em toda operação, inclusive refreshAccessToken, sem rede", async () => {
  const port = provider.createFakeGoogleCalendarPort({ simulateInvalidRefreshToken: true });
  await assert.rejects(() => port.refreshAccessToken(), (e) => e.code === "reauth_required");
  await assert.rejects(() => port.insertEvent(insertRequest()), (e) => e.code === "reauth_required");
  await assert.rejects(
    () => port.queryFreeBusy({ calendarId: CALENDAR_ID, timeMinIso: "2026-09-01T00:00:00Z", timeMaxIso: "2026-09-02T00:00:00Z" }),
    (e) => e.code === "reauth_required",
  );
  await assert.rejects(() => port.getEvent(CALENDAR_ID, EVENT_ID), (e) => e.code === "reauth_required");
  await assert.rejects(() => port.deleteEvent(CALENDAR_ID, EVENT_ID), (e) => e.code === "reauth_required");
});

test("fake: refreshAccessToken devolve um token determinístico e estável", async () => {
  const port = provider.createFakeGoogleCalendarPort();
  const first = await port.refreshAccessToken();
  const second = await port.refreshAccessToken();
  assert.deepEqual(first, second);
  assert.equal(first.tokenType, "Bearer");
});
