import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const {
  createInitialPublicDemoState,
  issuePublicDemoStateToken,
  PUBLIC_DEMO_MAX_COMMANDS,
  verifyPublicDemoStateToken,
} = await import("../../apps/portal/src/lib/public-demo/state-token.ts");
const {
  executePublicDemoCommand,
  PUBLIC_DEMO_COMMANDS,
  reducePublicDemoCommand,
} = await import("../../apps/portal/src/lib/public-demo/runtime.ts");

const SECRET = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const NOW = new Date("2026-08-31T16:00:00.000Z");
const SESSION = "019f0000-0000-7000-8000-000000000001";

function id(index) {
  return `019f0000-0000-7000-8000-${String(index).padStart(12, "0")}`;
}

function command(index, expectedRevision, name) {
  return Object.freeze({
    schema_version: "2.0.0",
    command_id: id(index),
    expected_revision: expectedRevision,
    command: name,
  });
}

function initialToken() {
  return issuePublicDemoStateToken(createInitialPublicDemoState(SESSION, NOW), SECRET, NOW);
}

test("closed command allowlist applies deterministic synthetic transitions", () => {
  assert.deepEqual(PUBLIC_DEMO_COMMANDS, [
    "open_overview",
    "inspect_agent",
    "inspect_knowledge",
    "inspect_conversation",
    "advance",
    "reset",
  ]);
  const initial = createInitialPublicDemoState(SESSION, NOW);
  const cases = [
    ["open_overview", "overview", "welcome"],
    ["inspect_agent", "agent", "context"],
    ["inspect_knowledge", "knowledge", "context"],
    ["inspect_conversation", "conversation", "conversation"],
    ["advance", "overview", "context"],
    ["reset", "overview", "welcome"],
  ];
  for (const [name, surface, step] of cases) {
    const reduced = reducePublicDemoCommand(initial, command(10, 0, name));
    assert.equal(reduced.outcome, "applied");
    assert.equal(reduced.reasonCode, null);
    assert.equal(reduced.state.surface, surface);
    assert.equal(reduced.state.step, step);
    assert.equal(reduced.state.revision, 1);
    assert.deepEqual(reduced.state.seen_commands, [{
      command_id: id(10),
      expected_revision: 0,
      command: name,
    }]);
    assert.equal(reduced.state.expires_at, initial.expires_at);
  }
});

test("execution returns contract snapshot and keeps the signed token server-only", () => {
  const output = executePublicDemoCommand({
    stateToken: initialToken(),
    stateSecret: SECRET,
    command: command(10, 0, "inspect_agent"),
    now: NOW,
  });
  assert.deepEqual(output.result, {
    schema_version: "2.0.0",
    outcome: "applied",
    revision: 1,
    surface: "agent",
    step: "context",
    commands_remaining: 11,
    reason_code: null,
  });
  assert.equal(typeof output.nextStateToken, "string");
  assert.equal(Object.hasOwn(output.result, "state_token"), false);
  assert.equal(Object.hasOwn(output.result, "nextStateToken"), false);
  assert.doesNotMatch(JSON.stringify(output.result), /tenant|user|actor|provider|receipt|token/i);

  const state = verifyPublicDemoStateToken(output.nextStateToken, SECRET, NOW);
  assert.equal(state.demo_session_id, SESSION);
  assert.equal(state.surface, "agent");
  assert.equal(state.revision, 1);
});

test("duplicate replay is idempotent and does not consume revision or command budget", () => {
  const first = executePublicDemoCommand({
    stateToken: initialToken(),
    stateSecret: SECRET,
    command: command(10, 0, "inspect_agent"),
    now: NOW,
  });
  const replay = executePublicDemoCommand({
    stateToken: first.nextStateToken,
    stateSecret: SECRET,
    command: command(10, 0, "inspect_agent"),
    now: NOW,
  });

  assert.deepEqual(replay.result, {
    schema_version: "2.0.0",
    outcome: "replayed",
    revision: 1,
    surface: "agent",
    step: "context",
    commands_remaining: 11,
    reason_code: "duplicate_command",
  });
  assert.equal(replay.nextStateToken, first.nextStateToken);
  assert.equal(verifyPublicDemoStateToken(replay.nextStateToken, SECRET, NOW).seen_commands.length, 1);
});

