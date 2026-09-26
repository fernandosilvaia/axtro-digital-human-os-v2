import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

import { UUID_V7_PATTERN } from "../../packages/domain/dist/index.js";
import { isTenantDispositionPurposeCode } from "../../apps/portal/src/lib/data-governance-purpose-codes.ts";

/**
 * M6-04, fatia 1 (D-V2-182). Mesmo mecanismo de calendar-connection-actions/
 * stripe-checkout-approval.test.mjs: `ts.transpileModule` + `vm.Script` com
 * um `require` fake, porque o arquivo tem `"use server"` no topo. Diferença
 * deste arquivo: cada action aceita `dependencies` injetável de verdade
 * (authenticatedClient/serviceClient/idGenerator), então os testes passam
 * fakes DIRETO por parâmetro em vez de só mockar os módulos importados --
 * os mocks de módulo abaixo só precisam existir pra o arquivo carregar.
 */
const actionsSource = await readFile(
  new URL("../../apps/portal/src/lib/actions/data-governance-disposition.ts", import.meta.url),
  "utf8",
);

function idSequence(prefix = "0198a000-0000-7000-8000") {
  let n = 0;
  return () => `${prefix}-${(++n).toString(16).padStart(12, "0")}`;
}

class RedirectSignal extends Error {
  constructor(location) {
    super(`redirect:${location}`);
    this.location = location;
  }
}

function assertRedirect(location) {
  return (error) => error instanceof RedirectSignal && error.location === location;
}

function loadDataGovernanceDispositionActions(options = {}) {
  const ServiceRoleUnavailableErrorMock = class ServiceRoleUnavailableError extends Error {};
  const mocks = new Map([
    ["@axtro/domain", { createUuidV7: idSequence("0198a000-0000-7000-8000"), UUID_V7_PATTERN }],
    ["@/lib/data-governance-purpose-codes", { isTenantDispositionPurposeCode }],
    ["next/navigation", {
      redirect(location) {
        throw new RedirectSignal(location);
      },
    }],
    ["next/cache", {
      revalidatePath() {
        // no-op: os testes desta suíte não afirmam nada sobre revalidação de cache.
      },
    }],
    ["@/lib/supabase/server", {
      async createClient() {
        // Só as actions `<form action>` (sem dependency injection própria,
        // mesmo padrão de calendar-connection.ts) passam por aqui de
        // verdade -- as funções core sempre recebem `authenticatedClient`
        // explícito nos testes acima.
        if (options.moduleAuthenticatedClient !== undefined) return options.moduleAuthenticatedClient;
        throw new Error("module-level createClient must never be reached when a test injects authenticatedClient");
      },
    }],
    ["@/lib/supabase/service", {
      createServiceRoleClient() {
        // `dependencies.serviceClient ?? createServiceRoleClientSafely()` trata
        // `null` como ausente (`??`), então "serviceClient indisponível" só é
        // testável de verdade fazendo o mock do MÓDULO lançar
        // `ServiceRoleUnavailableError`, nunca passando `serviceClient: null`
        // por dependency injection (isso cairia direto neste mock).
        if (options.serviceRoleUnavailable === true) throw new ServiceRoleUnavailableErrorMock();
        if (options.moduleServiceClient !== undefined) return options.moduleServiceClient;
        throw new Error("module-level createServiceRoleClient must never be reached when a test injects serviceClient");
      },
      ServiceRoleUnavailableError: ServiceRoleUnavailableErrorMock,
    }],
  ]);
  const compiled = ts.transpileModule(actionsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "data-governance-disposition.ts",
  }).outputText;
  const moduleObj = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected data-governance-disposition import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, {
    filename: "data-governance-disposition.runtime.cjs",
  });
  wrapper.runInNewContext({ process, Date, Object, String })(requireMock, moduleObj, moduleObj.exports);
  return moduleObj.exports;
}

function fakeRpcClient(handlers) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push({ name, args });
        const handler = handlers[name];
        if (handler === undefined) throw new Error(`unexpected rpc call in this test: ${name}`);
        const callNumber = calls.filter((c) => c.name === name).length;
        if (typeof handler === "function") return handler(args, callNumber);
        if (Array.isArray(handler)) return handler[Math.min(callNumber, handler.length) - 1];
        return handler;
      },
    },
  };
}

