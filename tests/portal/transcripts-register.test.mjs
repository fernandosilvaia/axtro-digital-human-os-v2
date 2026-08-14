import assert from "node:assert/strict";
import { test } from "node:test";

const register = await import("../../apps/portal/src/lib/transcripts/register.ts");

test("prepareTavusWebhookCallback vincula hash único e nunca inclui o bearer nos argumentos SQL", async () => {
  const calls = [];
  const capabilityExpiresAt = "2099-08-13T12:30:00.000Z";
  const fakeSupabase = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { acquired: true, state: "provider_in_flight", capabilityExpiresAt }, error: null }; } };
  const prepared = await register.prepareTavusWebhookCallback(
    "0198a000-0000-7000-8000-000000000010",
    fakeSupabase,
    { PORTAL_PUBLIC_URL: "https://closer.axtroai.com/" },
  );
  const callback = new URL(prepared.callbackUrl);
  const capability = callback.searchParams.get("capability");
  assert.equal(callback.origin, "https://closer.axtroai.com");
  assert.equal(callback.pathname, "/api/tavus/webhook");
  assert.equal(callback.searchParams.get("reservationId"), "0198a000-0000-7000-8000-000000000010");
  assert.match(capability, /^[A-Za-z0-9_-]{43}$/);
  assert.match(prepared.capabilityHash, /^[0-9a-f]{64}$/);
  assert.equal(prepared.capabilityExpiresAt, capabilityExpiresAt);
  assert.equal(calls[0].name, "portal_bind_tavus_webhook_capability_service");
  assert.equal(calls[0].args.p_capability_hash, prepared.capabilityHash);
  assert.equal(JSON.stringify(calls[0]).includes(capability), false);
});

test("prepareTavusWebhookCallback rejects an unsafe public origin before durable binding", async () => {
  let called = false;
  await assert.rejects(
    register.prepareTavusWebhookCallback(
      "0198a000-0000-7000-8000-000000000010",
      { rpc: async () => { called = true; return { data: null, error: null }; } },
      { PORTAL_PUBLIC_URL: "https://closer.axtroai.com.evil.example" },
    ),
    /exact approved HTTPS origin/,
  );
  assert.equal(called, false);
});

test("prepareTavusWebhookCallback falha fechado sem fence durável", async () => {
  const fakeSupabase = { rpc: async () => ({ data: false, error: null }) };
  await assert.rejects(
    register.prepareTavusWebhookCallback(
      "0198a000-0000-7000-8000-000000000010",
      fakeSupabase,
      { PORTAL_PUBLIC_URL: "https://closer.axtroai.com" },
    ),
    /binding receipt missing/,
  );
});

test("prepareTavusWebhookCallback requires an exact, unexpired ISO capability receipt", async (t) => {
  const invalidReceipts = [
    { acquired: true, state: "provider_in_flight" },
    { acquired: true, state: "provider_in_flight", capabilityExpiresAt: "not-a-date" },
    { acquired: true, state: "provider_in_flight", capabilityExpiresAt: "2020-01-01T00:00:00.000Z" },
    { acquired: true, state: "provider_in_flight", capabilityExpiresAt: "2099-08-13T12:30:00.000Z", extra: true },
  ];
  for (const [index, receipt] of invalidReceipts.entries()) {
    await t.test(`invalid receipt ${index + 1}`, async () => {
      await assert.rejects(
        register.prepareTavusWebhookCallback(
          "0198a000-0000-7000-8000-000000000010",
          { rpc: async () => ({ data: receipt, error: null }) },
          { PORTAL_PUBLIC_URL: "https://closer.axtroai.com" },
        ),
        /binding receipt missing/,
      );
    });
  }
});

test("registerTranscriptPlaceholder usa a RPC service-only com tenant explícito e nunca lança quando ela falha", async () => {
  const calls = [];
  const fakeSupabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: null, error: { message: "boom" } };
    },
  };
  assert.equal(await register.registerTranscriptPlaceholder("tenant-1", "agent-1", "video", "conv_123", fakeSupabase), false);
  assert.equal(calls[0].name, "portal_register_provider_transcript_service");
  assert.equal(calls[0].args.p_tenant_id, "tenant-1");
  assert.equal(calls[0].args.p_agent_id, "agent-1");
  assert.equal(calls[0].args.p_surface, "video");
  assert.equal(calls[0].args.p_external_ref, "conv_123");
  assert.equal("p_turns" in calls[0].args, false);
});

test("registerTranscriptPlaceholder nunca lança quando a própria chamada rejeita (não só erro no retorno)", async () => {
  const fakeSupabase = { rpc: async () => { throw new Error("network down"); } };
  assert.equal(await register.registerTranscriptPlaceholder("tenant-1", "agent-1", "meeting", "bot-1", fakeSupabase), false);
});

test("registerTranscriptPlaceholder returns true only after a durable service receipt", async () => {
  const fakeSupabase = { rpc: async () => ({ data: { ok: true, replayed: true }, error: null }) };
  assert.equal(await register.registerTranscriptPlaceholder("tenant-1", "agent-1", "video", "conv-1", fakeSupabase), true);
});
