import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { transpileModule, ModuleKind, ScriptTarget, JsxEmit } from "typescript";

const sourceRoot = new URL("../../apps/portal/src/", import.meta.url);
const sourcePath = fileURLToPath(sourceRoot);
const mocks = new Map([
  ["@/lib/portal-data", `export async function fetchAgents() { return globalThis.__resourceUi.agents; }
    export async function fetchKnowledgeSources() { return globalThis.__resourceUi.sources; }
    export async function fetchTenantOverview() { return { role: globalThis.__resourceUi.role }; }`],
  ["@/lib/site", 'export const SITE_NAME = "Synthetic portal";'],
  ["next/navigation", "export function useRouter() { return { refresh() {} }; }"],
  ["@/lib/actions/resources", `
    function unusedAction() { throw new Error("SSR must not execute a resource mutation"); }
    export const createAgent = unusedAction;
    export const createKnowledgeSource = unusedAction;
    export const setAgentStatus = unusedAction;
    export const setKnowledgeSourceStatus = unusedAction;
    export const updateKnowledgeSourceContent = unusedAction;
  `],
]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (mocks.has(specifier)) return { url: `resource-ui-mock:${encodeURIComponent(specifier)}`, shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), sourceRoot);
      for (const extension of [".ts", ".tsx"]) {
        const url = base.href + extension;
        if (existsSync(fileURLToPath(url))) return { url, shortCircuit: true };
      }
    }
    if (context.parentURL?.startsWith("file:") && specifier.startsWith(".")) {
      const base = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".tsx"]) {
        const url = base.href + extension;
        if (existsSync(fileURLToPath(url))) return { url, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("resource-ui-mock:")) return {
      format: "module", source: mocks.get(decodeURIComponent(url.slice("resource-ui-mock:".length))), shortCircuit: true,
    };
    if (url.startsWith("file:")) {
      const path = fileURLToPath(url);
      if (path.startsWith(sourcePath) && /\.tsx?$/.test(path)) return {
        format: "module", shortCircuit: true,
        source: transpileModule(readFileSync(path, "utf8"), { fileName: path,
          compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX },
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
const { default: AgentsPage } = await import(new URL("app/(app)/agentes/page.tsx", sourceRoot).href);
const { default: KnowledgePage } = await import(new URL("app/(app)/conhecimento/page.tsx", sourceRoot).href);
const { SourceActions } = await import(new URL("app/(app)/conhecimento/source-actions.tsx", sourceRoot).href);
const requirePortal = createRequire(new URL("../../apps/portal/package.json", import.meta.url));
const { createElement } = await import(pathToFileURL(requirePortal.resolve("react")).href);
const { renderToStaticMarkup } = await import(pathToFileURL(requirePortal.resolve("react-dom/server")).href);
const createdAt = "2026-10-01T00:00:00Z";
function reset(role = "tenant_admin") {
  globalThis.__resourceUi = { role, agents: ["draft", "active", "disabled", "archived"].map((status, index) => ({
    id: `agent-${index}`, name: `Synthetic ${status}`, role_type: "sales", status, created_at: createdAt,
  })), sources: ["pending", "active", "disabled", "stale"].map((status, index) => ({
    id: `source-${index}`, display_name: `Synthetic ${status}`, source_type: "document",
    data_classification: "internal", status, created_at: createdAt,
  })) };
}
function assertNoDeletionControls(html) {
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  for (const button of buttons) assert.doesNotMatch(button, /Excluir|exclusão|Confirmar|purge|disposição/i);
  assert.doesNotMatch(html, /role="(?:dialog|alertdialog)"/);
}

test("actual agents page explains unavailable individual deletion and preserves admin activate/pause controls", async () => {
  reset();
  const html = renderToStaticMarkup(await AgentsPage());
  assert.match(html, /A exclusão individual de agentes está indisponível/);
  assert.match(html, />Ativar<\/button>/);
  assert.match(html, />Pausar<\/button>/);
  assert.match(html, /onboarding e provisionamento aprovado pela plataforma/);
  assert.doesNotMatch(html, /provisionada automaticamente/);
  assertNoDeletionControls(html);
});

test("actual knowledge page explains retention and exposes no delete or tenant disposition substitutes", async () => {
  reset();
  const html = renderToStaticMarkup(await KnowledgePage());
  assert.match(html, /A exclusão individual de fontes está indisponível/);
  assert.match(html, /Revogar impede o uso do conteúdo e preserva o registro/);
  assertNoDeletionControls(html);
});

for (const [status, canRevoke, canReactivate] of [
  ["pending", false, false], ["active", true, false], ["disabled", false, true], ["stale", true, true],
]) {
  test(`actual ${status} source controls preserve valid revoke/reactivate actions without deletion`, () => {
    const html = renderToStaticMarkup(createElement(SourceActions, { sourceId: "source-fixture", sourceName: "Synthetic source", status }));
    assert.equal(html.includes('aria-label="Revogar a fonte Synthetic source"'), canRevoke);
    assert.equal(html.includes('aria-label="Reativar a fonte Synthetic source"'), canReactivate);
    assert.match(html, /Atualizar o conteúdo da fonte Synthetic source/);
    assertNoDeletionControls(html);
  });
}

test("actual operator pages do not offer administrative resource mutations", async () => {
  reset("tenant_operator");
  for (const Page of [AgentsPage, KnowledgePage]) {
    const html = renderToStaticMarkup(await Page());
    assert.doesNotMatch(html, /<button\b/);
    assertNoDeletionControls(html);
  }
});