const TENANT_ID = "0198a000-0000-7000-8000-0000000000a1";
const REQUEST_ID = "0198a000-0000-7000-8000-0000000000b1";
const POLICY_FINGERPRINT = "a".repeat(64);
const INVENTORY_FINGERPRINT = "b".repeat(64);
const COMMAND_FINGERPRINT = "c".repeat(64);

function statusRecord(overrides = {}) {
  return Object.freeze({
    tenantId: TENANT_ID, requestId: REQUEST_ID, scope: "tenant", state: "approval_pending",
    purposeCode: "contract_termination", subjectId: null,
    requiredApprovals: 2, approvedCount: 0, deniedCount: 0,
    policyFingerprint: POLICY_FINGERPRINT, inventoryFingerprint: INVENTORY_FINGERPRINT, commandFingerprint: COMMAND_FINGERPRINT,
    authorizationExpiresAt: null, authorizedAt: null, completedAt: null,
    ...overrides,
  });
}

/**
 * Objetos devolvidos pelo código compilado dentro de `vm.runInNewContext`
 * vêm de outro realm V8 (outro `Object.prototype`), mesmo passando `Object`
 * explicitamente pro sandbox: um literal `{...}` escrito DENTRO do código
 * compilado sempre usa o protótipo intrínseco do realm onde ele foi
 * avaliado, nunca o que a variável `Object` resolve pra fora dali.
 * `assert.deepEqual`/`deepStrictEqual` falha por identidade de protótipo
 * mesmo com shape idêntico -- mesmo padrão já documentado em
 * `calendar-connection-actions.test.mjs`. Comparação campo a campo é o
 * padrão certo aqui.
 */
function assertOutcome(actual, expected) {
  for (const key of Object.keys(expected)) {
    assert.equal(actual[key], expected[key], `campo "${key}"`);
  }
  assert.equal(Object.keys(actual).length, Object.keys(expected).length,
    `campos extras inesperados: ${Object.keys(actual).filter((key) => !(key in expected)).join(", ")}`);
}

function pgError(code, message = "simulated") {
  return { data: null, error: { code, message } };
}

// ---------------------------------------------------------------------------
// getActiveTenantDataGovernanceDisposition
// ---------------------------------------------------------------------------

test("getActive: nenhum pedido ativo devolve outcome none e nunca chama status", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_data_governance_active_request_authenticated: { data: { requestId: null }, error: null },
  });
  const result = await actions.getActiveTenantDataGovernanceDisposition({ authenticatedClient: auth.client });
  assertOutcome(result, { outcome: "none" });
  assert.equal(auth.calls.filter((c) => c.name === "portal_data_governance_status_authenticated").length, 0);
});

test("getActive: pedido ativo existente devolve outcome found com o status completo", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_data_governance_active_request_authenticated: { data: { requestId: REQUEST_ID }, error: null },
    portal_data_governance_status_authenticated: { data: statusRecord(), error: null },
  });
  const result = await actions.getActiveTenantDataGovernanceDisposition({ authenticatedClient: auth.client });
  assert.equal(result.outcome, "found");
  assertOutcome(result.status, statusRecord());
  const statusCall = auth.calls.find((c) => c.name === "portal_data_governance_status_authenticated");
  assert.equal(statusCall.args.p_request_id, REQUEST_ID);
});

test("getActive: erro 42501 na busca do pedido ativo vira unauthorized, nunca lança", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({ portal_data_governance_active_request_authenticated: pgError("42501") });
  const result = await actions.getActiveTenantDataGovernanceDisposition({ authenticatedClient: auth.client });
  assertOutcome(result, { outcome: "unauthorized" });
});

test("getActive: falha de transporte na busca do pedido ativo vira service_unavailable", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = { client: { async rpc() { throw new Error("network down"); } } };
  const result = await actions.getActiveTenantDataGovernanceDisposition({ authenticatedClient: auth.client });
  assertOutcome(result, { outcome: "service_unavailable" });
});

test("getActive: status malformado (campo obrigatório ausente) depois de achar o id vira service_unavailable", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const incomplete = { ...statusRecord() };
  delete incomplete.commandFingerprint;
  const auth = fakeRpcClient({
    portal_data_governance_active_request_authenticated: { data: { requestId: REQUEST_ID }, error: null },
    portal_data_governance_status_authenticated: { data: incomplete, error: null },
  });
  const result = await actions.getActiveTenantDataGovernanceDisposition({ authenticatedClient: auth.client });
  assertOutcome(result, { outcome: "service_unavailable" });
});

