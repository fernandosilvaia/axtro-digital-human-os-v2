import assert from "node:assert/strict";
import { test } from "node:test";

// Achado P2 da auditoria 2026-08-11: único caminho de provisionamento
// self-serve, chamado a cada load do dashboard quando o tenant ainda não
// existe — sem nenhum teste até aqui.
const provisioning = await import("../../apps/portal/src/lib/actions/provisioning.ts");

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fakeSupabase(rpcResult) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return rpcResult;
    },
  };
}

test("ensureTenantProvisioned chama provision_self_serve_tenant com uuids v7 novos, região/idioma/fuso fixos e slug derivado do tenantId", async () => {
  const supabase = fakeSupabase({ data: "new-tenant-id", error: null });
  const user = { email: "dono@empresa.com" };
  const result = await provisioning.ensureTenantProvisioned(supabase, user);

  assert.equal(result.tenantId, "new-tenant-id");
  assert.equal(supabase.calls.length, 1);
  assert.equal(supabase.calls[0].name, "provision_self_serve_tenant");

  const args = supabase.calls[0].args;
  assert.match(args.p_tenant_id, UUID_V7_PATTERN, "p_tenant_id deve ser um uuid v7 válido");
  assert.match(args.p_actor_id, UUID_V7_PATTERN, "p_actor_id deve ser um uuid v7 válido");
  assert.notEqual(args.p_tenant_id, args.p_actor_id, "tenant e actor devem ser ids distintos");
  assert.equal(args.p_slug, `tenant-${args.p_tenant_id.slice(0, 8)}`);
  assert.equal(args.p_legal_name, "Conta de dono@empresa.com");
  assert.equal(args.p_home_region, "us-east-1");
  assert.equal(args.p_default_language, "pt-BR");
  assert.equal(args.p_default_timezone, "America/Sao_Paulo");
});

test("ensureTenantProvisioned usa 'Nova conta' quando o usuário não tem e-mail", async () => {
  const supabase = fakeSupabase({ data: "new-tenant-id", error: null });
  const result = await provisioning.ensureTenantProvisioned(supabase, { email: null });
  assert.equal(result.tenantId, "new-tenant-id");
  assert.equal(supabase.calls[0].args.p_legal_name, "Nova conta");
});

test("ensureTenantProvisioned usa 'Nova conta' quando o e-mail é string vazia", async () => {
  const supabase = fakeSupabase({ data: "new-tenant-id", error: null });
  await provisioning.ensureTenantProvisioned(supabase, { email: "" });
  assert.equal(supabase.calls[0].args.p_legal_name, "Nova conta");
});

test("ensureTenantProvisioned lança um erro explícito (com a mensagem da RPC) quando o provisionamento falha", async () => {
  const supabase = fakeSupabase({ data: null, error: { message: "slug already taken" } });
  await assert.rejects(
    () => provisioning.ensureTenantProvisioned(supabase, { email: "a@b.com" }),
    (err) => {
      assert.match(err.message, /tenant provisioning failed/);
      assert.match(err.message, /slug already taken/);
      return true;
    },
  );
});

test("ensureTenantProvisioned gera um tenantId/actorId diferente a cada chamada (nunca reaproveita)", async () => {
  const supabase = fakeSupabase({ data: "tid", error: null });
  await provisioning.ensureTenantProvisioned(supabase, { email: "a@b.com" });
  await provisioning.ensureTenantProvisioned(supabase, { email: "a@b.com" });
  assert.notEqual(supabase.calls[0].args.p_tenant_id, supabase.calls[1].args.p_tenant_id);
  assert.notEqual(supabase.calls[0].args.p_actor_id, supabase.calls[1].args.p_actor_id);
});
