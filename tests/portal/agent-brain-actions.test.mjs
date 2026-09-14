import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

/**
 * Server actions do cérebro customizado (D-V2-176).
 *
 * O que estes testes protegem não é a chamada de RPC, é a disciplina do
 * segredo. O cérebro é o que faz a persona de vídeo usar a NOSSA doutrina em
 * vez do modelo cru do provedor, e o segredo é a única coisa que autentica
 * essa chamada. Se ele vazar para o banco em texto puro, qualquer leitura da
 * tabela passa a conseguir falar pela agente.
 */
const mockSources = new Map([
  ["@/lib/supabase/server", `
    export async function createClient() {
      return {
        rpc: async (name, args) => {
          const state = globalThis.__brainActionsState;
          state.calls.push({ name, args });
          return state.responses[name] ?? { data: null, error: null };
        },
      };
    }
  `],
]);

const PORTAL_SRC = new URL("../../apps/portal/src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mockSources.has(specifier)) return { url: `brain-actions-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    // O alias `@/` do portal nao existe para o Node. Resolvido para o caminho
    // real de proposito, em vez de mocado: o modulo de segredo precisa ser o
    // VERDADEIRO, senao o teste do hash compararia um fake com ele mesmo.
    if (specifier.startsWith("@/")) {
      // O alias tambem omite a extensao, que o resolvedor do Node exige.
      return { url: new URL(`${specifier.slice(2)}.ts`, PORTAL_SRC).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("brain-actions-mock:")) {
      const specifier = decodeURIComponent(url.slice("brain-actions-mock:".length));
      return { format: "module", source: mockSources.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const actions = await import("../../apps/portal/src/lib/actions/agent-brain.ts");
const secretModule = await import("../../apps/portal/src/lib/brain/secret.ts");

function reset(responses = {}) {
  globalThis.__brainActionsState = { calls: [], responses };
  return globalThis.__brainActionsState;
}

const AGENT = "019f0000-0000-7000-8000-000000000101";

test("o segredo bruto NUNCA chega ao banco, só o hash dele", async () => {
  const harness = reset();
  const result = await actions.rotateAgentBrainSecret(AGENT);

  assert.equal(result.error, null);
  assert.ok(typeof result.secret === "string" && result.secret.length > 0);

  const call = harness.calls.find((c) => c.name === "portal_rotate_agent_brain_secret");
  assert.ok(call !== undefined, "a rotação precisa chamar a RPC");
  assert.equal(call.args.p_secret_hash, secretModule.hashBrainSecret(result.secret));
  assert.notEqual(call.args.p_secret_hash, result.secret);
  assert.ok(
    !JSON.stringify(call.args).includes(result.secret),
    "o segredo em claro não pode aparecer em nenhum argumento enviado ao banco",
  );
});

test("cada rotação devolve um segredo diferente", async () => {
  reset();
  const first = await actions.rotateAgentBrainSecret(AGENT);
  reset();
  const second = await actions.rotateAgentBrainSecret(AGENT);
  assert.notEqual(first.secret, second.secret);
});

test("falha na RPC nunca devolve segredo, para a tela não exibir algo que o banco não guardou", async () => {
  // Exibir um segredo que a rotação não persistiu seria pior que o erro: o
  // operador colaria no provedor uma chave que nunca vai autenticar.
  reset({ portal_rotate_agent_brain_secret: { data: null, error: { message: "only a tenant_admin can manage" } } });
  const result = await actions.rotateAgentBrainSecret(AGENT);
  assert.equal(result.secret, null);
  assert.match(result.error, /administradores/);
});

test("erro de permissão e de agente inexistente viram mensagem de produto, não mensagem de banco", async () => {
  reset({ portal_set_agent_brain_enabled: { data: null, error: { message: "agent not found" } } });
  const notFound = await actions.setAgentBrainEnabled(AGENT, true);
  assert.match(notFound.error, /não encontrado/);

  reset({ portal_set_agent_brain_enabled: { data: null, error: { message: "not configured" } } });
  const notConfigured = await actions.setAgentBrainEnabled(AGENT, true);
  assert.match(notConfigured.error, /Gere um segredo/);
});

test("status ilegível degrada para não configurado em vez de mentir que está ligado", async () => {
  // Fail-closed: dizer "ativo" sem conseguir confirmar faria o operador achar
  // que a doutrina está valendo numa call em que ela não está.
  reset({ portal_agent_brain_status: { data: null, error: { message: "boom" } } });
  assert.deepEqual(await actions.fetchAgentBrainStatus(AGENT), { configured: false, enabled: null, rotatedAt: null });

  reset({ portal_agent_brain_status: { data: "não é objeto", error: null } });
  assert.deepEqual(await actions.fetchAgentBrainStatus(AGENT), { configured: false, enabled: null, rotatedAt: null });
});

test("status configurado é repassado fielmente", async () => {
  reset({
    portal_agent_brain_status: {
      data: { configured: true, enabled: true, rotated_at: "2026-09-14T00:00:00Z" },
      error: null,
    },
  });
  assert.deepEqual(await actions.fetchAgentBrainStatus(AGENT), {
    configured: true, enabled: true, rotatedAt: "2026-09-14T00:00:00Z",
  });
});