// ---------------------------------------------------------------------------
// requestTenantDataGovernanceDisposition
// ---------------------------------------------------------------------------

function preparedRecord(overrides = {}) {
  return {
    tenantId: TENANT_ID, policyVersion: "1.0.0", inventoryVersion: "1.0.0",
    policyFingerprint: POLICY_FINGERPRINT, inventoryFingerprint: INVENTORY_FINGERPRINT, commandFingerprint: COMMAND_FINGERPRINT,
    catalogComplete: true, attestationReady: true,
    ...overrides,
  };
}

test("request: caminho feliz encadeia prepare -> request -> decide-policy -> status com os MESMOS ids/fingerprints em cada chamada", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_prepare_data_governance_request_authenticated: { data: preparedRecord(), error: null },
    portal_request_data_governance_authenticated: { data: { requestId: REQUEST_ID, state: "requested", replayed: false }, error: null },
    portal_data_governance_status_authenticated: { data: statusRecord({ state: "approval_pending" }), error: null },
  });
  const svc = fakeRpcClient({
    portal_decide_data_governance_policy_service: { data: { requestId: REQUEST_ID, state: "approval_pending", replayed: false }, error: null },
  });
  const result = await actions.requestTenantDataGovernanceDisposition("contract_termination", {
    authenticatedClient: auth.client, serviceClient: svc.client,
  });
  assert.equal(result.outcome, "requested");
  assert.equal(result.status.state, "approval_pending");

  const prepareCall = auth.calls.find((c) => c.name === "portal_prepare_data_governance_request_authenticated");
  const requestCall = auth.calls.find((c) => c.name === "portal_request_data_governance_authenticated");
  const decideCall = svc.calls.find((c) => c.name === "portal_decide_data_governance_policy_service");
  assert.equal(prepareCall.args.p_scope, "tenant");
  assert.equal(prepareCall.args.p_subject_id, null);
  assert.equal(prepareCall.args.p_requested_action, "irreversible_delete");
  assert.equal(prepareCall.args.p_purpose_code, "contract_termination");
  const generatedRequestId = prepareCall.args.p_request_id;
  assert.match(generatedRequestId, UUID_V7_PATTERN);
  assert.equal(requestCall.args.p_request_id, generatedRequestId, "o request_id gerado no prepare tem que ser o mesmo usado na chamada real de request");
  assert.equal(requestCall.args.p_policy_fingerprint, POLICY_FINGERPRINT);
  assert.equal(requestCall.args.p_inventory_fingerprint, INVENTORY_FINGERPRINT);
  assert.equal(requestCall.args.p_command_fingerprint, COMMAND_FINGERPRINT);
  assert.equal(decideCall.args.p_tenant_id, TENANT_ID);
  assert.equal(decideCall.args.p_request_id, generatedRequestId);
  assert.equal(decideCall.args.p_policy_decision_id, requestCall.args.p_policy_decision_id, "o policy_decision_id do request e do decide-policy precisam ser o mesmo");
  assert.equal(decideCall.args.p_decision, "allow");
  assert.equal(decideCall.args.p_reason_code, "policy_allowed");
  assert.equal(decideCall.args.p_policy_fingerprint, POLICY_FINGERPRINT);
  const expiresAt = new Date(decideCall.args.p_authorization_expires_at);
  assert.ok(!Number.isNaN(expiresAt.getTime()), "authorization_expires_at precisa ser um timestamp válido");
  const hoursFromNow = (expiresAt.getTime() - Date.now()) / (60 * 60 * 1000);
  assert.ok(hoursFromNow > 23.9 && hoursFromNow <= 24, `esperava ~24h de janela, achou ${hoursFromNow}h`);
});

test("request: attestationReady=false (o estado real de todo ambiente hoje) nunca chega a chamar a RPC de request", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_prepare_data_governance_request_authenticated: { data: preparedRecord({ attestationReady: false }), error: null },
  });
  const svc = fakeRpcClient({});
  const result = await actions.requestTenantDataGovernanceDisposition("contract_termination", {
    authenticatedClient: auth.client, serviceClient: svc.client,
  });
  assertOutcome(result, { outcome: "not_ready", reason: "attestation_not_ready" });
  assert.equal(auth.calls.filter((c) => c.name === "portal_request_data_governance_authenticated").length, 0);
  assert.equal(svc.calls.length, 0, "nenhuma chamada de service-role deve acontecer quando o ambiente não está pronto");
});

