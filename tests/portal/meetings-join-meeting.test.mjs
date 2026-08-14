import assert from "node:assert/strict";
import { test } from "node:test";

const joinMeeting = await import("../../apps/portal/src/lib/meetings/join-meeting.ts");

const PERSONA = { personaId: "pa2dcc2d9c3e", agentName: "Raissa" };

function fakeDeps(overrides = {}) {
  const calls = { resolveAgentPersona: [], createVideoConversation: [], createMeetingBot: [], recordSession: [], endVideoConversation: [], leaveMeetingBot: [] };
  return {
    calls,
    deps: {
      resolveAgentPersona: async (agentId) => {
        calls.resolveAgentPersona.push(agentId);
        return overrides.persona !== undefined ? overrides.persona : PERSONA;
      },
      createVideoConversation: async (persona) => {
        calls.createVideoConversation.push(persona);
        if (overrides.createVideoConversationThrows) throw new Error("tavus down");
        return { url: "https://tavus.daily.co/abc123", conversationId: "abc123" };
      },
      createMeetingBot: async (params) => {
        calls.createMeetingBot.push(params);
        if (overrides.createMeetingBotThrows) throw new Error("recall down");
        return { botId: "550e8400-e29b-41d4-a716-446655440000" };
      },
      recordSession: async (params) => {
        calls.recordSession.push(params);
        if (overrides.recordSessionThrows) throw new Error("db down");
      },
      endVideoConversation: async (conversationId) => {
        calls.endVideoConversation.push(conversationId);
        if (overrides.endVideoConversationThrows) throw new Error("end failed");
      },
      leaveMeetingBot: async (botId) => {
        calls.leaveMeetingBot.push(botId);
        if (overrides.leaveMeetingBotThrows) throw new Error("leave failed");
      },
    },
  };
}

const BASE_REQUEST = { agentId: "agent-1", meetingUrl: "https://zoom.us/j/123" };

test("happy path: entrada imediata cria a sala de vídeo, o bot já com câmera assumida, e grava a sessão", async () => {
  const { deps, calls } = fakeDeps();
  const result = await joinMeeting.handleJoinMeeting(BASE_REQUEST, deps);
  assert.deepEqual(result, { botId: "550e8400-e29b-41d4-a716-446655440000", conversationUrl: "https://tavus.daily.co/abc123", scheduled: false });
  assert.deepEqual(calls.resolveAgentPersona, ["agent-1"]);
  assert.deepEqual(calls.createVideoConversation, [PERSONA]);
  assert.equal(calls.createMeetingBot[0].outputMediaWebpageUrl, "https://tavus.daily.co/abc123");
  assert.equal(calls.createMeetingBot[0].joinAtIso, undefined);
  assert.deepEqual(calls.recordSession[0], { agentId: "agent-1", botId: "550e8400-e29b-41d4-a716-446655440000", meetingUrl: "https://zoom.us/j/123", conversationId: "abc123" });
});

test("entrada agendada NÃO cria sala Tavus agora (expiraria antes do horário) — só o bot sentinela", async () => {
  const { deps, calls } = fakeDeps();
  const result = await joinMeeting.handleJoinMeeting({ ...BASE_REQUEST, joinAtIso: "2026-08-01T18:00:00.000Z" }, deps);
  assert.equal(result.scheduled, true);
  assert.equal(result.conversationUrl, null);
  // Dinheiro: nenhuma sala paga criada na hora do agendamento.
  assert.equal(calls.createVideoConversation.length, 0);
  assert.equal(calls.createMeetingBot[0].joinAtIso, "2026-08-01T18:00:00.000Z");
  assert.equal(calls.createMeetingBot[0].outputMediaWebpageUrl, undefined);
  assert.equal(calls.recordSession[0].conversationId, null);
});

test("falha do bot depois da sala criada ENCERRA a sala paga (best-effort) antes de propagar", async () => {
  const { deps, calls } = fakeDeps({ createMeetingBotThrows: true });
  await assert.rejects(
    () => joinMeeting.handleJoinMeeting(BASE_REQUEST, deps),
    (e) => e.code === "provider_unavailable",
  );
  assert.deepEqual(calls.endVideoConversation, ["abc123"]);
});

test("se até o encerramento da sala falhar, a falha primária (bot) ainda é a que sobe", async () => {
  const { deps, calls } = fakeDeps({ createMeetingBotThrows: true, endVideoConversationThrows: true });
  await assert.rejects(
    () => joinMeeting.handleJoinMeeting(BASE_REQUEST, deps),
    (e) => e.code === "provider_unavailable",
  );
  assert.equal(calls.endVideoConversation.length, 1);
});

test("rejeita meetingUrl ausente, vazio ou não-https antes de chamar qualquer provider", async () => {
  const { deps, calls } = fakeDeps();
  for (const meetingUrl of [undefined, "", "http://zoom.us/j/1", "not-a-url"]) {
    await assert.rejects(
      () => joinMeeting.handleJoinMeeting({ ...BASE_REQUEST, meetingUrl }, deps),
      (e) => e instanceof joinMeeting.JoinMeetingError && e.code === "invalid_request",
    );
  }
  assert.equal(calls.resolveAgentPersona.length, 0);
});

test("agente sem persona de vídeo configurada falha antes de tocar qualquer provider", async () => {
  const { deps, calls } = fakeDeps({ persona: null });
  await assert.rejects(
    () => joinMeeting.handleJoinMeeting(BASE_REQUEST, deps),
    (e) => e.code === "agent_not_configured",
  );
  assert.equal(calls.createVideoConversation.length, 0);
  assert.equal(calls.createMeetingBot.length, 0);
});

test("falha ao criar a sala de vídeo nunca chega a criar o bot do Recall", async () => {
  const { deps, calls } = fakeDeps({ createVideoConversationThrows: true });
  await assert.rejects(
    () => joinMeeting.handleJoinMeeting(BASE_REQUEST, deps),
    (e) => e.code === "provider_unavailable",
  );
  assert.equal(calls.createMeetingBot.length, 0);
});

test("falha ao criar o bot do Recall propaga como provider_unavailable", async () => {
  const { deps } = fakeDeps({ createMeetingBotThrows: true });
  await assert.rejects(
    () => joinMeeting.handleJoinMeeting(BASE_REQUEST, deps),
    (e) => e.code === "provider_unavailable",
  );
});

test("falha ao gravar a sessão compensa bot e Tavus e nunca retorna sucesso sem receipt", async () => {
  const { deps, calls } = fakeDeps({ recordSessionThrows: true });
  await assert.rejects(() => joinMeeting.handleJoinMeeting(BASE_REQUEST, deps), (e) => e.code === "provider_unavailable");
  assert.deepEqual(calls.leaveMeetingBot, ["550e8400-e29b-41d4-a716-446655440000"]);
  assert.deepEqual(calls.endVideoConversation, ["abc123"]);
});

test("falha de compensação após persistência mantém resultado em reconciliação e falha fechado", async () => {
  const { deps } = fakeDeps({ recordSessionThrows: true, leaveMeetingBotThrows: true });
  await assert.rejects(
    () => joinMeeting.handleJoinMeeting(BASE_REQUEST, deps),
    (e) => e.code === "provider_unavailable" && /reconciliation/.test(e.message),
  );
});
