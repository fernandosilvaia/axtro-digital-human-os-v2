import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { test } from "node:test";

const mocks = new Map([
  ["next/server", `
    export class NextRequest {}
    export class NextResponse extends Response {
      static json(body, init) { return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } }); }
    }
  `],
  ["@axtro/domain", `export function createUuidV7() { return "0198a000-0000-7000-8000-000000000099"; }`],
  ["@/lib/http/read-bounded-body", `
    export async function readBoundedTextBody(request, maxBytes) {
      const declared = request.headers.get("content-length");
      if (declared !== null && BigInt(declared) > BigInt(maxBytes)) return { ok: false, reason: "too_large" };
      const reader = request.body?.getReader();
      if (!reader) return { ok: true, text: "", bytes: 0 };
      let bytes = 0; const chunks = [];
      while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > maxBytes) return { ok: false, reason: "too_large" }; chunks.push(value); }
      const merged = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
      return { ok: true, text: new TextDecoder().decode(merged), bytes };
    }
  `],
  ["@/lib/transcripts/tavus-webhook", `
    export function parseTavusTranscriptEvent(body) {
      globalThis.__tavusWebhookRouteState.parserCalls.push("transcript");
      if (body?.event_type !== "application.transcription_ready") return null;
      const turns = body.properties?.transcript ?? [{ role: "user", content: "hello" }];
      if (typeof body.timestamp !== "string") return null;
      return { conversationId: body.conversation_id, observedAt: body.timestamp, turns, hasHumanTurn: turns.some((turn) => turn.role === "user" && turn.content?.trim()), truncated: false };
    }
    export function parseTavusNoDeliveryEvent(body) {
      globalThis.__tavusWebhookRouteState.parserCalls.push("no_delivery");
      if (body?.event_type !== "system.shutdown" || body?.message_type !== "system" || body?.properties?.shutdown_reason !== "participant_absent_timeout reached") return null;
      if (typeof body.timestamp !== "string") return null;
      return { conversationId: body.conversation_id, observedAt: body.timestamp, reason: "participant_absent_timeout reached" };
    }
    export function transcriptAppendWasPersisted(data) { return data?.found === true; }
  `],
  ["@/lib/paid-effects", `
    export async function activateProviderEffectBilling(id) {
      const state = globalThis.__tavusWebhookRouteState;
      state.calls.push({ name: "activateProviderEffectBilling", args: { id } });
      if (state.activationThrows) throw new Error("activation failed");
    }
  `],
  ["@/lib/rate-limit", `
    export function isRateLimited(key, windowMs, maxRequests) {
      const state = globalThis.__tavusWebhookRouteState;
      state.rateLimitCalls.push({ key, windowMs, maxRequests });
      return state.rateLimitedKeys.has(key);
    }
  `],
  ["@/lib/supabase/service", `
    export class ServiceRoleUnavailableError extends Error {}
    export function createServiceRoleClient() {
      const state = globalThis.__tavusWebhookRouteState;
      if (state.clientThrows) throw new ServiceRoleUnavailableError("unavailable");
      return state.supabase;
    }
  `],
  ["@/lib/telemetry", `export function logError() {} export function logEvent() {}`],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mocks.has(specifier)) return { url: `tavus-route-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("tavus-route-mock:")) {
      const specifier = decodeURIComponent(url.slice("tavus-route-mock:".length));
      return { format: "module", source: mocks.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const RESERVATION = "0198a000-0000-7000-8000-000000000010";
const CAPABILITY = "a".repeat(43);
const OBSERVED_AT = "2026-08-13T12:00:00.000Z";
const CAPABILITY_EXPIRES_AT = "2099-08-13T12:30:00.000Z";
const BODY = JSON.stringify({ event_type: "application.transcription_ready", conversation_id: "conversation-123", timestamp: OBSERVED_AT });

function freshState() {
  const state = {
    preflightReceipt: { outcome: "authorized", providerRef: "conversation-123", capabilityExpiresAt: CAPABILITY_EXPIRES_AT },
    preflightError: null,
    claimOutcome: "claimed",
    claimReceipt: null,
    appendData: { found: true },
    appendError: null,
    appendThrows: false,
    deliveryReceipt: { recorded: true, replayed: false, customerDeliveryState: "held" },
    deliveryReceiptError: null,
    noDeliveryReceipt: { voided: true, replayed: false, customerDeliveryState: "voided" },
    noDeliveryReceiptError: null,
    activationThrows: false,
    completeReceipt: true,
    releaseReceipt: true,
    calls: [],
    parserCalls: [],
    rateLimitCalls: [],
    rateLimitedKeys: new Set(),
  };
  state.supabase = {
    async rpc(name, args) {
      state.calls.push({ name, args });
      if (name === "portal_preflight_tavus_webhook_service") return { data: state.preflightReceipt, error: state.preflightError };
      if (name === "portal_claim_tavus_webhook_service") return { data: state.claimReceipt ?? { outcome: state.claimOutcome }, error: null };
      if (name === "portal_append_transcript_turns_service") {
        if (state.appendThrows) throw new Error("database disconnected");
        return { data: state.appendData, error: state.appendError };
      }
      if (name === "portal_record_tavus_customer_delivery_service") return { data: state.deliveryReceipt, error: state.deliveryReceiptError };
      if (name === "portal_record_tavus_no_delivery_service") return { data: state.noDeliveryReceipt, error: state.noDeliveryReceiptError };
      if (name === "portal_complete_tavus_webhook_service") return { data: state.completeReceipt, error: null };
      if (name === "portal_release_tavus_webhook_service") return { data: state.releaseReceipt, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  globalThis.__tavusWebhookRouteState = state;
  return state;
}

function request(body = BODY, capability = CAPABILITY, reservationId = RESERVATION, headers = {}) {
  return {
    nextUrl: new URL(`https://portal.test/api/tavus/webhook?reservationId=${reservationId}&capability=${capability}`),
    headers: new Headers(headers),
    body: new Response(body).body,
  };
}