test("request: catalogComplete=false nunca chega a chamar a RPC de request", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_prepare_data_governance_request_authenticated: { data: preparedRecord({ catalogComplete: false, attestationReady: true }), error: null },
  });
  const result = await actions.requestTenantDataGovernanceDisposition("contract_termination", {
    authenticatedClient: auth.client, serviceClient: fakeRpcClient({}).client,
  });
  assertOutcome(result, { outcome: "not_ready", reason: "catalog_incomplete" });
});

test("request: prepare com erro 42501 vira unauthorized", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({ portal_prepare_data_governance_request_authenticated: pgError("42501") });
  const result = await actions.requestTenantDataGovernanceDisposition("contract_termination", {
    authenticatedClient: auth.client, serviceClient: fakeRpcClient({}).client,
  });
  assertOutcome(result, { outcome: "unauthorized" });
});

test("request: RPC de request devolvendo 23505 (índice único de pedido ativo por tenant) vira active_request_exists", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_prepare_data_governance_request_authenticated: { data: preparedRecord(), error: null },
    portal_request_data_governance_authenticated: pgError("23505"),
  });
  const result = await actions.requestTenantDataGovernanceDisposition("contract_termination", {
    authenticatedClient: auth.client, serviceClient: fakeRpcClient({}).client,
  });
  assertOutcome(result, { outcome: "active_request_exists" });
});

test("request: RPC de request devolvendo 55000 (tenant não admite pedido) vira tenant_not_admissible", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_prepare_data_governance_request_authenticated: { data: preparedRecord(), error: null },
    portal_request_data_governance_authenticated: pgError("55000"),
  });
  const result = await actions.requestTenantDataGovernanceDisposition("contract_termination", {
    authenticatedClient: auth.client, serviceClient: fakeRpcClient({}).client,
  });
  assertOutcome(result, { outcome: "tenant_not_admissible" });
});

test("request: decide-policy falhando depois de um request bem-sucedido vira service_unavailable, nunca afirma requested", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_prepare_data_governance_request_authenticated: { data: preparedRecord(), error: null },
    portal_request_data_governance_authenticated: { data: { requestId: REQUEST_ID, state: "requested", replayed: false }, error: null },
  });
  const svc = fakeRpcClient({ portal_decide_data_governance_policy_service: pgError("55000") });
  const result = await actions.requestTenantDataGovernanceDisposition("contract_termination", {
    authenticatedClient: auth.client, serviceClient: svc.client,
  });
  assertOutcome(result, { outcome: "service_unavailable" });
});

test("request: serviceClient indisponível (chave de service-role ausente) nunca chega a chamar prepare, muito menos request", async () => {
  const actions = loadDataGovernanceDispositionActions({ serviceRoleUnavailable: true });
  const auth = fakeRpcClient({});
  const result = await actions.requestTenantDataGovernanceDisposition("contract_termination", {
    authenticatedClient: auth.client,
  });
  assertOutcome(result, { outcome: "service_unavailable" });
  assert.equal(auth.calls.length, 0);
});

// ---------------------------------------------------------------------------
// approveTenantDataGovernanceDisposition
// ---------------------------------------------------------------------------

test("approve: requestId que não é UUIDv7 é rejeitado antes de qualquer RPC", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({});
  const result = await actions.approveTenantDataGovernanceDisposition("not-a-uuid", "approve", { authenticatedClient: auth.client });
  assertOutcome(result, { outcome: "unauthorized" });
  assert.equal(auth.calls.length, 0);
});

test("approve: pedido que não está em approval_pending é rejeitado como not_approvable antes de tentar aprovar", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_data_governance_status_authenticated: { data: statusRecord({ state: "authorized" }), error: null },
  });
  const result = await actions.approveTenantDataGovernanceDisposition(REQUEST_ID, "approve", { authenticatedClient: auth.client });
  assertOutcome(result, { outcome: "not_approvable" });
  assert.equal(auth.calls.filter((c) => c.name === "portal_approve_data_governance_authenticated").length, 0);
});

