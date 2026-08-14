import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const stage = await import("../../apps/portal/src/lib/meetings/stage.ts");
const PUBLIC_ENV = Object.freeze({ PORTAL_PUBLIC_URL: "https://closer.axtroai.com" });

const INPUT = Object.freeze({
  tenantId: "0198a000-0000-7000-8000-000000000001",
  agentId: "0198a000-0000-7000-8000-000000000002",
  reservationId: "0198a000-0000-7000-8000-000000000003",
  roomUrl: "https://tavus.daily.co/private-room-bearer?token=secret",
});

function clientWith(handler) {
  return { rpc: handler };
}

test("stage URL contains only a short opaque capability and persists only its hash", async () => {
  const calls = [];
  const result = await stage.prepareAgentFaceStage(INPUT, clientWith(async (name, args) => {
    calls.push({ name, args });
    return { data: { created: true, expiresAt: "2099-08-13T12:45:00.000Z" }, error: null };
  }), PUBLIC_ENV);
  const publicUrl = new URL(result.stageUrl);
  const capability = publicUrl.searchParams.get("cap");
  assert.equal(publicUrl.pathname, "/rosto-agente");
  assert.equal(publicUrl.searchParams.has("sala"), false);
  assert.equal(result.stageUrl.includes(INPUT.roomUrl), false);
  assert.match(capability, /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(calls, [{
    name: "portal_create_tavus_stage_capability_service",
    args: {
      p_tenant_id: INPUT.tenantId,
      p_agent_id: INPUT.agentId,
      p_reservation_id: INPUT.reservationId,
      p_token_hash: createHash("sha256").update(capability).digest("hex"),
      p_room_url: INPUT.roomUrl,
    },
  }]);
  assert.equal(calls[0].args.p_token_hash.includes(capability), false);
});

test("stage creation rejects foreign URLs and requires a strict durable receipt", async () => {
  let called = false;
  const client = clientWith(async () => {
    called = true;
    return { data: { created: true, expiresAt: "2099-08-13T12:45:00.000Z" }, error: null };
  });
  await assert.rejects(() => stage.prepareAgentFaceStage({ ...INPUT, roomUrl: "https://evil.example/steal" }, client, PUBLIC_ENV), /allowed Tavus/);
  assert.equal(called, false);
  await assert.rejects(
    () => stage.prepareAgentFaceStage(INPUT, clientWith(async () => ({ data: { created: false }, error: null })), PUBLIC_ENV),
    /strict receipt missing/,
  );
});

test("stage rejects an unsafe public origin before capability persistence", async () => {
  let called = false;
  await assert.rejects(
    () => stage.prepareAgentFaceStage(
      INPUT,
      clientWith(async () => { called = true; return { data: null, error: null }; }),
      { PORTAL_PUBLIC_URL: "https://closer.axtroai.com:443" },
    ),
    /exact approved HTTPS origin/,
  );
  assert.equal(called, false);
});

test("resolution is hash-only, fail-closed for hostile/replayed/expired capabilities", async (t) => {
  const capability = "A".repeat(32);
  await t.test("unknown token (including another tenant's token) is not resolved", async () => {
    const calls = [];
    const resolved = await stage.resolveAgentFaceStageCapability(capability, clientWith(async (name, args) => {
      calls.push({ name, args });
      return { data: { found: false }, error: null };
    }));
    assert.equal(resolved, null);
    assert.deepEqual(calls, [{
      name: "portal_resolve_tavus_stage_capability_service",
      args: { p_token_hash: createHash("sha256").update(capability).digest("hex") },
    }]);
  });
  await t.test("expired receipt remains unusable even if the database returns it", async () => {
    const resolved = await stage.resolveAgentFaceStageCapability(capability, clientWith(async () => ({
      data: { found: true, roomUrl: INPUT.roomUrl, expiresAt: "2000-01-01T00:00:00.000Z" },
      error: null,
    })));
    assert.equal(resolved, null);
  });
  await t.test("malformed token does not touch service role", async () => {
    let called = false;
    const resolved = await stage.resolveAgentFaceStageCapability(INPUT.roomUrl, clientWith(async () => {
      called = true;
      return { data: { found: true }, error: null };
    }));
    assert.equal(resolved, null);
    assert.equal(called, false);
  });
});

test("public stage page never accepts the Tavus room bearer in query parameters", async () => {
  const source = await readFile(new URL("../../apps/portal/src/app/rosto-agente/page.tsx", import.meta.url), "utf8");
  assert.match(source, /searchParams: Promise<\{ cap\?: string \}>/);
  assert.match(source, /resolveAgentFaceStageCapability/);
  assert.doesNotMatch(source, /searchParams[\s\S]{0,120}sala\?/);
  assert.doesNotMatch(source, /searchParams\.get\(["']sala["']\)/);
});
