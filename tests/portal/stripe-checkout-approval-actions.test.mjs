import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

/**
 * Server Actions de aprovação/rejeição de checkout (ADR-040), mesmo
 * mecanismo de `stripe-checkout-catalog-actions.test.mjs`.
 */
const actionsSource = await readFile(
  new URL("../../apps/portal/src/lib/actions/stripe-checkout-approval.ts", import.meta.url),
  "utf8",
);

const RESERVATION_ID = "0198a8b2-3c4d-7e5f-8a90-1234567890ab";

function loadApprovalActions(options = {}) {
  const calls = { fetchOverview: 0, serviceRole: 0, rpc: [], telemetry: [] };
  const user = Object.hasOwn(options, "user") ? options.user : { id: "user-authenticated", app_metadata: { actor_id: "0198a000-0000-7000-8000-0000000000a1" } };
  const overview = options.overview ?? { provisioned: true, role: "tenant_admin", tenant: { id: "tenant-resolved" } };
  const supabase = { auth: { async getUser() { return { data: { user } }; } } };
  const approveResult = options.approveResult ?? { data: { outcome: "approved", reservationId: RESERVATION_ID, state: "reserved" }, error: null };
  const rejectResult = options.rejectResult ?? { data: { outcome: "rejected", reservationId: RESERVATION_ID, state: "rejected" }, error: null };

  const mocks = new Map([
    ["@/lib/portal-data", {
      async fetchTenantOverview() {
        calls.fetchOverview += 1;
        return overview;
      },
    }],
    ["@/lib/supabase/server", {
      async createClient() {
        return supabase;
      },
    }],
    ["@/lib/supabase/service", {
      createServiceRoleClient() {
        calls.serviceRole += 1;
        if (options.serviceRoleThrows !== undefined) throw options.serviceRoleThrows;
        return {
          async rpc(name, args) {
            calls.rpc.push({ name, args });
            if (name === "portal_approve_business_checkout_service") return approveResult;
            if (name === "portal_reject_business_checkout_service") return rejectResult;
            throw new Error(`unexpected rpc: ${name}`);
          },
        };
      },
    }],
    ["@/lib/telemetry", {
      logError(...args) {
        calls.telemetry.push(args);
      },
    }],
  ]);

  const compiled = ts.transpileModule(actionsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "stripe-checkout-approval.ts",
  }).outputText;
  const module = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected stripe-checkout-approval action import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, {
    filename: "stripe-checkout-approval.runtime.cjs",
  });
  wrapper.runInNewContext({ Date, Error, Object, String, process })(requireMock, module, module.exports);
  return { actions: module.exports, calls };
}

// ---------------------------------------------------------------------------
// approveBusinessCheckoutReservation
// ---------------------------------------------------------------------------

test("approveBusinessCheckoutReservation valida o formato da reserva antes de qualquer auth/RPC", async () => {
  const { actions, calls } = loadApprovalActions();
  const result = await actions.approveBusinessCheckoutReservation("not-a-uuid");
  assert.notEqual(result.error, null);
  assert.equal(calls.fetchOverview, 0);
  assert.equal(calls.serviceRole, 0);
});

test("approveBusinessCheckoutReservation recusa um chamador não autenticado sem tocar a RPC", async () => {
  const { actions, calls } = loadApprovalActions({ user: null });
  const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.match(result.error, /Sessão expirada/);
  assert.equal(calls.serviceRole, 0);
});

test("approveBusinessCheckoutReservation recusa quem não é tenant_admin", async () => {
  const { actions, calls } = loadApprovalActions({ overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-resolved" } } });
  const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.match(result.error, /administradores/);
  assert.equal(calls.serviceRole, 0);
});

test("approveBusinessCheckoutReservation chama a RPC com tenant/reserva/actor/contactEmail corretos em sucesso", async () => {
  const { actions, calls } = loadApprovalActions();
  const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID, " ana@example.test ");
  assert.equal(result.error, null);
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].name, "portal_approve_business_checkout_service");
  assert.equal(calls.rpc[0].args.p_tenant_id, "tenant-resolved");
  assert.equal(calls.rpc[0].args.p_reservation_id, RESERVATION_ID);
  assert.equal(calls.rpc[0].args.p_actor_id, "0198a000-0000-7000-8000-0000000000a1");
  assert.equal(calls.rpc[0].args.p_contact_email, "ana@example.test");
});

test("approveBusinessCheckoutReservation omite contactEmail como null quando não informado", async () => {
  const { actions, calls } = loadApprovalActions();
  await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.equal(calls.rpc[0].args.p_contact_email, null);
});

test("approveBusinessCheckoutReservation trata already_approved como sucesso idempotente", async () => {
  const { actions } = loadApprovalActions({ approveResult: { data: { outcome: "already_approved" }, error: null } });
  const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.equal(result.error, null);
});

test("approveBusinessCheckoutReservation devolve mensagens específicas para contact_email_required/already_rejected/approval_expired", async () => {
  const cases = [
    ["contact_email_required", /e-mail/],
    ["already_rejected", /rejeitada/],
    ["approval_expired", /expirou/],
  ];
  for (const [outcome, pattern] of cases) {
    const { actions } = loadApprovalActions({ approveResult: { data: { outcome }, error: null } });
    const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
    assert.match(result.error, pattern);
  }
});