test("approve: primeira aprovação (quorum ainda incompleto) tolera o erro esperado de authorize e devolve o status real, ainda approval_pending", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_data_governance_status_authenticated: [
      statusRecord({ approvedCount: 0 }),
      statusRecord({ approvedCount: 1 }),
    ].map((data) => ({ data, error: null })),
    portal_approve_data_governance_authenticated: { data: { requestId: REQUEST_ID, state: "approval_pending", replayed: false }, error: null },
  });
  const svc = fakeRpcClient({ portal_authorize_data_governance_request_service: pgError("42501") });
  const result = await actions.approveTenantDataGovernanceDisposition(REQUEST_ID, "approve", {
    authenticatedClient: auth.client, serviceClient: svc.client,
  });
  assert.equal(result.outcome, "recorded");
  assert.equal(result.status.approvedCount, 1);
  assert.equal(result.status.state, "approval_pending");
  const approveCall = auth.calls.find((c) => c.name === "portal_approve_data_governance_authenticated");
  assert.equal(approveCall.args.p_command_fingerprint, COMMAND_FINGERPRINT, "o command_fingerprint enviado precisa ser o lido no status FRESCO, nunca um valor obsoleto");
  assert.equal(svc.calls.length, 1, "authorize é sempre tentado depois de um approve, mesmo sem saber de antemão se o quorum já fechou");
});

test("approve: segunda aprovação completa o quorum e authorize sobe pra authorized de verdade", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_data_governance_status_authenticated: [
      statusRecord({ approvedCount: 1 }),
      statusRecord({ approvedCount: 2, state: "authorized", authorizedAt: "2026-09-26T00:00:00.000Z" }),
    ].map((data) => ({ data, error: null })),
    portal_approve_data_governance_authenticated: { data: { requestId: REQUEST_ID, state: "approval_pending", replayed: false }, error: null },
  });
  const svc = fakeRpcClient({
    portal_authorize_data_governance_request_service: { data: { requestId: REQUEST_ID, state: "authorized", replayed: false }, error: null },
  });
  const result = await actions.approveTenantDataGovernanceDisposition(REQUEST_ID, "approve", {
    authenticatedClient: auth.client, serviceClient: svc.client,
  });
  assert.equal(result.outcome, "recorded");
  assert.equal(result.status.state, "authorized");
  assert.equal(result.status.approvedCount, 2);
});

test("approve: decisão deny nunca tenta autorizar, mesmo com serviceClient indisponível", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_data_governance_status_authenticated: [
      statusRecord({ state: "approval_pending" }),
      statusRecord({ state: "denied" }),
    ].map((data) => ({ data, error: null })),
    portal_approve_data_governance_authenticated: { data: { requestId: REQUEST_ID, state: "denied", replayed: false }, error: null },
  });
  const result = await actions.approveTenantDataGovernanceDisposition(REQUEST_ID, "deny", {
    authenticatedClient: auth.client, serviceClient: null,
  });
  assert.equal(result.outcome, "recorded");
  assert.equal(result.status.state, "denied");
});

test("approve: erro 42501 na própria RPC de aprovar vira unauthorized", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_data_governance_status_authenticated: { data: statusRecord(), error: null },
    portal_approve_data_governance_authenticated: pgError("42501"),
  });
  const result = await actions.approveTenantDataGovernanceDisposition(REQUEST_ID, "approve", {
    authenticatedClient: auth.client, serviceClient: fakeRpcClient({}).client,
  });
  assertOutcome(result, { outcome: "unauthorized" });
});

test("approve: erro 55000 na própria RPC de aprovar (corrida: deixou de estar approval_pending) vira not_approvable", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_data_governance_status_authenticated: { data: statusRecord(), error: null },
    portal_approve_data_governance_authenticated: pgError("55000"),
  });
  const result = await actions.approveTenantDataGovernanceDisposition(REQUEST_ID, "approve", {
    authenticatedClient: auth.client, serviceClient: fakeRpcClient({}).client,
  });
  assertOutcome(result, { outcome: "not_approvable" });
});

// ---------------------------------------------------------------------------
// cancelTenantDataGovernanceDisposition
// ---------------------------------------------------------------------------