test("historical replay is idempotent and divergent command identity fails closed", () => {
  const first = executePublicDemoCommand({
    stateToken: initialToken(),
    stateSecret: SECRET,
    command: command(10, 0, "inspect_agent"),
    now: NOW,
  });
  const second = executePublicDemoCommand({
    stateToken: first.nextStateToken,
    stateSecret: SECRET,
    command: command(11, 1, "inspect_knowledge"),
    now: NOW,
  });
  const replay = executePublicDemoCommand({
    stateToken: second.nextStateToken,
    stateSecret: SECRET,
    command: command(10, 0, "inspect_agent"),
    now: NOW,
  });
  assert.equal(replay.result.outcome, "replayed");
  assert.equal(replay.result.revision, 2);
  assert.equal(replay.result.surface, "knowledge");
  assert.equal(replay.nextStateToken, second.nextStateToken);

  for (const divergent of [
    command(10, 2, "inspect_agent"),
    command(10, 0, "inspect_conversation"),
  ]) {
    const denied = executePublicDemoCommand({
      stateToken: second.nextStateToken,
      stateSecret: SECRET,
      command: divergent,
      now: NOW,
    });
    assert.equal(denied.result.outcome, "unavailable");
    assert.equal(denied.nextStateToken, null);
  }
});

test("stale revisions return the current safe snapshot without mutation", () => {
  const first = executePublicDemoCommand({
    stateToken: initialToken(),
    stateSecret: SECRET,
    command: command(10, 0, "inspect_agent"),
    now: NOW,
  });
  const stale = executePublicDemoCommand({
    stateToken: first.nextStateToken,
    stateSecret: SECRET,
    command: command(11, 0, "inspect_knowledge"),
    now: NOW,
  });
  assert.equal(stale.result.outcome, "stale");
  assert.equal(stale.result.reason_code, "revision_mismatch");
  assert.equal(stale.result.revision, 1);
  assert.equal(stale.result.surface, "agent");
  assert.equal(stale.nextStateToken, first.nextStateToken);
});

test("expired, tampered, missing-secret and malformed states fail closed and dispose the cookie", () => {
  const token = initialToken();
  const expired = executePublicDemoCommand({
    stateToken: token,
    stateSecret: SECRET,
    command: command(10, 0, "open_overview"),
    now: new Date(NOW.getTime() + 15 * 60 * 1000),
  });
  assert.deepEqual(expired, {
    result: {
      schema_version: "2.0.0",
      outcome: "expired",
      revision: null,
      surface: null,
      step: null,
      commands_remaining: null,
      reason_code: "state_expired",
    },
    nextStateToken: null,
  });

  for (const input of [
    { stateToken: `${token}x`, stateSecret: SECRET },
    { stateToken: token, stateSecret: "short" },
    { stateToken: null, stateSecret: SECRET },
  ]) {
    const unavailable = executePublicDemoCommand({
      ...input,
      command: command(10, 0, "open_overview"),
      now: NOW,
    });
    assert.equal(unavailable.result.outcome, "unavailable");
    assert.equal(unavailable.result.reason_code, "demo_unavailable");
    assert.equal(unavailable.result.revision, null);
    assert.equal(unavailable.nextStateToken, null);
  }
});

