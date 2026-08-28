import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-telnyx/dist/index.js")).href);

const API_KEY = "test-telnyx-key-0000000000";

function fakeFetch(handler) {
  const calls = [];
  return { calls, implementation: async (url, init) => { calls.push({ url, init }); return handler(url, init); } };
}

function callRequest(overrides = {}) {
  return {
    to: "+15550001111",
    from: "+15550002222",
    connectionId: "1234567890123456",
    ...overrides,
  };
}

function messageRequest(overrides = {}) {
  return {
    to: "+15550001111",
    from: "+15550002222",
    text: "Olá! Aqui é a Raissa da Axtro.",
    ...overrides,
  };
}

function callEnvelope(record) {
  return JSON.stringify({ data: record });
}

// ---------------------------------------------------------------------------
// Voice — modo real
// ---------------------------------------------------------------------------

test("dialCall envia payload fechado ao endpoint fixo com Bearer, desenvelopa {data} e devolve os 3 ids", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(
    callEnvelope({ call_control_id: "v3:abc", call_leg_id: "leg-1", call_session_id: "session-1" }),
    { status: 200 },
  ));
  const port = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.dialCall(callRequest({ webhookUrl: "https://closer.axtroai.com/api/telnyx/webhook", clientState: "c3RhdGU=", commandId: "cmd-1", timeoutSecs: 45 }));
  assert.deepEqual(result, { callControlId: "v3:abc", callLegId: "leg-1", callSessionId: "session-1" });
  assert.equal(calls[0].url, "https://api.telnyx.com/v2/calls");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${API_KEY}`);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.to, "+15550001111");
  assert.equal(body.from, "+15550002222");
  assert.equal(body.connection_id, "1234567890123456");
  assert.equal(body.webhook_url, "https://closer.axtroai.com/api/telnyx/webhook");
  assert.equal(body.client_state, "c3RhdGU=");
  assert.equal(body.command_id, "cmd-1");
  assert.equal(body.timeout_secs, 45);
});

test("dialCall valida to/from (E.164), connectionId, webhookUrl, timeoutSecs antes da rede; chave nunca vaza em erro", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(`nope ${API_KEY}`, { status: 401 }));
  const port = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: implementation });
  for (const bad of [
    callRequest({ to: "15550001111" }),
    callRequest({ to: "not-a-phone" }),
    callRequest({ from: "" }),
    callRequest({ connectionId: "" }),
    callRequest({ webhookUrl: "http://not-https.com" }),
    callRequest({ clientState: "" }),
    callRequest({ commandId: "" }),
    callRequest({ timeoutSecs: 4 }),
    callRequest({ timeoutSecs: 601 }),
    callRequest({ timeoutSecs: 30.5 }),
  ]) {
    await assert.rejects(() => port.dialCall(bad), (e) => e.code === "invalid_request", JSON.stringify(bad));
  }
  assert.equal(calls.length, 0);
  await assert.rejects(() => port.dialCall(callRequest()), (e) => {
    assert.equal(e.code, "provider_rejected");
    assert.equal(e.httpStatus, 401);
    assert.equal(e.message.includes(API_KEY), false);
    return true;
  });
});

test("5xx vira provider_unavailable; payload sem ids vira malformed; sem chave nem constrói", async () => {
  const down = fakeFetch(async () => new Response("x", { status: 503 }));
  const portDown = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: down.implementation });
  await assert.rejects(() => portDown.dialCall(callRequest()), (e) => {
    assert.equal(e.code, "provider_unavailable");
    assert.equal(e.httpStatus, 503);
    return true;
  });

  const junk = fakeFetch(async () => new Response(callEnvelope({ call_control_id: "v3:abc" }), { status: 200 }));
  const portJunk = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: junk.implementation });
  await assert.rejects(() => portJunk.dialCall(callRequest()), (e) => e.code === "malformed_provider_response");

  assert.throws(() => provider.createTelnyxPort({ apiKey: "" }), (e) => e.code === "missing_api_key");
});

test("hangupCall manda POST {} no path oficial e valida callControlId antes da rede", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(callEnvelope({}), { status: 200 }));
  const port = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await port.hangupCall("v3:abc def");
  assert.equal(calls[0].url, "https://api.telnyx.com/v2/calls/v3%3Aabc%20def/actions/hangup");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {});
  await assert.rejects(() => port.hangupCall(""), (e) => e.code === "invalid_request");
});

test("getCallStatus consulta o path oficial, desenvelopa {data} e mapeia is_alive/duração/tempos", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(callEnvelope({
    call_control_id: "v3:abc",
    call_leg_id: "leg-1",
    call_session_id: "session-1",
    is_alive: false,
    call_duration: 42,
    start_time: "2019-01-23T18:10:02.574Z",
    end_time: "2019-01-23T18:11:52.574Z",
  }), { status: 200 }));
  const port = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const status = await port.getCallStatus("v3:abc");
  assert.equal(calls[0].url, "https://api.telnyx.com/v2/calls/v3%3Aabc");
  assert.equal(calls[0].init.method, "GET");
  assert.deepEqual(status, {
    callControlId: "v3:abc",
    callLegId: "leg-1",
    callSessionId: "session-1",
    isAlive: false,
    callDurationSeconds: 42,
    startTime: "2019-01-23T18:10:02.574Z",
    endTime: "2019-01-23T18:11:52.574Z",
  });
});

test("getCallStatus rejeita payload cujo call_control_id não bate com o pedido", async () => {
  const { implementation } = fakeFetch(async () => new Response(callEnvelope({
    call_control_id: "v3:outro", call_leg_id: "leg-1", call_session_id: "session-1", is_alive: true,
  }), { status: 200 }));
  const port = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: implementation });
  await assert.rejects(() => port.getCallStatus("v3:abc"), (e) => e.code === "malformed_provider_response");
});

// ---------------------------------------------------------------------------
// Messaging — modo real
// ---------------------------------------------------------------------------

function outboundMessagePayload(overrides = {}) {
  return {
    record_type: "message",
    direction: "outbound",
    id: "40385f64-5717-4562-b3fc-2c963f66afa6",
    to: [{ phone_number: "+15550001111", status: "queued" }],
    ...overrides,
  };
}

test("sendMessage envia payload fechado, desenvelopa {data} e devolve id/to/status", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(callEnvelope(outboundMessagePayload()), { status: 200 }));
  const port = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.sendMessage(messageRequest({ webhookUrl: "https://closer.axtroai.com/api/telnyx/webhook" }));
  assert.deepEqual(result, { id: "40385f64-5717-4562-b3fc-2c963f66afa6", recordType: "message", to: "+15550001111", status: "queued" });
  assert.equal(calls[0].url, "https://api.telnyx.com/v2/messages");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.to, "+15550001111");
  assert.equal(body.from, "+15550002222");
  assert.equal(body.text, "Olá! Aqui é a Raissa da Axtro.");
  assert.equal(body.webhook_url, "https://closer.axtroai.com/api/telnyx/webhook");
});

test("sendMessage valida to/from/text/webhookUrl antes da rede", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(`nope ${API_KEY}`, { status: 401 }));
  const port = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: implementation });
  for (const bad of [
    messageRequest({ to: "15550001111" }),
    messageRequest({ from: "" }),
    messageRequest({ text: "" }),
    messageRequest({ text: "x".repeat(1601) }),
    messageRequest({ webhookUrl: "http://not-https.com" }),
  ]) {
    await assert.rejects(() => port.sendMessage(bad), (e) => e.code === "invalid_request", JSON.stringify(bad));
  }
  assert.equal(calls.length, 0);
});

test("sendMessage rejeita payload inbound ou sem recipient como malformed", async () => {
  const inbound = fakeFetch(async () => new Response(callEnvelope(outboundMessagePayload({ direction: "inbound" })), { status: 200 }));
  const portInbound = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: inbound.implementation });
  await assert.rejects(() => portInbound.sendMessage(messageRequest()), (e) => e.code === "malformed_provider_response");

  const noRecipient = fakeFetch(async () => new Response(callEnvelope(outboundMessagePayload({ to: [] })), { status: 200 }));
  const portNoRecipient = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: noRecipient.implementation });
  await assert.rejects(() => portNoRecipient.sendMessage(messageRequest()), (e) => e.code === "malformed_provider_response");
});

test("getMessageStatus valida UUID antes da rede e consulta o path oficial", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(callEnvelope(outboundMessagePayload({ to: [{ phone_number: "+15550001111", status: "delivered" }] })), { status: 200 }));
  const port = provider.createTelnyxPort({ apiKey: API_KEY, fetchImplementation: implementation });
  const result = await port.getMessageStatus("40385f64-5717-4562-b3fc-2c963f66afa6");
  assert.equal(result.status, "delivered");
  assert.equal(calls[0].url, "https://api.telnyx.com/v2/messages/40385f64-5717-4562-b3fc-2c963f66afa6");
  assert.equal(calls[0].init.method, "GET");
  await assert.rejects(() => port.getMessageStatus("not-a-uuid"), (e) => e.code === "invalid_request");
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------------------
// Timeout (mesma técnica de provider-recall/provider-tavus: fetch injetado
// que só resolve quando o AbortSignal disparar)
// ---------------------------------------------------------------------------

test("timeout aborta antes dos headers e nunca vaza a chave no erro", async () => {
  const timeoutFetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const port = provider.createTelnyxPort({ apiKey: API_KEY, timeoutMs: 5, fetchImplementation: timeoutFetch });
  await assert.rejects(() => port.dialCall(callRequest()), (e) => {
    assert.equal(e.code, "provider_timeout");
    assert.equal(e.message.includes(API_KEY), false);
    return true;
  });
});

test("corpo travado depois dos headers ainda respeita o timeout", async () => {
  const stallingFetch = async (_url, init) => ({
    ok: true,
    status: 200,
    text: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  const port = provider.createTelnyxPort({ apiKey: API_KEY, timeoutMs: 5, fetchImplementation: stallingFetch });
  await assert.rejects(() => port.dialCall(callRequest()), (e) => e.code === "provider_timeout");
});

// ---------------------------------------------------------------------------
// Modo fake determinístico — sem nenhuma chamada de rede (nenhum teste
// abaixo injeta fetchImplementation)
// ---------------------------------------------------------------------------

test("fake dialCall é determinístico entre instâncias diferentes do port e não toca rede", async () => {
  const portA = provider.createFakeTelnyxPort();
  const portB = provider.createFakeTelnyxPort();
  const resultA = await portA.dialCall(callRequest());
  const resultB = await portB.dialCall(callRequest());
  assert.deepEqual(resultA, resultB);
  assert.match(resultA.callControlId, /^fake_call_[0-9a-f]{64}$/);

  const differentTo = await portA.dialCall(callRequest({ to: "+15559999999" }));
  assert.notEqual(differentTo.callControlId, resultA.callControlId);
});

test("fake dialCall aplica as MESMAS validações do modo real", async () => {
  const port = provider.createFakeTelnyxPort();
  await assert.rejects(() => port.dialCall(callRequest({ to: "not-e164" })), (e) => e.code === "invalid_request");
  await assert.rejects(() => port.dialCall(callRequest({ connectionId: "" })), (e) => e.code === "invalid_request");
});

test("fake getCallStatus/hangupCall refletem o ciclo de vida de uma dialCall anterior na mesma instância", async () => {
  const port = provider.createFakeTelnyxPort();
  const call = await port.dialCall(callRequest());

  const beforeHangup = await port.getCallStatus(call.callControlId);
  assert.equal(beforeHangup.isAlive, true);
  assert.equal(beforeHangup.endTime, null);

  await port.hangupCall(call.callControlId);
  const afterHangup = await port.getCallStatus(call.callControlId);
  assert.equal(afterHangup.isAlive, false);
  assert.equal(afterHangup.callDurationSeconds, 0);
  assert.notEqual(afterHangup.endTime, null);
});

test("fake getCallStatus/hangupCall com callControlId desconhecido rejeita como provider_rejected", async () => {
  const port = provider.createFakeTelnyxPort();
  await assert.rejects(() => port.getCallStatus("fake_call_nunca_existiu"), (e) => e.code === "provider_rejected" && e.httpStatus === 422);
  await assert.rejects(() => port.hangupCall("fake_call_nunca_existiu"), (e) => e.code === "provider_rejected" && e.httpStatus === 422);
});

test("fake sendMessage/getMessageStatus são determinísticos e coerentes entre si", async () => {
  const port = provider.createFakeTelnyxPort();
  const sent = await port.sendMessage(messageRequest());
  assert.match(sent.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(sent.status, "queued");

  const status = await port.getMessageStatus(sent.id);
  assert.deepEqual(status, sent);

  const otherPort = provider.createFakeTelnyxPort();
  const sentAgain = await otherPort.sendMessage(messageRequest());
  assert.deepEqual(sentAgain, sent);
});

test("fake getMessageStatus valida UUID antes de olhar o estado, e rejeita id desconhecido", async () => {
  const port = provider.createFakeTelnyxPort();
  await assert.rejects(() => port.getMessageStatus("not-a-uuid"), (e) => e.code === "invalid_request");
  await assert.rejects(
    () => port.getMessageStatus("00000000-0000-0000-0000-000000000000"),
    (e) => e.code === "provider_rejected" && e.httpStatus === 404,
  );
});

test("telnyxFakeProvidersEnabled só liga com PORTAL_FAKE_PROVIDERS=1, mesmo padrão de apps/portal/src/lib/knowledge.ts", () => {
  const original = process.env.PORTAL_FAKE_PROVIDERS;
  try {
    delete process.env.PORTAL_FAKE_PROVIDERS;
    assert.equal(provider.telnyxFakeProvidersEnabled(), false);
    process.env.PORTAL_FAKE_PROVIDERS = "true";
    assert.equal(provider.telnyxFakeProvidersEnabled(), false);
    process.env.PORTAL_FAKE_PROVIDERS = "1";
    assert.equal(provider.telnyxFakeProvidersEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.PORTAL_FAKE_PROVIDERS;
    else process.env.PORTAL_FAKE_PROVIDERS = original;
  }
});

// ---------------------------------------------------------------------------
// Webhook: assinatura Ed25519 + janela de replay + parsing de eventos
// ---------------------------------------------------------------------------

function base64UrlToBase64(base64Url) {
  const padded = base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4);
  return padded.replace(/-/g, "+").replace(/_/g, "/");
}

function makeSigner() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  const publicKeyBase64 = base64UrlToBase64(jwk.x);
  function sign(timestamp, rawBody) {
    const message = Buffer.from(`${timestamp}|${rawBody}`, "utf8");
    return cryptoSign(null, message, privateKey).toString("base64");
  }
  return { publicKeyBase64, sign };
}

test("verifyTelnyxWebhookSignature aceita assinatura Ed25519 válida dentro da janela de replay", () => {
  const { publicKeyBase64, sign } = makeSigner();
  const rawBody = JSON.stringify({ data: { event_type: "call.hangup" } });
  const now = 1_700_000_000;
  const signature = sign(String(now), rawBody);
  const ok = provider.verifyTelnyxWebhookSignature(
    publicKeyBase64,
    { timestamp: String(now), signatureEd25519: signature },
    rawBody,
    now,
  );
  assert.equal(ok, true);
});

test("verifyTelnyxWebhookSignature rejeita corpo adulterado, assinatura errada, chave errada e replay fora da janela", () => {
  const { publicKeyBase64, sign } = makeSigner();
  const other = makeSigner();
  const rawBody = JSON.stringify({ data: { event_type: "call.hangup" } });
  const now = 1_700_000_000;
  const signature = sign(String(now), rawBody);

  assert.equal(provider.verifyTelnyxWebhookSignature(publicKeyBase64, { timestamp: String(now), signatureEd25519: signature }, rawBody + "x", now), false);
  assert.equal(provider.verifyTelnyxWebhookSignature(publicKeyBase64, { timestamp: String(now), signatureEd25519: signature }, rawBody, now + 301), false);
  assert.equal(provider.verifyTelnyxWebhookSignature(other.publicKeyBase64, { timestamp: String(now), signatureEd25519: signature }, rawBody, now), false);
  assert.equal(provider.verifyTelnyxWebhookSignature(publicKeyBase64, { timestamp: null, signatureEd25519: signature }, rawBody, now), false);
  assert.equal(provider.verifyTelnyxWebhookSignature(publicKeyBase64, { timestamp: String(now), signatureEd25519: "not-base64!!" }, rawBody, now), false);
  assert.equal(provider.verifyTelnyxWebhookSignature("garbage-not-a-key", { timestamp: String(now), signatureEd25519: signature }, rawBody, now), false);
});

test("parseTelnyxWebhookPublicKey exige exatamente 32 bytes crus em base64 canônico", () => {
  const { publicKeyBase64 } = makeSigner();
  assert.notEqual(provider.parseTelnyxWebhookPublicKey(publicKeyBase64), null);
  assert.equal(provider.parseTelnyxWebhookPublicKey(""), null);
  assert.equal(provider.parseTelnyxWebhookPublicKey("not-base64!!"), null);
  assert.equal(provider.parseTelnyxWebhookPublicKey(Buffer.from("too-short").toString("base64")), null);
});

test("parseTelnyxCallWebhookEvent extrai call_control_id/call_session_id/hangup_cause do envelope oficial", () => {
  const hangup = provider.parseTelnyxCallWebhookEvent({
    data: {
      record_type: "event",
      event_type: "call.hangup",
      id: "0ccc7b54-4df3-4bca-a65a-3da1ecc777f0",
      occurred_at: "2018-02-02T22:25:27.521992Z",
      payload: { call_control_id: "v3:abc", call_session_id: "session-1", hangup_cause: "normal_clearing" },
    },
  });
  assert.deepEqual(hangup, { eventType: "call.hangup", callControlId: "v3:abc", callSessionId: "session-1", hangupCause: "normal_clearing" });

  const answered = provider.parseTelnyxCallWebhookEvent({
    data: { event_type: "call.answered", payload: { call_control_id: "v3:abc", call_session_id: "session-1" } },
  });
  assert.deepEqual(answered, { eventType: "call.answered", callControlId: "v3:abc", callSessionId: "session-1" });

  assert.equal(provider.parseTelnyxCallWebhookEvent({ data: { event_type: "call.unknown_event", payload: {} } }), null);
  assert.equal(provider.parseTelnyxCallWebhookEvent({ data: { event_type: "call.hangup", payload: {} } }), null);
  assert.equal(provider.parseTelnyxCallWebhookEvent(null), null);
  assert.equal(provider.parseTelnyxCallWebhookEvent("not-an-object"), null);
});

test("parseTelnyxMessageWebhookEvent extrai id e status do primeiro destinatário", () => {
  const event = provider.parseTelnyxMessageWebhookEvent({
    data: {
      event_type: "message.finalized",
      payload: { id: "40385f64-5717-4562-b3fc-2c963f66afa6", to: [{ phone_number: "+15550001111", status: "delivered" }] },
    },
  });
  assert.deepEqual(event, { eventType: "message.finalized", messageId: "40385f64-5717-4562-b3fc-2c963f66afa6", status: "delivered" });

  const noStatus = provider.parseTelnyxMessageWebhookEvent({
    data: { event_type: "message.sent", payload: { id: "40385f64-5717-4562-b3fc-2c963f66afa6", to: [] } },
  });
  assert.deepEqual(noStatus, { eventType: "message.sent", messageId: "40385f64-5717-4562-b3fc-2c963f66afa6", status: null });

  assert.equal(provider.parseTelnyxMessageWebhookEvent({ data: { event_type: "message.sent", payload: {} } }), null);
  assert.equal(provider.parseTelnyxMessageWebhookEvent({ data: { event_type: "not.a.real.event", payload: {} } }), null);
});