test("cancel: requestId que não é UUIDv7 é rejeitado antes de qualquer RPC", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({});
  const result = await actions.cancelTenantDataGovernanceDisposition("not-a-uuid", { authenticatedClient: auth.client });
  assertOutcome(result, { outcome: "unauthorized" });
  assert.equal(auth.calls.length, 0);
});

test("cancel: caminho feliz devolve cancelled com um receipt id gerado", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({
    portal_cancel_data_governance_request_authenticated: { data: { tenantId: TENANT_ID, requestId: REQUEST_ID, state: "cancelled", receiptId: "irrelevant", replayed: false }, error: null },
  });
  const result = await actions.cancelTenantDataGovernanceDisposition(REQUEST_ID, { authenticatedClient: auth.client });
  assertOutcome(result, { outcome: "cancelled" });
  const call = auth.calls.find((c) => c.name === "portal_cancel_data_governance_request_authenticated");
  assert.equal(call.args.p_request_id, REQUEST_ID);
  assert.match(call.args.p_receipt_id, UUID_V7_PATTERN);
});

test("cancel: erro 55000 (fora da janela cancelável) vira not_cancellable", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({ portal_cancel_data_governance_request_authenticated: pgError("55000") });
  const result = await actions.cancelTenantDataGovernanceDisposition(REQUEST_ID, { authenticatedClient: auth.client });
  assertOutcome(result, { outcome: "not_cancellable" });
});

test("cancel: erro 42501 vira unauthorized", async () => {
  const actions = loadDataGovernanceDispositionActions();
  const auth = fakeRpcClient({ portal_cancel_data_governance_request_authenticated: pgError("42501") });
  const result = await actions.cancelTenantDataGovernanceDisposition(REQUEST_ID, { authenticatedClient: auth.client });
  assertOutcome(result, { outcome: "unauthorized" });
});

// ---------------------------------------------------------------------------
// isTenantDispositionPurposeCode
// ---------------------------------------------------------------------------

test("isTenantDispositionPurposeCode aceita só os 3 códigos que scope=tenant permite, nunca data_subject_request", async () => {
  for (const code of ["contract_termination", "retention_expiry", "operator_correction"]) {
    assert.equal(isTenantDispositionPurposeCode(code), true);
  }
  for (const bad of ["data_subject_request", "", "CONTRACT_TERMINATION", null, undefined, 42]) {
    assert.equal(isTenantDispositionPurposeCode(bad), false);
  }
});

// ---------------------------------------------------------------------------
// adaptadores <form action> (redirect-based, mesmo idioma de calendar-connection.ts)
// ---------------------------------------------------------------------------

test("submitTenantDataGovernanceDispositionRequest: purposeCode inválido redireciona sem tocar nenhum client Supabase", async () => {
  const actions = loadDataGovernanceDispositionActions({
    moduleAuthenticatedClient: fakeRpcClient({}).client,
  });
  const formData = new FormData();
  formData.set("purposeCode", "data_subject_request");
  await assert.rejects(
    () => actions.submitTenantDataGovernanceDispositionRequest(formData),
    assertRedirect("/configuracoes?governance_error=motivo_invalido"),
  );
});

test("submitTenantDataGovernanceDispositionRequest: attestationReady=false redireciona com governance_error=nao_disponivel", async () => {
  const auth = fakeRpcClient({
    portal_prepare_data_governance_request_authenticated: { data: preparedRecord({ attestationReady: false }), error: null },
  });
  const actions = loadDataGovernanceDispositionActions({
    moduleAuthenticatedClient: auth.client, moduleServiceClient: fakeRpcClient({}).client,
  });
  const formData = new FormData();
  formData.set("purposeCode", "contract_termination");
  await assert.rejects(
    () => actions.submitTenantDataGovernanceDispositionRequest(formData),
    assertRedirect("/configuracoes?governance_error=nao_disponivel"),
  );
});

