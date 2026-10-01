import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../../apps/portal/src/lib/actions/resources.ts', import.meta.url), 'utf8');
const id = '019b0000-0000-7000-8000-000000000001';
function load(options = {}) {
  const calls = [];
  const sources = options.sources ?? [{id, status: 'pending'}];
  const supabase = {async rpc(name) {
    calls.push(name);
    if (name === 'portal_list_knowledge_sources') return {data: sources, error: options.listError ?? null};
    return {data: {ok: true}, error: null};
  }};
  const mocks = new Map([
    ['next/cache', {revalidatePath() {calls.push('revalidate');}}],
    ['@axtro/domain', {createUuidV7: () => id, isUuidV7: v => v === id}],
    ['@/lib/agent-video', {}], ['@/lib/email', {}],
    ['@/lib/portal-data', {async fetchTenantOverview() {return {provisioned: true, tenant: {id: 'tenant-a'}, role: options.role ?? 'tenant_admin'};}}],
    ['@/lib/supabase/server', {async createClient() {calls.push('client'); return supabase;}}],
    ['@/lib/supabase/service', {createServiceRoleClient() {calls.push('service'); return {};}}],
    ['@/lib/telemetry', {logError() {calls.push('telemetry');}}],
    ['@/lib/knowledge', {
      MAX_CONTENT_CHARS: 10000, fakeProvidersEnabled: () => options.fake === true,
      contentSha256: () => 'a'.repeat(64), chunkContent: () => ['synthetic content'],
      assertEmbeddingInputsWithinReservedBudget() {},
      async embedChunks() {calls.push('provider'); return {chunks: [], inputTokens: 10};},
    }],
    ['@/lib/ai-budget/reservations', {
      AI_USAGE_LIMITS: {knowledge_ingestion_embedding: {maxInputTokens: 20000}},
      stableAiUsageIdempotencyKey: () => 'stable',
      async executeReservedAiUsage(input) {calls.push('reserve'); return {outcome: 'committed', value: await input.execute()};},
    }],
  ]);
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  new vm.Script(compiled).runInNewContext({exports, require(name) {if (!mocks.has(name)) throw Error(`unmocked ${name}`); return mocks.get(name);}, process: {env: {OPENROUTER_API_KEY: 'synthetic-test-only'}}, Date, FormData, Error});
  const form = new FormData(); form.set('source_id', id); form.set('content', 'synthetic content');
  return {calls, run: () => exports.updateKnowledgeSourceContent({error: null, done: false}, form), create: () => { const createForm = new FormData(); createForm.set('display_name', 'Synthetic source'); createForm.set('source_type', 'faq'); createForm.set('data_classification', 'internal'); createForm.set('content', 'synthetic content'); return exports.createKnowledgeSource({error: null, done: false}, createForm); }};
}
for (const fake of [false, true]) {
  for (const role of ['tenant_operator', 'unknown']) test(`role ${role} cannot dispatch (fake=${fake})`, async () => {
    const h = load({role, fake}); assert.equal((await h.run()).done, false); assert.deepEqual(h.calls, []);
  });
  for (const [label, options] of [['unowned', {sources: []}], ['revoked', {sources: [{id, status: 'revoked'}]}], ['disabled', {sources: [{id, status: 'disabled'}]}], ['deleted', {sources: [{id, status: 'deleted'}]}], ['unknown status', {sources: [{id, status: 'unexpected'}]}], ['lookup failure', {listError: {message: 'synthetic'}}]]) test(`${label} cannot reserve or dispatch (fake=${fake})`, async () => {
    const h = load({...options, fake}); assert.equal((await h.run()).done, false);
    assert.deepEqual(h.calls, ['client', 'portal_list_knowledge_sources']);
  });
  for (const status of ['pending', 'active', 'stale']) test(`admin ingests ${status} (fake=${fake})`, async () => {
    const h = load({fake, sources: [{id, status}]}); assert.equal((await h.run()).done, true);
    assert.ok(h.calls.indexOf('portal_list_knowledge_sources') < h.calls.indexOf('provider'));
    assert.ok(h.calls.includes('portal_ingest_knowledge'));
    assert.equal(h.calls.includes('reserve'), !fake);
  });
}

for (const fake of [false, true]) test(`operator cannot create source or dispatch (fake=${fake})`, async () => {
  const h = load({fake, role: 'tenant_operator'}); assert.equal((await h.create()).done, false); assert.deepEqual(h.calls, []);
});
