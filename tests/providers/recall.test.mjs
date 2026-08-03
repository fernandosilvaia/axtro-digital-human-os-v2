import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const provider = await import(pathToFileURL(join(root, "packages/provider-recall/dist/index.js")).href);

const API_KEY = "test-recall-key-0000000000";

function fakeFetch(handler) {
  const calls = [];
  return { calls, implementation: async (url, init) => { calls.push({ url, init }); return handler(url, init); } };
}

test("createBot envia payload fechado à região configurada e devolve o botId", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify({ id: "bot_abc123" }), { status: 201 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-east-1", fetchImplementation: implementation });
  const result = await port.createBot({ meetingUrl: "https://zoom.us/j/123?pwd=456", botName: "Raissa" });
  assert.deepEqual(result, { botId: "bot_abc123" });
  assert.equal(calls[0].url, "https://us-east-1.recall.ai/api/v1/bot/");
  assert.equal(calls[0].init.headers.Authorization, API_KEY);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.meeting_url, "https://zoom.us/j/123?pwd=456");
  assert.equal(body.bot_name, "Raissa");
  assert.equal(body.join_at, undefined);
  // Teto duro de bot-hora (auditoria 2026-08-02): sem automatic_leave e sem
  // call site de leaveCall, o bot ficava na reunião cobrando indefinidamente.
  assert.deepEqual(body.automatic_leave, {
    waiting_room_timeout: 900,
    noone_joined_timeout: 900,
    everyone_left_timeout: { timeout: 30 },
    in_call_not_recording_timeout: 2400,
  });
});

test("createBot valida meetingUrl (https-only), botName e joinAtIso antes da rede; chave nunca vaza em erro", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(`nope ${API_KEY}`, { status: 401 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-east-1", fetchImplementation: implementation });
  for (const bad of [
    { meetingUrl: "http://zoom.us/j/123" },
    { meetingUrl: "not-a-url" },
    { meetingUrl: "" },
    { meetingUrl: "https://zoom.us/j/123", botName: "" },
    { meetingUrl: "https://zoom.us/j/123", botName: "x".repeat(101) },
    { meetingUrl: "https://zoom.us/j/123", joinAtIso: "amanhã às 10h" },
  ]) {
    await assert.rejects(() => port.createBot(bad), (e) => e.code === "invalid_request");
  }
  assert.equal(calls.length, 0);
  await assert.rejects(() => port.createBot({ meetingUrl: "https://zoom.us/j/123" }), (e) => {
    assert.equal(e.code, "provider_rejected");
    assert.equal(e.message.includes(API_KEY), false);
    return true;
  });
});

test("createBot aceita join_at válido pra agendar o bot sentinela", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify({ id: "bot_sched" }), { status: 201 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-west-2", fetchImplementation: implementation });
  await port.createBot({ meetingUrl: "https://meet.google.com/abc-defg-hij", joinAtIso: "2026-08-01T14:00:00Z" });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.join_at, "2026-08-01T14:00:00Z");
  assert.equal(calls[0].url, "https://us-west-2.recall.ai/api/v1/bot/");
});

test("createBot com outputMediaWebpageUrl já entra de câmera assumida, no formato oficial", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify({ id: "bot_direct" }), { status: 201 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-west-2", fetchImplementation: implementation });
  await port.createBot({ meetingUrl: "https://zoom.us/j/1", outputMediaWebpageUrl: "https://tavus.daily.co/c9bea5b7344f144e" });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.output_media, { camera: { kind: "webpage", config: { url: "https://tavus.daily.co/c9bea5b7344f144e" } } });
});

test("createBot com variant aplica a máquina escolhida aos 3 platforms, no formato oficial", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(JSON.stringify({ id: "bot_big" }), { status: 201 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-west-2", fetchImplementation: implementation });
  await port.createBot({ meetingUrl: "https://zoom.us/j/1", variant: "web_4_core" });
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.variant, { zoom: "web_4_core", google_meet: "web_4_core", microsoft_teams: "web_4_core" });
  // Sem variant, o campo nem viaja (default do provider).
  await port.createBot({ meetingUrl: "https://zoom.us/j/1" });
  assert.equal(JSON.parse(calls[1].init.body).variant, undefined);
});

