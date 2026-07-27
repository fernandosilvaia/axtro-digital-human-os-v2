import assert from "node:assert/strict";
import { test } from "node:test";

// chat-completion-core.ts (via handle-chat-request.ts) só importa
// metodo-silva.ts (também sem imports) — cadeia inteira é puro TS, o type
// stripping nativo do Node executa direto do fonte.
const handler = await import("../../apps/portal/src/lib/brain/handle-chat-request.ts");
const secret = await import("../../apps/portal/src/lib/brain/secret.ts");

const RAW_SECRET = secret.generateBrainSecret();
const SECRET_HASH = secret.hashBrainSecret(RAW_SECRET);
const AGENT = {
  tenantId: "t-1",
  agentId: "agent-1",
  agentName: "Rafaela",
  tenantName: "Axtro Solar",
  enabled: true,
};

function fakeDeps(overrides = {}) {
  const calls = { resolveConfig: [], retrieveKnowledge: [], generate: [], logGenerationUsage: [] };
  return {
    calls,
    deps: {
      resolveConfig: async (hash) => {
        calls.resolveConfig.push(hash);
        return overrides.resolveConfig ? overrides.resolveConfig(hash) : (hash === SECRET_HASH ? AGENT : null);
      },
      retrieveKnowledge: async (tenantId, queryText) => {
        calls.retrieveKnowledge.push({ tenantId, queryText });
        return overrides.retrieveKnowledge ? overrides.retrieveKnowledge() : [];
      },
      generate: async (messages, maxOutputTokens) => {
        calls.generate.push({ messages, maxOutputTokens });
        if (overrides.generateThrows) throw new Error("provider_unavailable");
        return { text: "resposta da persona", model: "fake/model", usage: { inputTokens: 50, outputTokens: 10 } };
      },
      logGenerationUsage: async (tenantId, agentId, inputTokens, outputTokens) => {
        calls.logGenerationUsage.push({ tenantId, agentId, inputTokens, outputTokens });
      },
    },
  };
}

const VALID_MESSAGES = [{ role: "user", content: "Quanto custa a instalação?" }];

test("rejects a missing Authorization header before touching resolveConfig", async () => {
  const { deps, calls } = fakeDeps();
  await assert.rejects(
    () => handler.handleBrainChatRequest({ authorizationHeader: null, agentIdFromPath: "agent-1", rawMessages: VALID_MESSAGES }, deps),
    (error) => error instanceof handler.BrainHttpError && error.code === "missing_bearer" && error.status === 401,
  );
  assert.equal(calls.resolveConfig.length, 0);
});

test("rejects a malformed bearer (wrong shape) before touching resolveConfig", async () => {
  const { deps, calls } = fakeDeps();
  for (const header of ["Bearer short", "Basic abc123", `Bearer ${RAW_SECRET.toUpperCase()}`, "Bearer "]) {
    await assert.rejects(
      () => handler.handleBrainChatRequest({ authorizationHeader: header, agentIdFromPath: "agent-1", rawMessages: VALID_MESSAGES }, deps),
      (error) => error instanceof handler.BrainHttpError && error.code === "missing_bearer",
    );
  }
  assert.equal(calls.resolveConfig.length, 0);
});

test("rejects an unknown secret with invalid_secret", async () => {
  const { deps } = fakeDeps({ resolveConfig: () => null });
  await assert.rejects(
    () => handler.handleBrainChatRequest({ authorizationHeader: `Bearer ${RAW_SECRET}`, agentIdFromPath: "agent-1", rawMessages: VALID_MESSAGES }, deps),
    (error) => error instanceof handler.BrainHttpError && error.code === "invalid_secret" && error.status === 401,
  );
});

test("rejects a disabled config with invalid_secret", async () => {
  const { deps } = fakeDeps({ resolveConfig: () => ({ ...AGENT, enabled: false }) });
  await assert.rejects(
    () => handler.handleBrainChatRequest({ authorizationHeader: `Bearer ${RAW_SECRET}`, agentIdFromPath: "agent-1", rawMessages: VALID_MESSAGES }, deps),
    (error) => error instanceof handler.BrainHttpError && error.code === "invalid_secret",
  );
});

test("rejects a secret whose resolved agent does not match the URL path, with the same generic message as an invalid secret", async () => {
  const { deps } = fakeDeps();
  let caught;
  try {
    await handler.handleBrainChatRequest({ authorizationHeader: `Bearer ${RAW_SECRET}`, agentIdFromPath: "some-other-agent", rawMessages: VALID_MESSAGES }, deps);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof handler.BrainHttpError);
  assert.equal(caught.code, "agent_mismatch");
  assert.equal(caught.status, 401);
  assert.equal(caught.message, "no active brain config for this secret");
});

test("malformed Tavus messages degrade to the fallback reply instead of throwing", async () => {
  const { deps, calls } = fakeDeps();
  const result = await handler.handleBrainChatRequest(
    { authorizationHeader: `Bearer ${RAW_SECRET}`, agentIdFromPath: "agent-1", rawMessages: [] },
    deps,
  );
  assert.equal(result.degraded, true);
  assert.ok(result.reply.length > 0);
  assert.equal(calls.generate.length, 0);
});

test("a knowledge retrieval failure degrades only the knowledge, not the whole reply", async () => {
  const { deps, calls } = fakeDeps({ retrieveKnowledge: () => { throw new Error("rag down"); } });
  const result = await handler.handleBrainChatRequest(
    { authorizationHeader: `Bearer ${RAW_SECRET}`, agentIdFromPath: "agent-1", rawMessages: VALID_MESSAGES },
    deps,
  );
  assert.equal(result.degraded, false);
  assert.equal(result.reply, "resposta da persona");
  assert.equal(calls.generate.length, 1);
});

test("a provider failure after successful auth degrades to the fallback reply, never throws", async () => {
  const { deps, calls } = fakeDeps({ generateThrows: true });
  const result = await handler.handleBrainChatRequest(
    { authorizationHeader: `Bearer ${RAW_SECRET}`, agentIdFromPath: "agent-1", rawMessages: VALID_MESSAGES },
    deps,
  );
  assert.equal(result.degraded, true);
  assert.equal(calls.logGenerationUsage.length, 0);
});

test("happy path: resolves config, retrieves knowledge scoped to the resolved tenant, generates with the video surface, and logs usage under the resolved tenant/agent", async () => {
  const { deps, calls } = fakeDeps();
  const result = await handler.handleBrainChatRequest(
    { authorizationHeader: `Bearer ${RAW_SECRET}`, agentIdFromPath: "agent-1", rawMessages: VALID_MESSAGES },
    deps,
  );
  assert.equal(result.reply, "resposta da persona");
  assert.equal(result.degraded, false);
  assert.equal(calls.resolveConfig[0], SECRET_HASH);
  assert.deepEqual(calls.retrieveKnowledge[0], { tenantId: "t-1", queryText: "Quanto custa a instalação?" });
  assert.match(calls.generate[0].messages.find((m) => m.role === "system").content, /VIDEOCHAMADA/);
  assert.deepEqual(calls.logGenerationUsage[0], { tenantId: "t-1", agentId: "agent-1", inputTokens: 50, outputTokens: 10 });
});

test("authenticateBrainRequest alone rejects without ever needing a request body", async () => {
  const { deps } = fakeDeps();
  const agent = await handler.authenticateBrainRequest(
    { authorizationHeader: `Bearer ${RAW_SECRET}`, agentIdFromPath: "agent-1" },
    deps.resolveConfig,
  );
  assert.deepEqual(agent, AGENT);
});
