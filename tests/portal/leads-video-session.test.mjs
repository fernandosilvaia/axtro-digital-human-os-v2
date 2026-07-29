import assert from "node:assert/strict";
import { test } from "node:test";

const videoSession = await import("../../apps/portal/src/lib/leads/video-session.ts");

const SECRET = "s".repeat(32);
const PERSONA = { personaId: "pa2dcc2d9c3e", agentName: "Raissa" };

function fakeDeps(overrides = {}) {
  const calls = { resolvePlatformAgentPersona: 0, createConversation: [] };
  return {
    calls,
    deps: {
      resolvePlatformAgentPersona: async () => {
        calls.resolvePlatformAgentPersona += 1;
        return overrides.persona !== undefined ? overrides.persona : PERSONA;
      },
      createConversation: async (params) => {
        calls.createConversation.push(params);
        if (overrides.createConversationThrows) throw new Error("tavus down");
        return { url: "https://tavus.daily.co/abc123", conversationId: "abc123" };
      },
    },
  };
}

test("rejects a missing Authorization header without resolving the persona", async () => {
  const { deps, calls } = fakeDeps();
  await assert.rejects(
    () => videoSession.handleVideoSessionRequest({ authorizationHeader: null, expectedSecret: SECRET }, deps),
    (error) => error instanceof videoSession.VideoSessionError && error.code === "missing_bearer" && error.status === 401,
  );
  assert.equal(calls.resolvePlatformAgentPersona, 0);
});

test("rejects a malformed bearer without resolving the persona", async () => {
  const { deps, calls } = fakeDeps();
  for (const header of ["Basic abc", "Bearer ", "wrong-format"]) {
    await assert.rejects(
      () => videoSession.handleVideoSessionRequest({ authorizationHeader: header, expectedSecret: SECRET }, deps),
      (error) => error instanceof videoSession.VideoSessionError && error.code === "missing_bearer",
    );
  }
  assert.equal(calls.resolvePlatformAgentPersona, 0);
});

test("rejects a wrong secret, even with the correct length", async () => {
  const { deps, calls } = fakeDeps();
  const wrong = "x".repeat(32);
  await assert.rejects(
    () => videoSession.handleVideoSessionRequest({ authorizationHeader: `Bearer ${wrong}`, expectedSecret: SECRET }, deps),
    (error) => error instanceof videoSession.VideoSessionError && error.code === "invalid_secret" && error.status === 401,
  );
  assert.equal(calls.resolvePlatformAgentPersona, 0);
});

test("rejects a secret of a different length without leaking which is shorter", async () => {
  const { deps } = fakeDeps();
  await assert.rejects(
    () => videoSession.handleVideoSessionRequest({ authorizationHeader: "Bearer short", expectedSecret: SECRET }, deps),
    (error) => error instanceof videoSession.VideoSessionError && error.code === "invalid_secret",
  );
});

test("treats an unconfigured RAISSA_TOOLS_SECRET as not_configured, before checking the bearer", async () => {
  const { deps, calls } = fakeDeps();
  for (const expectedSecret of [null, "", "tooshort"]) {
    await assert.rejects(
      () => videoSession.handleVideoSessionRequest({ authorizationHeader: `Bearer ${SECRET}`, expectedSecret }, deps),
      (error) => error instanceof videoSession.VideoSessionError && error.code === "not_configured" && error.status === 503,
    );
  }
  assert.equal(calls.resolvePlatformAgentPersona, 0);
});

test("returns 503 not_configured when no platform-presentation agent is set up, without calling the provider", async () => {
  const { deps, calls } = fakeDeps({ persona: null });
  await assert.rejects(
    () => videoSession.handleVideoSessionRequest({ authorizationHeader: `Bearer ${SECRET}`, expectedSecret: SECRET }, deps),
    (error) => error instanceof videoSession.VideoSessionError && error.code === "not_configured" && error.status === 503,
  );
  assert.equal(calls.createConversation.length, 0);
});

test("wraps a provider failure as a typed 502 instead of leaking the raw error", async () => {
  const { deps } = fakeDeps({ createConversationThrows: true });
  await assert.rejects(
    () => videoSession.handleVideoSessionRequest({ authorizationHeader: `Bearer ${SECRET}`, expectedSecret: SECRET }, deps),
    (error) => error instanceof videoSession.VideoSessionError && error.code === "provider_unavailable" && error.status === 502,
  );
});

test("happy path: authenticates, resolves the persona, creates the conversation, and returns the join URL", async () => {
  const { deps, calls } = fakeDeps();
  const result = await videoSession.handleVideoSessionRequest(
    { authorizationHeader: `Bearer ${SECRET}`, expectedSecret: SECRET, leadName: "Maria", language: "portuguese" },
    deps,
  );
  assert.deepEqual(result, { url: "https://tavus.daily.co/abc123", conversationId: "abc123" });
  assert.deepEqual(calls.createConversation[0], { personaId: "pa2dcc2d9c3e", leadName: "Maria", language: "portuguese" });
});

test("ignores an unknown language and passes null instead of an unvalidated string", async () => {
  const { deps, calls } = fakeDeps();
  await videoSession.handleVideoSessionRequest(
    { authorizationHeader: `Bearer ${SECRET}`, expectedSecret: SECRET, language: "klingon" },
    deps,
  );
  assert.equal(calls.createConversation[0].language, null);
});

test("trims lead name and rejects an oversized one by dropping it to null rather than failing", async () => {
  const { deps, calls } = fakeDeps();
  await videoSession.handleVideoSessionRequest(
    { authorizationHeader: `Bearer ${SECRET}`, expectedSecret: SECRET, leadName: "  Maria  " },
    deps,
  );
  assert.equal(calls.createConversation[0].leadName, "Maria");

  await videoSession.handleVideoSessionRequest(
    { authorizationHeader: `Bearer ${SECRET}`, expectedSecret: SECRET, leadName: "x".repeat(121) },
    deps,
  );
  assert.equal(calls.createConversation[1].leadName, null);
});