test("free text, extra fields, accessors, symbols and non-UUIDv7 commands are unavailable", () => {
  const getterCommand = {};
  Object.defineProperty(getterCommand, "schema_version", {
    enumerable: true,
    get: () => "2.0.0",
  });
  const symbolCommand = { ...command(10, 0, "advance"), [Symbol("hidden")]: true };
  const invalidCommands = [
    { ...command(10, 0, "advance"), prompt: "call a provider" },
    { ...command(10, 0, "advance"), command: "send_email" },
    { ...command(10, 0, "advance"), command_id: "550e8400-e29b-41d4-a716-446655440000" },
    { ...command(10, 0, "advance"), expected_revision: -1 },
    { ...command(10, 0, "advance"), expected_revision: 13 },
    { ...command(10, 0, "advance"), schema_version: "1.0.0" },
    getterCommand,
    symbolCommand,
    null,
    "advance",
  ];
  for (const invalid of invalidCommands) {
    const output = executePublicDemoCommand({
      stateToken: initialToken(),
      stateSecret: SECRET,
      command: invalid,
      now: NOW,
    });
    assert.equal(output.result.outcome, "unavailable");
    assert.equal(output.result.reason_code, "demo_unavailable");
    assert.equal(output.nextStateToken, null);
  }
});

test("revision and command budgets are hard-capped at twelve", () => {
  let token = initialToken();
  for (let revision = 0; revision < PUBLIC_DEMO_MAX_COMMANDS; revision += 1) {
    const output = executePublicDemoCommand({
      stateToken: token,
      stateSecret: SECRET,
      command: command(100 + revision, revision, revision % 2 === 0 ? "inspect_agent" : "reset"),
      now: NOW,
    });
    assert.equal(output.result.outcome, "applied");
    assert.equal(output.result.commands_remaining, PUBLIC_DEMO_MAX_COMMANDS - revision - 1);
    token = output.nextStateToken;
  }
  const cappedState = verifyPublicDemoStateToken(token, SECRET, NOW);
  assert.equal(cappedState.revision, 12);
  assert.equal(cappedState.seen_commands.length, 12);

  const denied = executePublicDemoCommand({
    stateToken: token,
    stateSecret: SECRET,
    command: command(999, 12, "reset"),
    now: NOW,
  });
  assert.equal(denied.result.outcome, "unavailable");
  assert.equal(denied.result.reason_code, "demo_unavailable");
  assert.equal(denied.nextStateToken, null);
});

test("advance stops at the closed handoff boundary", () => {
  let token = initialToken();
  for (let revision = 0; revision < 3; revision += 1) {
    const output = executePublicDemoCommand({
      stateToken: token,
      stateSecret: SECRET,
      command: command(20 + revision, revision, "advance"),
      now: NOW,
    });
    assert.equal(output.result.outcome, "applied");
    token = output.nextStateToken;
  }
  assert.equal(verifyPublicDemoStateToken(token, SECRET, NOW).step, "handoff");
  const blocked = executePublicDemoCommand({
    stateToken: token,
    stateSecret: SECRET,
    command: command(23, 3, "advance"),
    now: NOW,
  });
  assert.equal(blocked.result.outcome, "unavailable");
  assert.equal(blocked.nextStateToken, null);
});

test("runtime source has no authority, persistence, network or paid-effect dependency", async () => {
  const files = ["capacity.ts", "edge-policy.ts", "fixture.ts", "state-token.ts", "runtime.ts", "index.ts"];
  const sources = await Promise.all(files.map((file) => readFile(
    new URL(`../../apps/portal/src/lib/public-demo/${file}`, import.meta.url),
    "utf8",
  )));
  const imports = new Set(sources
    .flatMap((source) => [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1])));
  assert.deepEqual(
    [...imports].sort(),
    [
      "../rate-limit.ts",
      "./capacity.ts",
      "./edge-policy.ts",
      "./fixture.ts",
      "./runtime.ts",
      "./state-token.ts",
      "@axtro/contracts-ts",
      "node:crypto",
    ].sort(),
  );
  assert.doesNotMatch(
    sources.join("\n"),
    /@supabase|portal-data|paid-effects|providers?\/|createClient|fetch\(|process\.env/i,
  );
});