test("createBot rejeita variant desconhecido antes da rede", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response("{}", { status: 201 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-west-2", fetchImplementation: implementation });
  await assert.rejects(
    () => port.createBot({ meetingUrl: "https://zoom.us/j/1", variant: "web_128_core" }),
    (e) => e.code === "invalid_request",
  );
  assert.equal(calls.length, 0);
});

test("createBot rejeita outputMediaWebpageUrl não-https antes da rede", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(null, { status: 201 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-west-2", fetchImplementation: implementation });
  await assert.rejects(
    () => port.createBot({ meetingUrl: "https://zoom.us/j/1", outputMediaWebpageUrl: "http://not-https.com" }),
    (e) => e.code === "invalid_request",
  );
  assert.equal(calls.length, 0);
});

test("5xx vira provider_unavailable; payload sem id vira malformed; sem chave nem constrói", async () => {
  const down = fakeFetch(async () => new Response("x", { status: 503 }));
  const portDown = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-east-1", fetchImplementation: down.implementation });
  await assert.rejects(() => portDown.createBot({ meetingUrl: "https://zoom.us/j/1" }), (e) => e.code === "provider_unavailable");

  const junk = fakeFetch(async () => new Response(JSON.stringify({ status: "ok" }), { status: 201 }));
  const portJunk = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-east-1", fetchImplementation: junk.implementation });
  await assert.rejects(() => portJunk.createBot({ meetingUrl: "https://zoom.us/j/1" }), (e) => e.code === "malformed_provider_response");

  assert.throws(() => provider.createRecallMeetingBotPort({ apiKey: "", region: "us-east-1" }), (e) => e.code === "missing_api_key");
});

test("startCameraWebpage manda exatamente o formato oficial (camera.kind=webpage, camera.config.url)", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(null, { status: 200 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-east-1", fetchImplementation: implementation });
  await port.startCameraWebpage("550e8400-e29b-41d4-a716-446655440000", "https://tavus.daily.co/c9bea5b7344f144e");
  assert.equal(calls[0].url, "https://us-east-1.recall.ai/api/v1/bot/550e8400-e29b-41d4-a716-446655440000/output_media/");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    camera: { kind: "webpage", config: { url: "https://tavus.daily.co/c9bea5b7344f144e" } },
  });
});

test("startCameraWebpage valida botId e a URL da webpage antes da rede", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(null, { status: 200 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-east-1", fetchImplementation: implementation });
  await assert.rejects(() => port.startCameraWebpage("../evil", "https://x.com"), (e) => e.code === "invalid_request");
  await assert.rejects(() => port.startCameraWebpage("550e8400-e29b-41d4-a716-446655440000", "http://x.com"), (e) => e.code === "invalid_request");
  assert.equal(calls.length, 0);
});

test("stopCameraWebpage manda DELETE com {camera: true}, no formato oficial", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(null, { status: 200 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "eu-central-1", fetchImplementation: implementation });
  await port.stopCameraWebpage("550e8400-e29b-41d4-a716-446655440000");
  assert.equal(calls[0].init.method, "DELETE");
  assert.equal(calls[0].url, "https://eu-central-1.recall.ai/api/v1/bot/550e8400-e29b-41d4-a716-446655440000/output_media/");
  assert.deepEqual(JSON.parse(calls[0].init.body), { camera: true });
});

test("leaveCall chama o endpoint oficial e valida o botId", async () => {
  const { calls, implementation } = fakeFetch(async () => new Response(null, { status: 200 }));
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "ap-northeast-1", fetchImplementation: implementation });
  await port.leaveCall("550e8400-e29b-41d4-a716-446655440000");
  assert.equal(calls[0].url, "https://ap-northeast-1.recall.ai/api/v1/bot/550e8400-e29b-41d4-a716-446655440000/leave_call/");
  assert.equal(calls[0].init.method, "POST");
  await assert.rejects(() => port.leaveCall(""), (e) => e.code === "invalid_request");
});

test("timeout vira provider_timeout sem vazar a chave", async () => {
  const timeoutFetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  const port = provider.createRecallMeetingBotPort({ apiKey: API_KEY, region: "us-east-1", timeoutMs: 5, fetchImplementation: timeoutFetch });
  await assert.rejects(() => port.createBot({ meetingUrl: "https://zoom.us/j/1" }), (e) => e.code === "provider_timeout");
});
