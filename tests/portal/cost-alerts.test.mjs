import assert from "node:assert/strict";
import { test } from "node:test";

const costAlerts = await import("../../apps/portal/src/lib/cost-alerts.ts");

function fakeSupabase({ claimed = true, claimError = null, admins = ["admin@example.com"], adminsError = null, legalName = "Tenant Teste" } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ type: "rpc", name, args });
      if (name === "portal_claim_cost_alert_service") {
        if (claimError) return { data: null, error: claimError };
        return { data: { claimed }, error: null };
      }
      if (name === "portal_list_admin_emails_service") {
        if (adminsError) return { data: null, error: adminsError };
        return { data: admins, error: null };
      }
      throw new Error(`RPC inesperada no fake: ${name}`);
    },
    from: (table) => {
      calls.push({ type: "from", table });
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { legal_name: legalName }, error: null }),
          }),
        }),
      };
    },
  };
}

test("maybeAlertCostCap não toca o banco quando o uso está bem abaixo do teto (fast path)", async () => {
  const supabase = fakeSupabase();
  await costAlerts.maybeAlertCostCap({ tenantId: "t1", capKind: "daily_tokens", current: 100, cap: 500_000 }, supabase);
  assert.equal(supabase.calls.length, 0);
});

test("maybeAlertCostCap ignora cap<=0 sem tocar o banco", async () => {
  const supabase = fakeSupabase();
  await costAlerts.maybeAlertCostCap({ tenantId: "t1", capKind: "daily_video_conversations", current: 5, cap: 0 }, supabase);
  assert.equal(supabase.calls.length, 0);
});

test("maybeAlertCostCap reivindica o alerta de 80% quando cruza o threshold, mas ainda não bateu o teto", async () => {
  const supabase = fakeSupabase();
  await costAlerts.maybeAlertCostCap({ tenantId: "t1", capKind: "daily_tokens", current: 400_000, cap: 500_000 }, supabase);
  const claimCall = supabase.calls.find((c) => c.type === "rpc" && c.name === "portal_claim_cost_alert_service");
  assert.ok(claimCall, "esperava chamada de claim");
  assert.equal(claimCall.args.p_tenant_id, "t1");
  assert.equal(claimCall.args.p_alert_key, "daily_tokens:80");
});

test("maybeAlertCostCap reivindica o alerta de 100% quando o uso já bateu ou passou do teto", async () => {
  const supabase = fakeSupabase();
  await costAlerts.maybeAlertCostCap({ tenantId: "t1", capKind: "daily_video_conversations", current: 21, cap: 20 }, supabase);
  const claimCall = supabase.calls.find((c) => c.type === "rpc" && c.name === "portal_claim_cost_alert_service");
  assert.equal(claimCall.args.p_alert_key, "daily_video_conversations:100");
});

test("maybeAlertCostCap não busca admins nem envia e-mail quando o claim falha (erro de RPC)", async () => {
  const supabase = fakeSupabase({ claimError: { message: "boom" } });
  await costAlerts.maybeAlertCostCap({ tenantId: "t1", capKind: "daily_tokens", current: 500_000, cap: 500_000 }, supabase);
  const adminsCall = supabase.calls.find((c) => c.type === "rpc" && c.name === "portal_list_admin_emails_service");
  assert.equal(adminsCall, undefined);
});

test("maybeAlertCostCap não busca admins nem envia e-mail quando claimed=false (já alertado hoje)", async () => {
  const supabase = fakeSupabase({ claimed: false });
  await costAlerts.maybeAlertCostCap({ tenantId: "t1", capKind: "daily_tokens", current: 500_000, cap: 500_000 }, supabase);
  const adminsCall = supabase.calls.find((c) => c.type === "rpc" && c.name === "portal_list_admin_emails_service");
  assert.equal(adminsCall, undefined);
});

test("maybeAlertCostCap busca admins e nome do tenant quando claimed=true", async () => {
  const supabase = fakeSupabase({ claimed: true, admins: ["a@x.com", "b@x.com"] });
  await costAlerts.maybeAlertCostCap({ tenantId: "t1", capKind: "daily_video_conversations", current: 20, cap: 20 }, supabase);
  const adminsCall = supabase.calls.find((c) => c.type === "rpc" && c.name === "portal_list_admin_emails_service");
  assert.ok(adminsCall);
  assert.equal(adminsCall.args.p_tenant_id, "t1");
  const tenantsCall = supabase.calls.find((c) => c.type === "from" && c.table === "tenants");
  assert.ok(tenantsCall);
});

test("maybeAlertCostCap não lança quando não há admins pra notificar", async () => {
  const supabase = fakeSupabase({ admins: [] });
  await assert.doesNotReject(() =>
    costAlerts.maybeAlertCostCap({ tenantId: "t1", capKind: "daily_tokens", current: 500_000, cap: 500_000 }, supabase),
  );
});

test("maybeAlertCostCap nunca lança quando a RPC de claim rejeita (não só erro no retorno)", async () => {
  const supabase = {
    rpc: async () => { throw new Error("network down"); },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  };
  await assert.doesNotReject(() =>
    costAlerts.maybeAlertCostCap({ tenantId: "t1", capKind: "daily_tokens", current: 500_000, cap: 500_000 }, supabase),
  );
});