const { POST } = await import("../../apps/portal/src/app/api/tavus/webhook/route.ts");

test("append RPC error and throw are retryable and release the claimed delivery", { concurrency: false }, async (t) => {
  await t.test("returned error", async () => {
    const state = freshState();
    state.appendError = { message: "write failed" };
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.deepEqual(state.calls.map((call) => call.name), [
      "portal_preflight_tavus_webhook_service",
      "portal_claim_tavus_webhook_service",
      "portal_append_transcript_turns_service",
      "portal_release_tavus_webhook_service",
    ]);
  });
  await t.test("throw", async () => {
    const state = freshState();
    state.appendThrows = true;
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.equal(state.calls.at(-1).name, "portal_release_tavus_webhook_service");
  });
});

test("found=false is retryable and never completes the delivery", { concurrency: false }, async () => {
  const state = freshState();
  state.appendData = { found: false };
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "transcript_placeholder_not_ready");
  assert.equal(state.calls.some((call) => call.name === "portal_complete_tavus_webhook_service"), false);
  assert.equal(state.calls.at(-1).name, "portal_release_tavus_webhook_service");
});

test("durable replay returns success without appending again", { concurrency: false }, async () => {
  const state = freshState();
  state.claimOutcome = "replayed";
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, handled: true, replayed: true });
  assert.deepEqual(state.calls.map((call) => call.name), [
    "portal_preflight_tavus_webhook_service",
    "portal_claim_tavus_webhook_service",
  ]);
});

test("digest conflict is 409 and capability/conversation mismatch is 401", { concurrency: false }, async (t) => {
  await t.test("conflict", async () => {
    const state = freshState();
    state.claimOutcome = "conflict";
    const response = await POST(request());
    assert.equal(response.status, 409);
    assert.deepEqual(state.calls.map((call) => call.name), [
      "portal_preflight_tavus_webhook_service",
      "portal_claim_tavus_webhook_service",
    ]);
  });
  await t.test("capability bound to another conversation", async () => {
    const state = freshState();
    const body = JSON.stringify({ event_type: "application.transcription_ready", conversation_id: "conversation-other", timestamp: OBSERVED_AT });
    const response = await POST(request(body));
    assert.equal(response.status, 401);
    assert.deepEqual(state.calls.map((call) => call.name), ["portal_preflight_tavus_webhook_service"]);
    assert.equal(state.calls.some((call) => call.name === "portal_append_transcript_turns_service"), false);
  });
});

test("oversized Content-Length returns 413 before the body stream or database is touched", { concurrency: false }, async () => {
  const state = freshState();
  let bodyTouched = false;
  const oversized = request(BODY, CAPABILITY, RESERVATION, { "content-length": String(5 * 1024 * 1024 + 1) });
  Object.defineProperty(oversized, "body", { get() { bodyTouched = true; throw new Error("body must not be acquired"); } });
  const response = await POST(oversized);
  assert.equal(response.status, 413);
  assert.equal(bodyTouched, false);
  assert.equal(state.calls.length, 0);
  assert.equal(state.rateLimitCalls.length, 0);
});

