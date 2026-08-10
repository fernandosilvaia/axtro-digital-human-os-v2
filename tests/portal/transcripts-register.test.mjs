import assert from "node:assert/strict";
import { test } from "node:test";

const register = await import("../../apps/portal/src/lib/transcripts/register.ts");

test("tavusWebhookCallbackUrl é undefined sem TAVUS_WEBHOOK_TOKEN configurada", () => {
  const original = process.env.TAVUS_WEBHOOK_TOKEN;
  delete process.env.TAVUS_WEBHOOK_TOKEN;
  try {
    assert.equal(register.tavusWebhookCallbackUrl(), undefined);
  } finally {
    if (original !== undefined) process.env.TAVUS_WEBHOOK_TOKEN = original;
  }
});

test("tavusWebhookCallbackUrl monta a URL com o token codificado, usando PORTAL_PUBLIC_URL", () => {
  const originalToken = process.env.TAVUS_WEBHOOK_TOKEN;
  const originalUrl = process.env.PORTAL_PUBLIC_URL;
  process.env.TAVUS_WEBHOOK_TOKEN = "tok en com espaço";
  process.env.PORTAL_PUBLIC_URL = "https://closer.axtroai.com/";
  try {
    assert.equal(
      register.tavusWebhookCallbackUrl(),
      "https://closer.axtroai.com/api/tavus/webhook?token=tok%20en%20com%20espa%C3%A7o",
    );
  } finally {
    if (originalToken !== undefined) process.env.TAVUS_WEBHOOK_TOKEN = originalToken; else delete process.env.TAVUS_WEBHOOK_TOKEN;
    if (originalUrl !== undefined) process.env.PORTAL_PUBLIC_URL = originalUrl; else delete process.env.PORTAL_PUBLIC_URL;
  }
});

test("registerTranscriptPlaceholder chama a RPC com turns=[] e nunca lança quando ela falha", async () => {
  const calls = [];
  const fakeSupabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: null, error: { message: "boom" } };
    },
  };
  await assert.doesNotReject(() => register.registerTranscriptPlaceholder(fakeSupabase, "agent-1", "video", "conv_123"));
  assert.equal(calls[0].name, "portal_upsert_conversation_transcript");
  assert.equal(calls[0].args.p_agent_id, "agent-1");
  assert.equal(calls[0].args.p_surface, "video");
  assert.equal(calls[0].args.p_external_ref, "conv_123");
  assert.deepEqual(calls[0].args.p_turns, []);
});

test("registerTranscriptPlaceholder nunca lança quando a própria chamada rejeita (não só erro no retorno)", async () => {
  const fakeSupabase = { rpc: async () => { throw new Error("network down"); } };
  await assert.doesNotReject(() => register.registerTranscriptPlaceholder(fakeSupabase, "agent-1", "chat", "t-1"));
});