test("submitTenantDataGovernanceDispositionRequest: caminho feliz redireciona com governance_status=solicitado", async () => {
  const auth = fakeRpcClient({
    portal_prepare_data_governance_request_authenticated: { data: preparedRecord(), error: null },
    portal_request_data_governance_authenticated: { data: { requestId: REQUEST_ID, state: "requested", replayed: false }, error: null },
    portal_data_governance_status_authenticated: { data: statusRecord(), error: null },
  });
  const svc = fakeRpcClient({
    portal_decide_data_governance_policy_service: { data: { requestId: REQUEST_ID, state: "approval_pending", replayed: false }, error: null },
  });
  const actions = loadDataGovernanceDispositionActions({ moduleAuthenticatedClient: auth.client, moduleServiceClient: svc.client });
  const formData = new FormData();
  formData.set("purposeCode", "contract_termination");
  await assert.rejects(
    () => actions.submitTenantDataGovernanceDispositionRequest(formData),
    assertRedirect("/configuracoes?governance_status=solicitado"),
  );
});

test("approveTenantDataGovernanceDispositionRequest: requestId ausente redireciona pro erro de aprovação, sem tocar nenhum client", async () => {
  const actions = loadDataGovernanceDispositionActions({ moduleAuthenticatedClient: fakeRpcClient({}).client });
  await assert.rejects(
    () => actions.approveTenantDataGovernanceDispositionRequest(new FormData()),
    assertRedirect("/configuracoes?governance_error=falha_ao_aprovar"),
  );
});

test("approveTenantDataGovernanceDispositionRequest: caminho feliz redireciona com governance_status=registrado, sempre decision=approve", async () => {
  const auth = fakeRpcClient({
    portal_data_governance_status_authenticated: { data: statusRecord(), error: null },
    portal_approve_data_governance_authenticated: { data: { requestId: REQUEST_ID, state: "approval_pending", replayed: false }, error: null },
  });
  const svc = fakeRpcClient({ portal_authorize_data_governance_request_service: pgError("42501") });
  const actions = loadDataGovernanceDispositionActions({ moduleAuthenticatedClient: auth.client, moduleServiceClient: svc.client });
  const formData = new FormData();
  formData.set("requestId", REQUEST_ID);
  await assert.rejects(
    () => actions.approveTenantDataGovernanceDispositionRequest(formData),
    assertRedirect("/configuracoes?governance_status=registrado"),
  );
  const approveCall = auth.calls.find((c) => c.name === "portal_approve_data_governance_authenticated");
  assert.equal(approveCall.args.p_decision, "approve");
});

test("denyTenantDataGovernanceDispositionRequest: caminho feliz redireciona com governance_status=registrado, sempre decision=deny e nunca toca serviceClient", async () => {
  const auth = fakeRpcClient({
    portal_data_governance_status_authenticated: [statusRecord(), statusRecord({ state: "denied" })].map((data) => ({ data, error: null })),
    portal_approve_data_governance_authenticated: { data: { requestId: REQUEST_ID, state: "denied", replayed: false }, error: null },
  });
  const actions = loadDataGovernanceDispositionActions({ moduleAuthenticatedClient: auth.client, serviceRoleUnavailable: true });
  const formData = new FormData();
  formData.set("requestId", REQUEST_ID);
  await assert.rejects(
    () => actions.denyTenantDataGovernanceDispositionRequest(formData),
    assertRedirect("/configuracoes?governance_status=registrado"),
  );
  const approveCall = auth.calls.find((c) => c.name === "portal_approve_data_governance_authenticated");
  assert.equal(approveCall.args.p_decision, "deny");
});

test("cancelTenantDataGovernanceDispositionRequest: caminho feliz redireciona com governance_status=cancelado", async () => {
  const auth = fakeRpcClient({
    portal_cancel_data_governance_request_authenticated: { data: { tenantId: TENANT_ID, requestId: REQUEST_ID, state: "cancelled", receiptId: "x", replayed: false }, error: null },
  });
  const actions = loadDataGovernanceDispositionActions({ moduleAuthenticatedClient: auth.client });
  const formData = new FormData();
  formData.set("requestId", REQUEST_ID);
  await assert.rejects(
    () => actions.cancelTenantDataGovernanceDispositionRequest(formData),
    assertRedirect("/configuracoes?governance_status=cancelado"),
  );
});

test("cancelTenantDataGovernanceDispositionRequest: requestId ausente redireciona pro erro de cancelamento, sem tocar nenhum client", async () => {
  const actions = loadDataGovernanceDispositionActions({ moduleAuthenticatedClient: fakeRpcClient({}).client });
  await assert.rejects(
    () => actions.cancelTenantDataGovernanceDispositionRequest(new FormData()),
    assertRedirect("/configuracoes?governance_error=falha_ao_cancelar"),
  );
});
