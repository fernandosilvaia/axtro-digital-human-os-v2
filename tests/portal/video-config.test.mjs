import assert from "node:assert/strict";
import { test } from "node:test";

const videoConfig = await import("../../apps/portal/src/lib/video-config.ts");

function fakeSupabase({ configData = null, configError = null, digestData = null, digestError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "portal_agent_video_config") return { data: configData, error: configError };
      if (name === "portal_knowledge_digest") return { data: digestData, error: digestError };
      throw new Error(`unexpected rpc: ${name}`);
    },
  };
}

// D-V2-105: o MESMO bug ("erro de leitura virou 'sem persona' em silêncio")
// foi corrigido 4 vezes em 4 call sites diferentes antes deste helper
// existir (auditoria 2026-08-02 e 2026-08-06) — estes testes travam o
// contrato do único ponto de leitura pra não regredir uma quinta vez.
test("resolveAgentVideoConfig: falha de leitura NUNCA vira 'não configurado' — devolve ok:false", async () => {
  const supabase = fakeSupabase({ configError: { message: "db down" } });
  const result = await videoConfig.resolveAgentVideoConfig(supabase, "agent-1", "video");
  assert.equal(result.ok, false);
  assert.match(result.error, /Não foi possível ler a configuração/);
});

test("resolveAgentVideoConfig: sucesso devolve a config real, inclusive quando data é null (agente nunca configurado)", async () => {
  const supabaseNull = fakeSupabase({ configData: null });
  const resultNull = await videoConfig.resolveAgentVideoConfig(supabaseNull, "agent-1", "video");
  assert.deepEqual(resultNull, { ok: true, config: { configured: false } });

  const supabaseConfigured = fakeSupabase({ configData: { configured: true, persona_id: "p1", language: "english" } });
  const resultConfigured = await videoConfig.resolveAgentVideoConfig(supabaseConfigured, "agent-1", "presentation");
  assert.equal(resultConfigured.ok, true);
  assert.equal(resultConfigured.config.persona_id, "p1");
  assert.equal(resultConfigured.config.language, "english");
});

test("resolveAgentVideoConfig: chama a RPC com o agentId certo", async () => {
  const supabase = fakeSupabase({ configData: { configured: false } });
  await videoConfig.resolveAgentVideoConfig(supabase, "agent-xyz", "meeting");
  assert.deepEqual(supabase.calls, [{ name: "portal_agent_video_config", args: { p_agent_id: "agent-xyz" } }]);
});

test("fetchKnowledgeDigest: falha de RPC degrada pra null — NUNCA bloqueia o vídeo (diferente da config)", async () => {
  const supabase = fakeSupabase({ digestError: { message: "db down" } });
  const digest = await videoConfig.fetchKnowledgeDigest(supabase, "agent-1", "video", 3500);
  assert.equal(digest, null);
});

test("fetchKnowledgeDigest: exceção inesperada também degrada pra null, não propaga", async () => {
  const supabase = { rpc: async () => { throw new Error("network exploded"); } };
  const digest = await videoConfig.fetchKnowledgeDigest(supabase, "agent-1", "video", 3500);
  assert.equal(digest, null);
});

test("fetchKnowledgeDigest: content vazio ou ausente vira null, não string vazia", async () => {
  const supabaseEmpty = fakeSupabase({ digestData: { content: "" } });
  assert.equal(await videoConfig.fetchKnowledgeDigest(supabaseEmpty, "a1", "video", 3500), null);

  const supabaseNoContent = fakeSupabase({ digestData: {} });
  assert.equal(await videoConfig.fetchKnowledgeDigest(supabaseNoContent, "a1", "video", 3500), null);
});

test("fetchKnowledgeDigest: devolve o conteúdo real e respeita p_max_chars passado", async () => {
  const supabase = fakeSupabase({ digestData: { content: "Preço: R$500/mês" } });
  const digest = await videoConfig.fetchKnowledgeDigest(supabase, "agent-1", "presentation", 2400);
  assert.equal(digest, "Preço: R$500/mês");
  assert.deepEqual(supabase.calls, [{ name: "portal_knowledge_digest", args: { p_max_chars: 2400 } }]);
});