test("approveBusinessCheckoutReservation devolve erro quando a RPC falha ou devolve outcome totalmente inesperado", async () => {
  const failed = loadApprovalActions({ approveResult: { data: null, error: { message: "db down" } } });
  const failedResult = await failed.actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(failedResult.error, null);
  assert.equal(failed.calls.telemetry[0][0], "checkout_approve_failed");

  const unexpected = loadApprovalActions({ approveResult: { data: { outcome: "weird" }, error: null } });
  const unexpectedResult = await unexpected.actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(unexpectedResult.error, null);
  assert.equal(unexpected.calls.telemetry[0][0], "checkout_approve_unexpected_outcome");
});

test("approveBusinessCheckoutReservation devolve erro legível quando o service role está indisponível", async () => {
  const { actions, calls } = loadApprovalActions({ serviceRoleThrows: new Error("SUPABASE_SERVICE_ROLE_KEY is not configured") });
  const result = await actions.approveBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(result.error, null);
  assert.equal(calls.telemetry[0][0], "checkout_approve_failed");
});

// ---------------------------------------------------------------------------
// rejectBusinessCheckoutReservation
// ---------------------------------------------------------------------------

test("rejectBusinessCheckoutReservation valida o formato da reserva antes de qualquer auth/RPC", async () => {
  const { actions, calls } = loadApprovalActions();
  const result = await actions.rejectBusinessCheckoutReservation("not-a-uuid");
  assert.notEqual(result.error, null);
  assert.equal(calls.serviceRole, 0);
});

test("rejectBusinessCheckoutReservation rejeita um motivo maior que 500 caracteres antes de qualquer RPC", async () => {
  const { actions, calls } = loadApprovalActions();
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID, "x".repeat(501));
  assert.notEqual(result.error, null);
  assert.equal(calls.serviceRole, 0);
});

test("rejectBusinessCheckoutReservation recusa um chamador não autenticado sem tocar a RPC", async () => {
  const { actions, calls } = loadApprovalActions({ user: null });
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.match(result.error, /Sessão expirada/);
  assert.equal(calls.serviceRole, 0);
});

test("rejectBusinessCheckoutReservation recusa quem não é tenant_admin", async () => {
  const { actions, calls } = loadApprovalActions({ overview: { provisioned: true, role: "tenant_operator", tenant: { id: "tenant-resolved" } } });
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.match(result.error, /administradores/);
  assert.equal(calls.serviceRole, 0);
});

test("rejectBusinessCheckoutReservation chama a RPC com tenant/reserva/actor/motivo corretos em sucesso", async () => {
  const { actions, calls } = loadApprovalActions();
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID, " prospect desistiu ");
  assert.equal(result.error, null);
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].name, "portal_reject_business_checkout_service");
  assert.equal(calls.rpc[0].args.p_tenant_id, "tenant-resolved");
  assert.equal(calls.rpc[0].args.p_reservation_id, RESERVATION_ID);
  assert.equal(calls.rpc[0].args.p_actor_id, "0198a000-0000-7000-8000-0000000000a1");
  assert.equal(calls.rpc[0].args.p_rejection_reason, "prospect desistiu");
});

test("rejectBusinessCheckoutReservation trata already_rejected como sucesso idempotente", async () => {
  const { actions } = loadApprovalActions({ rejectResult: { data: { outcome: "already_rejected" }, error: null } });
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.equal(result.error, null);
});

test("rejectBusinessCheckoutReservation devolve mensagens específicas para already_approved/approval_expired", async () => {
  const cases = [
    ["already_approved", /aprovada/],
    ["approval_expired", /expirou/],
  ];
  for (const [outcome, pattern] of cases) {
    const { actions } = loadApprovalActions({ rejectResult: { data: { outcome }, error: null } });
    const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
    assert.match(result.error, pattern);
  }
});

test("rejectBusinessCheckoutReservation devolve erro quando a RPC falha ou devolve outcome totalmente inesperado", async () => {
  const failed = loadApprovalActions({ rejectResult: { data: null, error: { message: "db down" } } });
  const failedResult = await failed.actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(failedResult.error, null);
  assert.equal(failed.calls.telemetry[0][0], "checkout_reject_failed");

  const unexpected = loadApprovalActions({ rejectResult: { data: { outcome: "weird" }, error: null } });
  const unexpectedResult = await unexpected.actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(unexpectedResult.error, null);
  assert.equal(unexpected.calls.telemetry[0][0], "checkout_reject_unexpected_outcome");
});

test("rejectBusinessCheckoutReservation devolve erro legível quando o service role está indisponível", async () => {
  const { actions, calls } = loadApprovalActions({ serviceRoleThrows: new Error("SUPABASE_SERVICE_ROLE_KEY is not configured") });
  const result = await actions.rejectBusinessCheckoutReservation(RESERVATION_ID);
  assert.notEqual(result.error, null);
  assert.equal(calls.telemetry[0][0], "checkout_reject_failed");
});
