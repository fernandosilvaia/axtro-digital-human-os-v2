import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { transpileModule, ModuleKind, ScriptTarget, JsxEmit } from "typescript";

const sourceRoot = new URL("../../apps/portal/src/", import.meta.url);
const componentUrl = new URL("app/(app)/agentes/[id]/testar/video-config.tsx", sourceRoot);
const mocks = new Map([
  ["@/lib/supabase/server", `export async function createClient() { return {
    async rpc(name, args) {
      const state = globalThis.__videoPreferencesTest;
      state.calls.push({ name, args });
      return state.responses[name] ?? { data: null, error: null };
    }
  }; }`],
  ["next/navigation", "export function useRouter() { return { refresh() {} }; }"],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mocks.has(specifier)) return { url: `video-preferences-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    if (specifier.startsWith("@/")) return { url: new URL(`${specifier.slice(2)}.ts`, sourceRoot).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("video-preferences-mock:")) return {
      format: "module", source: mocks.get(decodeURIComponent(url.slice("video-preferences-mock:".length))), shortCircuit: true,
    };
    if (url.startsWith("file:") && fileURLToPath(url) === fileURLToPath(componentUrl)) return {
      format: "module", shortCircuit: true,
      source: transpileModule(readFileSync(fileURLToPath(componentUrl), "utf8"), {
        fileName: fileURLToPath(componentUrl),
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});
const actions = await import("../../apps/portal/src/lib/actions/agent-video-config.ts");
const { VideoConfig } = await import(componentUrl.href);
const requirePortal = createRequire(new URL("../../apps/portal/package.json", import.meta.url));
const { createElement } = await import(pathToFileURL(requirePortal.resolve("react")).href);
const { renderToStaticMarkup } = await import(pathToFileURL(requirePortal.resolve("react-dom/server")).href);
const agentId = "019f0000-0000-7000-8000-000000000101";
const preferences = { language: "english", spokenLanguages: ["english", "spanish"], closerVertical: "metodo_silva" };
const config = { configured: true, persona_id: "pownedfixture", replica_id: "rownedfixture" };
function reset(data = config, error = null, writeError = null) {
  globalThis.__videoPreferencesTest = { calls: [], responses: {
    portal_agent_video_config: { data, error },
    portal_set_agent_video_config: { data: { ok: true }, error: writeError },
  } };
  return globalThis.__videoPreferencesTest;
}

test("video preference action derives asset IDs from authenticated configuration and ignores caller substitutions", async () => {
  const state = reset();
  assert.deepEqual(await actions.setAgentVideoConfig(agentId, {
    ...preferences, personaId: "pforeignfixture", replicaId: "rforeignfixture",
  }), { error: null });
  assert.deepEqual(state.calls, [
    { name: "portal_agent_video_config", args: { p_agent_id: agentId } },
    { name: "portal_set_agent_video_config", args: {
      p_agent_id: agentId, p_persona_id: config.persona_id, p_replica_id: config.replica_id,
      p_language: "english", p_spoken_languages: ["english", "spanish"], p_closer_vertical: "metodo_silva",
    } },
  ]);
});

test("video preference action preserves null asset identities, including replica-only configurations", async () => {
  for (const [personaId, replicaId] of [[null, "rownedfixture"], ["pownedfixture", null]]) {
    const state = reset({ configured: true, persona_id: personaId, replica_id: replicaId });
    assert.deepEqual(await actions.setAgentVideoConfig(agentId, preferences), { error: null });
    assert.equal(state.calls[1].args.p_persona_id, personaId);
    assert.equal(state.calls[1].args.p_replica_id, replicaId);
  }
});

test("unconfigured or missing asset bindings require governed onboarding without a write RPC", async () => {
  for (const data of [null, {}, { configured: false }, { configured: true, persona_id: null, replica_id: null }]) {
    const state = reset(data);
    assert.match((await actions.setAgentVideoConfig(agentId, preferences)).error, /onboarding governado/);
    assert.equal(state.calls.length, 1);
  }
});

test("configuration read failure prevents a write and does not masquerade as unconfigured", async () => {
  const state = reset(null, { message: "internal transport failure" });
  const result = await actions.setAgentVideoConfig(agentId, preferences);
  assert.match(result.error, /Não foi possível ler/);
  assert.doesNotMatch(result.error, /internal transport/);
  assert.equal(state.calls.length, 1);
});

test("concurrent asset reassignment returns the stable governed provisioning message", async () => {
  reset(config, null, { code: "42501", message: "video asset assignment requires governed provisioning" });
  assert.match((await actions.setAgentVideoConfig(agentId, preferences)).error, /provisionamento aprovado pela plataforma/);
});

test("preference authorization remains enforced by the RPC", async () => {
  reset(config, null, { code: "42501", message: "only a tenant_admin can configure agent video" });
  assert.match((await actions.setAgentVideoConfig(agentId, preferences)).error, /Somente administradores/);
});

function render(status, isAdmin = true) {
  return renderToStaticMarkup(createElement(VideoConfig, { agentId, isAdmin, status }));
}
const status = { configured: true, personaId: "pownedfixture", replicaId: "rownedfixture",
  language: "english", spokenLanguages: ["english"], closerVertical: "metodo_silva" };

test("rendered asset identifiers are read-only while admin preference controls remain available", () => {
  const html = render(status);
  for (const id of ["video-persona", "video-replica"]) {
    const field = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(field, `${id} is visible`);
    assert.match(field, /readonly/i);
  }
  assert.match(html, /id="video-language"/);
  assert.match(html, /id="video-vertical"/);
  assert.match(html, /Salvar idioma e vertical/);
  assert.match(html, /não comprova a autorização de uso de imagem ou voz/);
});

test("unconfigured rendered UI exposes governed onboarding with no asset assignment or save controls", () => {
  const html = render({ ...status, configured: false, personaId: null, replicaId: null });
  assert.match(html, /onboarding governado pendente/);
  assert.doesNotMatch(html, /id="video-(persona|replica|language|vertical)"/);
  assert.doesNotMatch(html, /<button/);
});

test("operators see the existing binding without preference mutation controls", () => {
  const html = render(status, false);
  assert.match(html, /Só um administrador/);
  assert.doesNotMatch(html, /<button|<select/);
});