test("invalid query and malformed Content-Length fail before rate limiting, database or body acquisition", { concurrency: false }, async (t) => {
  await t.test("invalid query", async () => {
    const state = freshState();
    let bodyTouched = false;
    const invalid = request(BODY, "short", "not-a-reservation");
    Object.defineProperty(invalid, "body", { get() { bodyTouched = true; throw new Error("body must not be acquired"); } });
    const response = await POST(invalid);
    assert.equal(response.status, 401);
    assert.equal(bodyTouched, false);
    assert.equal(state.calls.length, 0);
    assert.equal(state.rateLimitCalls.length, 0);
  });
  await t.test("malformed Content-Length", async () => {
    const state = freshState();
    let bodyTouched = false;
    const invalid = request(BODY, CAPABILITY, RESERVATION, { "content-length": "01" });
    Object.defineProperty(invalid, "body", { get() { bodyTouched = true; throw new Error("body must not be acquired"); } });
    const response = await POST(invalid);
    assert.equal(response.status, 400);
    assert.equal(bodyTouched, false);
    assert.equal(state.calls.length, 0);
    assert.equal(state.rateLimitCalls.length, 0);
  });
});

test("strict completion receipt is required for success", { concurrency: false }, async () => {
  const state = freshState();
  state.completeReceipt = false;
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal(state.calls.at(-1).name, "portal_release_tavus_webhook_service");
});

test("claim requires the exact atomic outcome receipt before any transcript effect", { concurrency: false }, async () => {
  const state = freshState();
  state.claimReceipt = { outcome: "claimed", extra: true };
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "dedupe_unavailable");
  assert.deepEqual(state.calls.map((call) => call.name), [
    "portal_preflight_tavus_webhook_service",
    "portal_claim_tavus_webhook_service",
  ]);
});

test("first transcript with a non-empty user turn records delivery then activates billing exactly once", { concurrency: false }, async () => {
  const state = freshState();
  const response = await POST(request(JSON.stringify({
    event_type: "application.transcription_ready",
    conversation_id: "conversation-123",
    timestamp: OBSERVED_AT,
    properties: { transcript: [{ role: "assistant", content: "Olá" }, { role: "user", content: "Oi" }] },
  })));
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.map((call) => call.name), [
    "portal_preflight_tavus_webhook_service",
    "portal_claim_tavus_webhook_service",
    "portal_append_transcript_turns_service",
    "portal_record_tavus_customer_delivery_service",
    "activateProviderEffectBilling",
    "portal_complete_tavus_webhook_service",
  ]);
  assert.equal(state.calls[1].args.p_observed_at, OBSERVED_AT);
  assert.equal(state.calls[3].args.p_provider_ref, "conversation-123");
  assert.equal(state.calls[3].args.p_event_type, "application.transcription_ready");
  assert.equal(state.calls[3].args.p_observed_at, OBSERVED_AT);
});

test("preflight rejects unauthorized, not-ready, terminal replay, invalid and expired receipts without acquiring or parsing the body", { concurrency: false }, async (t) => {
  const cases = [
    { name: "random capability", receipt: { outcome: "unauthorized" }, status: 401, response: { error: "unauthorized" } },
    { name: "reservation not ready", receipt: { outcome: "not_ready" }, status: 503, response: { error: "delivery_not_ready" } },
    { name: "terminal replay", receipt: { outcome: "replayed_terminal" }, status: 200, response: { ok: true, handled: true, replayed: true } },
    { name: "invalid receipt shape", receipt: { outcome: "authorized", providerRef: "conversation-123", capabilityExpiresAt: CAPABILITY_EXPIRES_AT, extra: true }, status: 503, response: { error: "preflight_unavailable" } },
    { name: "expired capability", receipt: { outcome: "authorized", providerRef: "conversation-123", capabilityExpiresAt: "2020-01-01T00:00:00.000Z" }, status: 401, response: { error: "unauthorized" } },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const state = freshState();
      state.preflightReceipt = scenario.receipt;
      let bodyTouched = false;
      const guarded = request();
      Object.defineProperty(guarded, "body", { get() { bodyTouched = true; throw new Error("body must not be acquired"); } });
      const response = await POST(guarded);
      assert.equal(response.status, scenario.status);
      assert.deepEqual(await response.json(), scenario.response);
      assert.equal(bodyTouched, false);
      assert.deepEqual(state.parserCalls, []);
      assert.deepEqual(state.calls.map((call) => call.name), ["portal_preflight_tavus_webhook_service"]);
    });
  }
});

