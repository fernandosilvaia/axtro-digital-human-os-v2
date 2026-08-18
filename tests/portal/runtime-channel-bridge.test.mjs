import assert from "node:assert/strict";
import test from "node:test";

import { createPortalChannelRuntimeBridge } from "../../apps/portal/src/lib/runtime/portal-channel-runtime-bridge.ts";

const IDS = [
  "019a0000-0000-7000-8000-000000000001", "019a0000-0000-7000-8000-000000000002",
  "019a0000-0000-7000-8000-000000000003", "019a0000-0000-7000-8000-000000000004",
  "019a0000-0000-7000-8000-000000000005", "019a0000-0000-7000-8000-000000000006",
  "019a0000-0000-7000-8000-000000000007", "019a0000-0000-7000-8000-000000000008",
  "019a0000-0000-7000-8000-000000000009", "019a0000-0000-7000-8000-000000000010",
  "019a0000-0000-7000-8000-000000000011", "019a0000-0000-7000-8000-000000000012",
  "019a0000-0000-7000-8000-000000000013", "019a0000-0000-7000-8000-000000000014",
];

function enabledConfirmation(overrides = {}) {
  return { disclosure: true, essentialProcessing: true, recording: true, transcription: true, behavioralAnalysis: true, visualAnalysis: true, ...overrides };
}

function admissionInput(overrides = {}) {
  return {
    tenantId: IDS[0], agentId: IDS[1], commandId: IDS[2], actorId: IDS[3], channel: "tavus_video",
    requestedPurposes: ["recording", "visual_analysis"], confirmation: enabledConfirmation(),
    disclosure: { deliveredBy: "authenticated_portal" },
    ...overrides,
  };
}

function fakeBridge({ status = { enabled: true }, admission = null, scene = null } = {}) {
  const calls = [];
  let index = 4;
  const rpc = {
    async rpc(name, parameters) {
      calls.push({ name, parameters });
      if (name === "portal_runtime_channel_status_service") return { data: status, error: null };
      if (name === "portal_admit_runtime_channel_service") return {
        data: admission ?? { outcome: "issued", sessionId: IDS[4], grantId: IDS[5], generation: parameters.p_generation }, error: null,
      };
      if (name === "portal_consume_runtime_channel_grant_service") return { data: { outcome: "acquired" }, error: null };
      if (name === "portal_bind_runtime_provider_channel_service") return { data: true, error: null };
      if (name === "portal_execute_runtime_scene_service") return { data: scene ?? true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const directorCalls = [];
  const bridge = createPortalChannelRuntimeBridge({
    rpc, env: { PORTAL_RUNTIME_BRIDGE_ENABLED: "true" },
    idGenerator: () => IDS[index++],
    sceneDirector: { selectScene(intent, capabilities) { directorCalls.push({ intent, capabilities }); return { outcome: "accepted", directive: { manifestId: "premium_deck", generationId: intent.generationId } }; } },
  });
  return { bridge, calls, directorCalls };
}

test("runtime bridge admits, consumes per provider, binds and receipts an allowlisted scene", async () => {
  const { bridge, calls, directorCalls } = fakeBridge();
  const admitted = await bridge.admitPortalChannel(admissionInput());
  assert.equal(admitted.outcome, "admitted");
  if (admitted.outcome === "rejected") return assert.fail("expected grant");
  assert.deepEqual(await bridge.assertPortalProviderDispatchActive({ grant: admitted.grant, consumerKind: "tavus" }), { outcome: "consumed", code: "admitted" });
  assert.deepEqual(await bridge.consumePortalChannelGrant({ grant: admitted.grant, consumerKind: "recall" }), { outcome: "consumed", code: "admitted" });
  assert.deepEqual(await bridge.bindPortalProviderChannel({ grant: admitted.grant, reservationId: IDS[7], provider: "tavus", providerRef: "conversation_123", providerUrl: "https://tavus.daily.co/example" }), { outcome: "bound", code: "bound" });
  const scene = await bridge.executePortalSceneIntent({ grant: admitted.grant, sceneIntent: { generationId: 0, sceneType: "slide_deck" } });
  assert.equal(scene.outcome, "executed");
  assert.equal(directorCalls.length, 1);
  assert.equal(calls.filter((call) => call.name === "portal_consume_runtime_channel_grant_service").length, 3);
  assert.deepEqual(calls.find((call) => call.name === "portal_admit_runtime_channel_service").parameters.p_capability_set, ["scene_presentation", "recording", "visual_analysis"]);
  assert.equal(calls.at(-1).name, "portal_execute_runtime_scene_service");
});

test("runtime bridge refuses admission before RPC when disclosure is not confirmed", async () => {
  const { bridge, calls } = fakeBridge();
  assert.deepEqual(await bridge.admitPortalChannel(admissionInput({ confirmation: enabledConfirmation({ disclosure: false }) })), { outcome: "rejected", code: "denied_disclosure" });
  assert.equal(calls.length, 0);
});

test("runtime bridge refuses an optional capability without purpose-scoped consent", async () => {
  const { bridge, calls } = fakeBridge();
  assert.deepEqual(await bridge.admitPortalChannel(admissionInput({ confirmation: enabledConfirmation({ visualAnalysis: false }) })), { outcome: "rejected", code: "denied_optional_consent" });
  assert.equal(calls.length, 0);
});

test("runtime bridge surfaces the durable one-mouth conflict without issuing a grant", async () => {
  const { bridge, calls } = fakeBridge({ admission: { outcome: "one_mouth_conflict" } });
  assert.deepEqual(await bridge.admitPortalChannel(admissionInput()), { outcome: "rejected", code: "one_mouth_conflict" });
  assert.equal(calls.filter((call) => call.name === "portal_admit_runtime_channel_service").length, 1);
});

test("runtime bridge discards a stale scene before it reaches the scene receipt RPC", async () => {
  const { bridge, calls, directorCalls } = fakeBridge({ status: { enabled: true } });
  const admitted = await bridge.admitPortalChannel(admissionInput({ generation: 1 }));
  if (admitted.outcome === "rejected") return assert.fail("expected grant");
  assert.deepEqual(await bridge.executePortalSceneIntent({ grant: admitted.grant, sceneIntent: { generationId: 0 } }), { outcome: "rejected", code: "stale_generation" });
  assert.equal(directorCalls.length, 0);
  assert.equal(calls.filter((call) => call.name === "portal_execute_runtime_scene_service").length, 0);
});

test("runtime bridge fails closed on a durable kill switch before provider admission", async () => {
  const { bridge, calls } = fakeBridge({ status: { enabled: false, code: "kill_switch_active" } });
  assert.deepEqual(await bridge.admitPortalChannel(admissionInput()), { outcome: "rejected", code: "kill_switch_active" });
  assert.equal(calls.length, 1);
});
