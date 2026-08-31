import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

const mockSources = new Map([
  ["next/server", `
    export class NextRequest {}
    export class NextResponse extends Response {
      static json(body, init) { return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } }); }
    }
  `],
  ["@axtro/domain", `
    export function createUuidV7() { return globalThis.__recallWebhookTestState.nextUuid(); }
  `],
  ["@axtro/provider-recall", `
    export function parseRecallTranscriptDownloadHosts() { return ["download.test"]; }
    export function createRecallMeetingBotPort() {
      const state = globalThis.__recallWebhookTestState;
      state.calls.recallFactories += 1;
      return {
        async startCameraWebpage(botId, url) {
          state.calls.startCamera.push({ botId, url });
          if (state.startCameraFailures > 0) { state.startCameraFailures -= 1; throw new Error("camera unavailable"); }
        },
        async fetchTranscriptMetadata(transcriptId, botId) {
          state.calls.fetchTranscript.push({ transcriptId, botId });
          if (state.transcriptProviderThrows) throw new Error("provider unavailable");
          return { downloadUrl: "https://download.test/transcript.json" };
        },
        async downloadTranscript(url) {
          state.calls.downloadTranscript.push(url);
          return [{ participantName: "Lead", text: "Olá" }];
        },
      };
    }
  `],
  ["@axtro/provider-tavus", `
    export function createTavusVideoConversationPort() {
      const state = globalThis.__recallWebhookTestState;
      state.calls.tavusFactories += 1;
      return {
        async createConversation(input) {
          state.calls.createConversation.push(input);
          return { conversationId: "conversation-123", conversationUrl: "https://tavus.daily.co/room-123" };
        },
        async endConversation(id) { state.calls.endConversation.push(id); },
      };
    }
  `],
  ["@/lib/meetings/stage", `
    export async function prepareAgentFaceStage(input) {
      const state = globalThis.__recallWebhookTestState;
      state.calls.stageCapabilities.push(input);
      if (state.stageCapabilityFails) throw new Error("stage capability failed");
      return { stageUrl: "https://portal.test/rosto-agente?cap=" + "c".repeat(32), expiresAt: "2099-08-13T12:45:00.000Z" };
    }
  `],
  ["@/lib/http/read-bounded-body", `
    export async function readBoundedTextBody(request, maxBytes) {
      const length = Number(request.headers.get("content-length") ?? "0");
      if (length > maxBytes) return { ok: false, reason: "too_large" };
      const text = await request.text();
      if (Buffer.byteLength(text) > maxBytes) return { ok: false, reason: "too_large" };
      return { ok: true, text, bytes: Buffer.byteLength(text) };
    }
  `],
  ["@/lib/meetings/webhook", `
    export function isRecallWebhookSecretConfigured(secret) { return secret === "whsec_valid_for_route_test"; }
    export function verifyRecallWebhookSignature() { return globalThis.__recallWebhookTestState.signatureValid; }
    export function parseRecallTranscriptDonePayload(body) {
      return body?.event === "transcript.done" && body.data?.bot?.id && body.data?.transcript?.id
        ? { botId: body.data.bot.id, transcriptId: body.data.transcript.id }
        : null;
    }
    export function parseRecallWebhookPayload(body) {
      return body && typeof body.event === "string" && body.data?.bot?.id
        ? { event: body.event, botId: body.data.bot.id }
        : null;
    }
    export function statusForRecallEvent(event) {
      if (event === "bot.in_call_recording") return "in_call";
      if (event === "bot.done") return "ended";
      return null;
    }
  `],
  ["@/lib/supabase/service", `
    export class ServiceRoleUnavailableError extends Error {}
    export function createServiceRoleClient() { return globalThis.__recallWebhookTestState.supabase; }
  `],
  ["@/lib/runtime/portal-channel-runtime-bridge", `
    export async function assertPortalChannelActive(input) {
      const state = globalThis.__recallWebhookTestState;
      state.calls.runtimeStatus.push(input);
      return state.runtimeStatusRejected
        ? { outcome: "rejected", code: "kill_switch_active" }
        : { outcome: "active", code: "admitted", status: { active: true, generationId: 0 } };
    }
    export async function assertPortalProviderDispatchActive(input) {
      const state = globalThis.__recallWebhookTestState;
      state.calls.runtimeDispatch.push(input);
      return state.runtimeDispatchRejected
        ? { outcome: "rejected", code: "grant_consumed" }
        : { outcome: "consumed", code: "admitted" };
    }
    export async function bindPortalProviderChannel(input) {
      const state = globalThis.__recallWebhookTestState;
      state.calls.runtimeBindings.push(input);
      return state.runtimeBindingRejected
        ? { outcome: "rejected", code: "kill_switch_active" }
        : { outcome: "bound", code: "bound" };
    }
  `],
  ["@/lib/telemetry", `
    export function logError() {}
    export function logEvent() {}
  `],
  ["@/lib/email", `
    export async function sendMeetingEndedEmail(input) {
      globalThis.__recallWebhookTestState.calls.notifications.push(input);
    }
  `],
  ["@/lib/transcripts/register", `
    export async function prepareTavusWebhookCallback(id) {
      const state = globalThis.__recallWebhookTestState;
      state.calls.capabilityBind.push(id);
      if (state.capabilityBindFails) throw new Error("bind failed");
      if (state.capabilityFenceWon) throw new Error("fence already owned");
      state.capabilityFenceWon = true;
      return { callbackUrl: "https://portal.test/api/tavus/webhook?reservationId=" + id + "&capability=" + "a".repeat(43), capabilityHash: "b".repeat(64) };
    }
    export async function registerTranscriptPlaceholder(tenantId, agentId, surface, externalRef) {
      const state = globalThis.__recallWebhookTestState;
      state.calls.placeholders.push({ tenantId, agentId, surface, externalRef });
      return !state.placeholderFails;
    }
  `],
  ["@/lib/paid-effects", `
    export function stableEffectKey() { return "effect:sentinel-test"; }
    export async function beginProviderEffect(input) {
      const state = globalThis.__recallWebhookTestState;
      state.calls.beginProviderEffect.push(input);
      if (state.reservationOutcome === "capped") return { outcome: "capped", reservationId: null, state: null };
      if (state.reservationOutcome === "blocked_unknown") return { outcome: "blocked_unknown", reservationId: "0198a000-0000-7000-8000-000000000010", state: "unknown" };
      return { outcome: "reserved", reservationId: "0198a000-0000-7000-8000-000000000010", state: "reserved", providerRef: null, providerUrl: null };
    }
    export async function retryReleasedProviderEffect(_input, reservation) { return reservation; }
    export async function commitProviderEffect(id, ref, url) { globalThis.__recallWebhookTestState.calls.commit.push({ id, ref, url }); }
    export async function fenceProviderFailure() {}
    export async function markCleanupPending(id, ref, code) {
      const state = globalThis.__recallWebhookTestState;
      state.calls.cleanup.push({ id, ref, code });
      if (state.cleanupFails) throw new Error("cleanup receipt missing");
    }
    export async function voidUnleasedBillingUsage(id, reason) {
      const state = globalThis.__recallWebhookTestState;
      state.calls.billingVoid.push({ id, reason });
      if (state.billingVoidFails) throw new Error("billing void receipt missing");
    }
    export function stableProviderReconciliationReceiptId() { return "0198a000-0000-7000-8000-000000000099"; }
    export async function reconcileProviderEffect(receiptId, id, evidence, receiptRef) { globalThis.__recallWebhookTestState.calls.reconcile.push({ receiptId, id, evidence, receiptRef }); }
    export async function releaseProviderEffect(id, reason) { globalThis.__recallWebhookTestState.calls.providerRelease.push({ id, reason }); }
    export async function activateProviderEffectBilling(id) {
      const state = globalThis.__recallWebhookTestState;
      state.calls.billingActivate.push(id);
      if (state.billingActivationFailures > 0) { state.billingActivationFailures -= 1; throw new Error("activation receipt missing"); }
      state.sentinel = id === state.sentinel.recallReservationId
        ? { ...state.sentinel, recallCustomerDeliveryState: "activated" }
        : { ...state.sentinel, customerDeliveryState: "activated" };
    }
  `],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mockSources.has(specifier)) return { url: `recall-route-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("recall-route-mock:")) {
      const specifier = decodeURIComponent(url.slice("recall-route-mock:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

let uuidCounter = 0;

function freshState() {
  const state = {
    signatureValid: true,
    reservationOutcome: "reserved",
    capabilityFenceWon: false,
    transcriptAppendFound: true,
    transcriptAppendError: null,
    transcriptProviderThrows: false,
    runtimeStatusRejected: false,
    runtimeDispatchRejected: false,
    runtimeBindingRejected: false,
    startCameraFailures: 0,
    statusApplied: true,
    notificationClaimResults: [true],
    notificationClaimError: null,
    meetingSession: null,
    completeReceipt: true,
    releaseReceipt: true,
    sentinel: {
      outcome: "ready",
      tenantId: "0198a000-0000-7000-8000-000000000001",
      agentId: "0198a000-0000-7000-8000-000000000002",
      state: "not_requested",
      recallReservationId: "0198a000-0000-7000-8000-000000000020",
      recallCustomerDeliveryState: "held",
      runtimeGrantId: "0198a000-0000-7000-8000-000000000030",
      runtimeSessionId: "0198a000-0000-7000-8000-000000000031",
      runtimePresenterId: "0198a000-0000-7000-8000-000000000032",
      runtimeGeneration: 0,
      runtimeCommandFingerprint: "a".repeat(64),
      runtimeCapabilities: ["recording", "persistent_transcription", "behavioral_analysis", "visual_analysis", "scene_presentation"],
      runtimeChannel: "recall_meeting",
    },
    calls: {
      rpc: [], recallFactories: 0, tavusFactories: 0, startCamera: [], createConversation: [], endConversation: [],
      beginProviderEffect: [], capabilityBind: [], placeholders: [], commit: [], cleanup: [], providerRelease: [], billingVoid: [], billingActivate: [], reconcile: [], fetchTranscript: [], downloadTranscript: [],
      stageCapabilities: [], runtimeStatus: [], runtimeDispatch: [], runtimeBindings: [], notifications: [],
    },
    nextUuid() {
      uuidCounter += 1;
      return `0198a000-0000-7000-8000-${String(uuidCounter).padStart(12, "0")}`;
    },
  };

  state.supabase = {
    async rpc(name, args) {
      state.calls.rpc.push({ name, args });
      if (name === "portal_claim_recall_webhook_service") return { data: { outcome: "claimed" }, error: null };
      if (name === "portal_runtime_channel_status_service") return { data: { enabled: true }, error: null };
      if (name === "portal_consume_runtime_channel_grant_service") return { data: { outcome: "acquired" }, error: null };
      if (name === "portal_bind_runtime_provider_channel_service") return { data: true, error: null };
      if (name === "portal_get_meeting_bot_agent_service") return { data: { agentName: "Raissa" }, error: null };
      if (name === "portal_append_transcript_turns_service") return { data: { found: state.transcriptAppendFound }, error: state.transcriptAppendError };
      if (name === "portal_update_meeting_bot_session_status_service") return { data: state.statusReceipt ?? { found: true, applied: state.statusApplied }, error: null };
      if (name === "portal_claim_meeting_terminal_notification_service") {
        return {
          data: state.notificationClaimResults.length > 1
            ? state.notificationClaimResults.shift()
            : state.notificationClaimResults[0] ?? false,
          error: state.notificationClaimError,
        };
      }
      if (name === "portal_list_admin_emails_service") return { data: ["admin@example.test"], error: null };
      if (name === "portal_get_sentinel_attach_service") return { data: { ...state.sentinel }, error: null };
      if (name === "portal_mark_sentinel_conversation_created_service") {
        state.sentinel = { ...state.sentinel, state: "conversation_created", reservationId: args.p_reservation_id, conversationId: args.p_conversation_id, conversationUrl: "https://tavus.daily.co/room-123" };
        return { data: { outcome: state.persistOutcome ?? "persisted" }, error: null };
      }
      if (name === "portal_mark_sentinel_camera_started_service") {
        state.sentinel = { ...state.sentinel, state: "camera_started" };
        return { data: state.cameraStartedReceipt ?? true, error: null };
      }
      if (name === "portal_complete_recall_webhook_service") return { data: state.completeReceipt, error: null };
      if (name === "portal_release_recall_webhook_service") return { data: state.releaseReceipt, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() {
          if (table === "agent_video_config") return { data: { tavus_persona_id: "persona-123", language: "english" }, error: null };
          if (table === "agents") return { data: { name: "Raissa" }, error: null };
          if (table === "meeting_bot_sessions") return { data: state.meetingSession, error: null };
          if (table === "tenants") return { data: { legal_name: "Tenant Test" }, error: null };
          throw new Error(`unexpected table ${table}`);
        },
      };
      return query;
    },
  };
  globalThis.__recallWebhookTestState = state;
  return state;
}

process.env.RECALL_WEBHOOK_SECRET = "whsec_valid_for_route_test";
process.env.RECALL_API_KEY = "recall-test-key";
process.env.RECALL_API_REGION = "us-west-2";
process.env.RECALL_TRANSCRIPT_DOWNLOAD_HOSTS = "download.test";
process.env.TAVUS_API_KEY = "tavus-test-key";
process.env.PORTAL_RUNTIME_BRIDGE_ENABLED = "true";

const { POST } = await import("../../apps/portal/src/app/api/recall/webhook/route.ts");
const BOT_ID = "550e8400-e29b-41d4-a716-446655440000";

function request(deliveryId, event = "bot.in_call_recording") {
  const body = JSON.stringify(event === "transcript.done"
    ? { event, data: { bot: { id: BOT_ID }, transcript: { id: "transcript-123" } } }
    : { event, data: { bot: { id: BOT_ID } } });
  return {
    headers: new Headers({ "webhook-id": deliveryId, "webhook-timestamp": "1", "webhook-signature": "v1,test" }),
    body: new Response(body).body,
    async text() { return body; },
  };
}

test("a distinct replay resumes conversation_created after attach failure without a second Tavus create", { concurrency: false }, async () => {
  const state = freshState();
  state.startCameraFailures = 1;

  const first = await POST(request("delivery-first"));
  assert.equal(first.status, 503);
  assert.equal((await first.json()).error, "sentinel_attach_pending");
  assert.equal(state.sentinel.state, "conversation_created");
  assert.equal(state.calls.createConversation.length, 1);

  state.statusApplied = false;
  const second = await POST(request("delivery-second"));
  assert.equal(second.status, 200);
  assert.equal(state.sentinel.state, "camera_started");
  assert.equal(state.calls.createConversation.length, 1, "replay must resume the saved conversation");
  assert.equal(state.calls.startCamera.length, 2);
});

test("a terminal status replay never constructs or calls Tavus", { concurrency: false }, async () => {
  const state = freshState();
  state.statusApplied = false;
  state.sentinel = { outcome: "terminal" };

  const response = await POST(request("delivery-terminal"));
  assert.equal(response.status, 200);
  assert.equal(state.calls.tavusFactories, 0);
  assert.equal(state.calls.createConversation.length, 0);
  assert.equal(state.calls.startCamera.length, 0);
});

test("a Recall delivery without a durable runtime binding cannot create a Tavus camera", { concurrency: false }, async () => {
  const state = freshState();
  state.sentinel = { ...state.sentinel };
  delete state.sentinel.runtimeGrantId;
  delete state.sentinel.runtimeSessionId;
  delete state.sentinel.runtimePresenterId;
  delete state.sentinel.runtimeGeneration;
  delete state.sentinel.runtimeCommandFingerprint;
  delete state.sentinel.runtimeCapabilities;
  delete state.sentinel.runtimeChannel;

  const response = await POST(request("delivery-without-runtime-binding"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "sentinel_attach_pending" });
  assert.equal(state.calls.beginProviderEffect.length, 0);
  assert.equal(state.calls.createConversation.length, 0);
  assert.equal(state.calls.startCamera.length, 0);
  assert.equal(state.calls.rpc.at(-1).name, "portal_release_recall_webhook_service");
});

test("a terminal race ends known Tavus and persists void plus reconciliation receipts", { concurrency: false }, async () => {
  const state = freshState();
  state.persistOutcome = "terminal";

  const response = await POST(request("delivery-terminal-race"));
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.endConversation, ["conversation-123"]);
  assert.equal(state.calls.cleanup.length, 1);
  assert.equal(state.calls.billingVoid.length, 1);
  assert.deepEqual(state.calls.reconcile, [{
    receiptId: "0198a000-0000-7000-8000-000000000099",
    id: "0198a000-0000-7000-8000-000000000010",
    evidence: "compensation_confirmed",
    receiptRef: "tavus:end:conversation-123",
  }]);
  assert.equal(state.calls.startCamera.length, 0);
});

test("camera_started replay retries billing activation without another create or camera command", { concurrency: false }, async () => {
  const state = freshState();
  state.billingActivationFailures = 1;

  const first = await POST(request("delivery-activation-first"));
  assert.equal(first.status, 503);
  assert.equal(state.sentinel.state, "camera_started");
  assert.equal(state.calls.createConversation.length, 1);
  assert.equal(state.calls.startCamera.length, 1);
  assert.equal(state.calls.billingActivate.length, 1);

  state.statusApplied = false;
  const second = await POST(request("delivery-activation-retry"));
  assert.equal(second.status, 200);
  assert.equal(state.calls.createConversation.length, 1);
  assert.equal(state.calls.startCamera.length, 1);
  assert.deepEqual(state.calls.billingActivate, [
    "0198a000-0000-7000-8000-000000000020",
    "0198a000-0000-7000-8000-000000000020",
    "0198a000-0000-7000-8000-000000000010",
  ]);
  assert.equal(state.sentinel.customerDeliveryState, "activated");
});

test("terminal compensation still ends Tavus when billing void is unsafe, but returns retryable", { concurrency: false }, async () => {
  const state = freshState();
  state.persistOutcome = "terminal";
  state.billingVoidFails = true;

  const response = await POST(request("delivery-terminal-billing-race"));
  assert.equal(response.status, 503);
  assert.deepEqual(state.calls.endConversation, ["conversation-123"]);
  assert.equal(state.calls.reconcile.length, 0);
});

test("terminal compensation still ends Tavus when cleanup persistence is unavailable", { concurrency: false }, async () => {
  const state = freshState();
  state.persistOutcome = "terminal";
  state.cleanupFails = true;

  const response = await POST(request("delivery-terminal-cleanup-race"));
  assert.equal(response.status, 503);
  assert.deepEqual(state.calls.endConversation, ["conversation-123"]);
  assert.equal(state.calls.reconcile.length, 0);
});

test("false boolean receipts never produce webhook success", { concurrency: false }, async (t) => {
  await t.test("camera mark receipt", async () => {
    const state = freshState();
    state.sentinel = { ...state.sentinel, state: "conversation_created", reservationId: "0198a000-0000-7000-8000-000000000010", conversationId: "conversation-123", conversationUrl: "https://tavus.daily.co/room-123" };
    state.cameraStartedReceipt = false;
    const response = await POST(request("delivery-false-mark"));
    assert.equal(response.status, 503);
  });

  await t.test("completion receipt", async () => {
    const state = freshState();
    state.sentinel = { outcome: "terminal" };
    state.completeReceipt = false;
    const response = await POST(request("delivery-false-complete"));
    assert.equal(response.status, 503);
  });

  await t.test("release receipt", async () => {
    const state = freshState();
    state.startCameraFailures = 1;
    state.releaseReceipt = false;
    const response = await POST(request("delivery-false-release"));
    assert.equal(response.status, 503);
  });
});

test("signed HMAC is mandatory and query bearer tokens are ignored", { concurrency: false }, async () => {
  const state = freshState();
  state.signatureValid = false;
  const response = await POST(request("delivery-unsigned"));
  assert.equal(response.status, 401);
  assert.equal(state.calls.rpc.length, 0);
});

test("oversized declared body is rejected before signature, claim or provider work", { concurrency: false }, async () => {
  const state = freshState();
  const oversized = request("delivery-oversized");
  oversized.headers.set("content-length", String(64 * 1024 + 1));
  const response = await POST(oversized);
  assert.equal(response.status, 413);
  assert.equal(state.calls.rpc.length, 0);
  assert.equal(state.calls.createConversation.length, 0);
});

test("sentinel requires capability fence and transcript placeholder before camera", { concurrency: false }, async () => {
  const state = freshState();
  const response = await POST(request("delivery-capability"));
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.capabilityBind, ["0198a000-0000-7000-8000-000000000010"]);
  assert.equal(state.calls.createConversation[0].callbackUrl.includes("capability="), true);
  assert.deepEqual(state.calls.placeholders, [{
    tenantId: "0198a000-0000-7000-8000-000000000001",
    agentId: "0198a000-0000-7000-8000-000000000002",
    surface: "video",
    externalRef: "conversation-123",
  }]);
  assert.deepEqual(state.calls.stageCapabilities, [{
    tenantId: "0198a000-0000-7000-8000-000000000001",
    agentId: "0198a000-0000-7000-8000-000000000002",
    reservationId: "0198a000-0000-7000-8000-000000000010",
    roomUrl: "https://tavus.daily.co/room-123",
  }]);
  assert.match(state.calls.startCamera[0].url, /\/rosto-agente\?cap=[A-Za-z0-9_-]{32}$/);
  assert.equal(state.calls.startCamera[0].url.includes("tavus.daily.co"), false);
  assert.equal(state.calls.startCamera[0].url.includes("sala="), false);
});

test("sentinel cap is a handled no-spend response; unknown is retryable with zero provider work", { concurrency: false }, async (t) => {
  await t.test("capped", async () => {
    const state = freshState();
    state.reservationOutcome = "capped";
    const response = await POST(request("delivery-capped"));
    assert.equal(response.status, 200);
    assert.equal(state.calls.createConversation.length, 0);
    assert.equal(state.calls.startCamera.length, 0);
  });
  await t.test("blocked unknown", async () => {
    const state = freshState();
    state.reservationOutcome = "blocked_unknown";
    const response = await POST(request("delivery-blocked"));
    assert.equal(response.status, 503);
    assert.equal(state.calls.createConversation.length, 0);
    assert.equal(state.calls.startCamera.length, 0);
  });
});

test("a claimed Recall delivery with a capped Tavus reservation completes without Tavus dispatch", { concurrency: false }, async () => {
  const state = freshState();
  state.reservationOutcome = "capped";

  const response = await POST(request("delivery-capped-after-recall-claim"));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, handled: true });
  assert.deepEqual(state.calls.beginProviderEffect, [{
    tenantId: "0198a000-0000-7000-8000-000000000001",
    agentId: "0198a000-0000-7000-8000-000000000002",
    provider: "tavus",
    idempotencyKey: "effect:sentinel-test",
    relatedRef: BOT_ID,
    maxDurationSeconds: 1800,
  }]);
  assert.equal(state.calls.createConversation.length, 0);
  assert.equal(state.calls.commit.length, 0);
  assert.equal(state.calls.billingActivate.length, 0, "the held Recall effect is not activated when Tavus is capped");
  assert.equal(state.calls.rpc.some((call) => call.name === "portal_release_recall_webhook_service"), false);
  assert.equal(state.calls.rpc.at(-1).name, "portal_complete_recall_webhook_service");
});

test("a claimed Recall delivery retries when the Tavus capability fence is already owned", { concurrency: false }, async () => {
  const state = freshState();
  state.capabilityFenceWon = true;

  const response = await POST(request("delivery-capability-fence-lost"));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "sentinel_attach_pending" });
  assert.deepEqual(state.calls.capabilityBind, ["0198a000-0000-7000-8000-000000000010"]);
  assert.equal(state.calls.createConversation.length, 0);
  assert.equal(state.calls.commit.length, 0);
  assert.equal(state.calls.rpc.at(-1).name, "portal_release_recall_webhook_service");
});

test("concurrent sentinel deliveries have one capability fence winner and at most one Tavus create", { concurrency: false }, async () => {
  const state = freshState();
  const [first, second] = await Promise.all([
    POST(request("delivery-concurrent-a")),
    POST(request("delivery-concurrent-b")),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 503]);
  assert.equal(state.calls.createConversation.length, 1);
  assert.equal(state.calls.startCamera.length, 1);
});

test("Recall transcript.done persistence error and found=false remain retryable", { concurrency: false }, async (t) => {
  await t.test("RPC error", async () => {
    const state = freshState();
    state.transcriptAppendError = { message: "database unavailable" };
    const response = await POST(request("delivery-transcript-error", "transcript.done"));
    assert.equal(response.status, 503);
    assert.equal(state.calls.rpc.at(-1).name, "portal_release_recall_webhook_service");
  });
  await t.test("placeholder not found", async () => {
    const state = freshState();
    state.transcriptAppendFound = false;
    const response = await POST(request("delivery-transcript-not-found", "transcript.done"));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "transcript_persistence_pending");
    assert.equal(state.calls.rpc.at(-1).name, "portal_release_recall_webhook_service");
  });
});

test("terminal retained before session retries, then notifies once after session materialization", { concurrency: false }, async () => {
  const state = freshState();
  state.notificationClaimResults = [false, true, false];
  state.statusReceipt = { found: false, applied: true, terminalRetained: true };
  const first = await POST(request("delivery-terminal-before-session", "bot.done"));
  assert.equal(first.status, 503);
  assert.deepEqual(await first.json(), { error: "terminal_notification_not_ready" });
  const statusCall = state.calls.rpc.find((call) => call.name === "portal_update_meeting_bot_session_status_service");
  assert.equal(statusCall.args.p_delivery_id, "delivery-terminal-before-session");
  assert.match(statusCall.args.p_claim_token, /^[0-9a-f-]{36}$/);
  assert.equal(state.calls.createConversation.length, 0);
  assert.equal(state.calls.startCamera.length, 0);

  state.statusReceipt = { found: true, applied: false, terminalRetained: true };
  state.meetingSession = {
    tenant_id: "0198a000-0000-7000-8000-000000000001",
    agent_id: "0198a000-0000-7000-8000-000000000002",
  };
  const second = await POST(request("delivery-terminal-after-session", "bot.done"));
  const third = await POST(request("delivery-terminal-after-notification", "bot.done"));
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  assert.equal(state.calls.notifications.length, 1);
});

test("terminal before camera cleans a known Tavus effect with a standardized receipt", { concurrency: false }, async () => {
  const state = freshState();
  state.statusReceipt = {
    found: true,
    applied: true,
    terminalRetained: true,
    tavusCleanupRequired: true,
    tavusReservationId: "0198a000-0000-7000-8000-000000000010",
    tavusConversationId: "conversation-123",
  };
  const response = await POST(request("delivery-terminal-cleanup", "bot.done"));
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.endConversation, ["conversation-123"]);
  assert.deepEqual(state.calls.reconcile.at(-1), {
    receiptId: "0198a000-0000-7000-8000-000000000099",
    id: "0198a000-0000-7000-8000-000000000010",
    evidence: "compensation_confirmed",
    receiptRef: "tavus:end:conversation-123",
  });
  assert.equal(state.calls.billingActivate.length, 0);
});

test("terminal replay resumes pending Tavus cleanup even when status was already applied", { concurrency: false }, async () => {
  const state = freshState();
  state.statusReceipt = {
    found: true,
    applied: false,
    terminalRetained: true,
    tavusCleanupRequired: true,
    tavusReservationId: "0198a000-0000-7000-8000-000000000010",
    tavusConversationId: "conversation-123",
  };
  const response = await POST(request("delivery-terminal-cleanup-replay", "bot.done"));
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.endConversation, ["conversation-123"]);
  assert.equal(state.calls.reconcile.at(-1).receiptRef, "tavus:end:conversation-123");
  assert.equal(state.calls.rpc.filter((call) => call.name === "portal_claim_meeting_terminal_notification_service").length, 1);
});

test("terminal replay claims notification after cleanup and a later delivery cannot duplicate it", { concurrency: false }, async () => {
  const state = freshState();
  state.statusReceipt = {
    found: true,
    applied: false,
    terminalRetained: true,
    tavusCleanupRequired: true,
    tavusReservationId: "0198a000-0000-7000-8000-000000000010",
    tavusConversationId: "conversation-123",
  };
  state.notificationClaimResults = [true, false];
  state.meetingSession = {
    tenant_id: "0198a000-0000-7000-8000-000000000001",
    agent_id: "0198a000-0000-7000-8000-000000000002",
  };

  const first = await POST(request("delivery-terminal-notify-first", "bot.done"));
  const second = await POST(request("delivery-terminal-notify-second", "bot.done"));

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(state.calls.notifications.length, 1);
  assert.equal(state.calls.notifications[0].agentName, "Raissa");
  assert.equal(state.calls.rpc.filter((call) => call.name === "portal_claim_meeting_terminal_notification_service").length, 2);
});

test("terminal notification claim failure stays retryable and sends no email", { concurrency: false }, async () => {
  const state = freshState();
  state.statusReceipt = { found: true, applied: false, terminalRetained: true };
  state.notificationClaimError = { message: "claim unavailable" };
  state.meetingSession = {
    tenant_id: "0198a000-0000-7000-8000-000000000001",
    agent_id: "0198a000-0000-7000-8000-000000000002",
  };

  const response = await POST(request("delivery-terminal-notify-claim-error", "bot.done"));

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "terminal_notification_claim_pending");
  assert.equal(state.calls.notifications.length, 0);
  assert.equal(state.calls.rpc.at(-1).name, "portal_release_recall_webhook_service");
});

test("an immediate persisted conversation starts camera only after signed in_call and activates both reservations", { concurrency: false }, async () => {
  const state = freshState();
  state.sentinel = {
    ...state.sentinel,
    state: "conversation_created",
    reservationId: "0198a000-0000-7000-8000-000000000010",
    conversationId: "conversation-123",
    conversationUrl: "https://tavus.daily.co/room-123",
  };
  const response = await POST(request("delivery-immediate-in-call"));
  assert.equal(response.status, 200);
  const statusCall = state.calls.rpc.find((call) => call.name === "portal_update_meeting_bot_session_status_service");
  assert.equal(statusCall.args.p_delivery_id, undefined);
  assert.equal(statusCall.args.p_claim_token, undefined);
  assert.equal(state.calls.createConversation.length, 0);
  assert.equal(state.calls.startCamera.length, 1);
  assert.deepEqual(state.calls.billingActivate, [
    "0198a000-0000-7000-8000-000000000020",
    "0198a000-0000-7000-8000-000000000010",
  ]);
});