test("fixed global and capability-hash limits reject before database and body acquisition", { concurrency: false }, async (t) => {
  await t.test("global", async () => {
    const state = freshState();
    state.rateLimitedKeys.add("tavus-webhook:global");
    let bodyTouched = false;
    const guarded = request();
    Object.defineProperty(guarded, "body", { get() { bodyTouched = true; throw new Error("body must not be acquired"); } });
    const response = await POST(guarded);
    assert.equal(response.status, 429);
    assert.equal(bodyTouched, false);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.rateLimitCalls.map((call) => call.key), ["tavus-webhook:global"]);
  });
  await t.test("capability hash", async () => {
    const state = freshState();
    const hashKey = `tavus-webhook:capability:${createHash("sha256").update(CAPABILITY).digest("hex")}`;
    state.rateLimitedKeys.add(hashKey);
    let bodyTouched = false;
    const guarded = request();
    Object.defineProperty(guarded, "body", { get() { bodyTouched = true; throw new Error("body must not be acquired"); } });
    const response = await POST(guarded);
    assert.equal(response.status, 429);
    assert.equal(bodyTouched, false);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.rateLimitCalls.map((call) => call.key), ["tavus-webhook:global", hashKey]);
    assert.equal(state.rateLimitCalls[1].key.includes(CAPABILITY), false);
  });
});

test("authorized chunked bodies are acquired only after preflight and preserve the observed timestamp in the atomic claim", { concurrency: false }, async () => {
  const state = freshState();
  const encoder = new TextEncoder();
  const midpoint = Math.floor(BODY.length / 2);
  const chunkedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(BODY.slice(0, midpoint)));
      controller.enqueue(encoder.encode(BODY.slice(midpoint)));
      controller.close();
    },
  });
  const chunked = request();
  Object.defineProperty(chunked, "body", {
    get() {
      state.calls.push({ name: "body_acquired", args: {} });
      return chunkedBody;
    },
  });
  const response = await POST(chunked);
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.slice(0, 3).map((call) => call.name), [
    "portal_preflight_tavus_webhook_service",
    "body_acquired",
    "portal_claim_tavus_webhook_service",
  ]);
  const claim = state.calls.find((call) => call.name === "portal_claim_tavus_webhook_service");
  assert.equal(claim.args.p_observed_at, OBSERVED_AT);
  assert.match(claim.args.p_payload_digest, /^[0-9a-f]{64}$/);
});

test("placeholder, replica ready and assistant-only transcript never activate customer billing", { concurrency: false }, async (t) => {
  await t.test("replica ready is ignored before claim", async () => {
    const state = freshState();
    const response = await POST(request(JSON.stringify({ event_type: "system.replica_joined", conversation_id: "conversation-123", timestamp: OBSERVED_AT })));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, handled: false });
    assert.deepEqual(state.calls.map((call) => call.name), ["portal_preflight_tavus_webhook_service"]);
  });
  await t.test("final assistant-only transcript is persisted and voided without billing", async () => {
    const state = freshState();
    const response = await POST(request(JSON.stringify({
      event_type: "application.transcription_ready",
      conversation_id: "conversation-123",
      timestamp: OBSERVED_AT,
      properties: { transcript: [{ role: "assistant", content: "Olá, estou pronta." }] },
    })));
    assert.equal(response.status, 200);
    assert.equal(state.calls.some((call) => call.name === "portal_record_tavus_customer_delivery_service"), false);
    assert.equal(state.calls.some((call) => call.name === "activateProviderEffectBilling"), false);
    const noDelivery = state.calls.find((call) => call.name === "portal_record_tavus_no_delivery_service");
    assert.equal(noDelivery.args.p_reason, "transcript_without_user_turn");
  });
});

test("participant_absent_timeout creates a durable no-delivery receipt and no billing outbox", { concurrency: false }, async () => {
  const state = freshState();
  const body = JSON.stringify({
    event_type: "system.shutdown",
    message_type: "system",
    conversation_id: "conversation-123",
    timestamp: OBSERVED_AT,
    properties: { shutdown_reason: "participant_absent_timeout reached" },
  });
  const response = await POST(request(body));
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.map((call) => call.name), [
    "portal_preflight_tavus_webhook_service",
    "portal_claim_tavus_webhook_service",
    "portal_record_tavus_no_delivery_service",
    "portal_complete_tavus_webhook_service",
  ]);
  assert.equal(state.calls[2].args.p_reason, "participant_absent_timeout reached");
});

test("delivery receipt and billing activation failures are retryable and never complete", { concurrency: false }, async (t) => {
  await t.test("receipt conflict/error", async () => {
    const state = freshState();
    state.deliveryReceiptError = { message: "conflict" };
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "delivery_receipt_pending");
    assert.equal(state.calls.at(-1).name, "portal_release_tavus_webhook_service");
  });
  await t.test("activation failure", async () => {
    const state = freshState();
    state.activationThrows = true;
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "billing_activation_pending");
    assert.equal(state.calls.at(-1).name, "portal_release_tavus_webhook_service");
  });
});
