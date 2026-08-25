import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

const leadsSource = await readFile(
  new URL("../../apps/portal/src/lib/actions/leads.ts", import.meta.url),
  "utf8",
);

function baseInput(overrides = {}) {
  return {
    agentId: "agent-alpha",
    sessionId: "019b0000-0000-7000-8000-000000000002",
    presenterId: "019b0000-0000-7000-8000-000000000003",
    commandId: "019b0000-0000-7000-8000-000000000004",
    contactName: "Ana Prospect",
    contactEmail: "ana@example.test",
    ...overrides,
  };
}

function loadLeadsAction(options = {}) {
  const calls = { fetchOverview: 0, fetchAgents: 0, admit: [], register: [], telemetry: [] };
  const user = Object.hasOwn(options, "user") ? options.user : { id: "user-authenticated" };
  const overview = options.overview ?? { provisioned: true, role: "tenant_admin", tenant: { id: "tenant-resolved" } };
  const agents = options.agents ?? [{ id: "agent-alpha", name: "Agente Alpha", role_type: "sales", status: "active", created_at: "2026-01-01T00:00:00Z" }];
  const admissionResult = options.admissionResult ?? {
    outcome: "issued",
    code: "issued",
    grant: {
      tenantId: "tenant-resolved", agentId: "agent-alpha", sessionId: "019b0000-0000-7000-8000-000000000002",
      presenterId: "019b0000-0000-7000-8000-000000000003", actionKind: "register_lead",
      grantId: "019b0000-0000-7000-8000-000000000005", generationId: 0, commandFingerprint: "a".repeat(64),
    },
  };
  const registrationResult = options.registrationResult ?? { outcome: "registered", code: "registered", leadId: "019b0000-0000-7000-8000-000000000006" };

  const supabase = {
    auth: {
      async getUser() {
        return { data: { user } };
      },
    },
  };

  const mocks = new Map([
    ["@/lib/knowledge", {
      fakeProvidersEnabled() {
        return options.fakeProviders === true;
      },
    }],
    ["@/lib/runtime/portal-business-action-bridge", {
      async admitBusinessAction(input) {
        calls.admit.push(input);
        return admissionResult;
      },
      async registerBusinessLead(input) {
        calls.register.push(input);
        return registrationResult;
      },
    }],
    ["@/lib/portal-data", {
      async fetchTenantOverview() {
        calls.fetchOverview += 1;
        return overview;
      },
      async fetchAgents() {
        calls.fetchAgents += 1;
        return agents;
      },
    }],
    ["@/lib/supabase/server", {
      async createClient() {
        return supabase;
      },
    }],
    ["@/lib/telemetry", {
      logError(...args) {
        calls.telemetry.push(args);
      },
    }],
  ]);

  const compiled = ts.transpileModule(leadsSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "leads.ts",
  }).outputText;
  const module = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected leads action import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, { filename: "leads.runtime.cjs" });
  wrapper.runInNewContext({ Date, Error, Object, String, process })(requireMock, module, module.exports);
  return { actions: module.exports, calls };
}

test("registerLead rejects an unauthenticated caller before any tenant or admission lookup", async () => {
  const { actions, calls } = loadLeadsAction({ user: null });
  const result = await actions.registerLead(baseInput());
  assert.equal(result.leadId, null);
  assert.match(result.error, /sessão pode ter expirado/);
  assert.equal(calls.fetchOverview, 0);
  assert.equal(calls.admit.length, 0);
});

test("registerLead rejects a missing tenant before any admission lookup", async () => {
  const { actions, calls } = loadLeadsAction({ overview: { provisioned: false, role: null } });
  const result = await actions.registerLead(baseInput());
  assert.equal(result.leadId, null);
  assert.match(result.error, /não provisionada/);
  assert.equal(calls.admit.length, 0);
});

test("registerLead rejects an agent that does not belong to the resolved tenant", async () => {
  const { actions, calls } = loadLeadsAction({ agents: [] });
  const result = await actions.registerLead(baseInput());
  assert.equal(result.leadId, null);
  assert.match(result.error, /Agente não encontrado/);
  assert.equal(calls.admit.length, 0);
});

test("registerLead resolves tenantId server-side and never trusts a client-supplied tenant", async () => {
  const { actions, calls } = loadLeadsAction({});
  const result = await actions.registerLead(baseInput());
  assert.equal(result.leadId, "019b0000-0000-7000-8000-000000000006");
  assert.equal(result.error, null);
  assert.equal(calls.admit[0].tenantId, "tenant-resolved");
  assert.equal(calls.register[0].contactName, "Ana Prospect");
  assert.equal(calls.register[0].contactEmail, "ana@example.test");
});

test("registerLead surfaces an admission rejection without calling register", async () => {
  const { actions, calls } = loadLeadsAction({ admissionResult: { outcome: "rejected", code: "denied_essential_consent" } });
  const result = await actions.registerLead(baseInput());
  assert.equal(result.leadId, null);
  assert.match(result.error, /consentimento necessário/);
  assert.equal(calls.register.length, 0);
});

test("registerLead surfaces a registration rejection", async () => {
  const { actions } = loadLeadsAction({ registrationResult: { outcome: "rejected", code: "kill_switch_active" } });
  const result = await actions.registerLead(baseInput());
  assert.equal(result.leadId, null);
  assert.match(result.error, /pausado pela equipe/);
});

test("registerLead reports an unexpected admission failure in a real tenant but stays silent in a demo tenant", async () => {
  const real = loadLeadsAction({ admissionResult: { outcome: "rejected", code: "service_unavailable" }, fakeProviders: false });
  await real.actions.registerLead(baseInput());
  assert.equal(real.calls.telemetry.length, 1);
  assert.equal(real.calls.telemetry[0][0], "register_lead_admission_failed");

  const demo = loadLeadsAction({ admissionResult: { outcome: "rejected", code: "service_unavailable" }, fakeProviders: true });
  await demo.actions.registerLead(baseInput());
  assert.equal(demo.calls.telemetry.length, 0);
});
