import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

const sessionSource = await readFile(
  new URL("../../apps/portal/src/lib/public-demo/server-session.ts", import.meta.url),
  "utf8",
);
const realPublicDemo = await import("../../apps/portal/src/lib/public-demo/index.ts");

const SECRET = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const EDGE_POLICY_ATTESTATION = realPublicDemo.PUBLIC_DEMO_EDGE_POLICY_ATTESTATION;
const SESSION_ID = "019f0000-0000-7000-8000-000000000001";
const COMMAND_ID = "019f0000-0000-7000-8000-000000000002";
const INITIAL_STATE = Object.freeze({
  schema_version: "2.0.0",
  fixture_version: "1.0.0",
  demo_session_id: SESSION_ID,
  revision: 0,
  seen_commands: Object.freeze([]),
  surface: "overview",
  step: "welcome",
  issued_at: "2026-08-31T16:00:00.000Z",
  expires_at: "2026-08-31T16:15:00.000Z",
});

function command() {
  return {
    schema_version: "2.0.0",
    command_id: COMMAND_ID,
    expected_revision: 0,
    command: "inspect_agent",
  };
}

function loadSession(options = {}) {
  const values = new Map(Object.entries(options.cookies ?? {}));
  const calls = {
    capacity: [],
    createState: [],
    execute: [],
    issue: [],
    sets: [],
    verify: [],
    releases: 0,
  };
  const cookieStore = {
    get(name) {
      const value = values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set(name, value, attributes) {
      calls.sets.push({ name, value, attributes });
      if (attributes.maxAge === 0 || attributes.expires?.getTime() === 0) values.delete(name);
      else values.set(name, value);
    },
  };
  const output = options.output ?? {
    result: {
      schema_version: "2.0.0",
      outcome: "applied",
      revision: 1,
      surface: "agent",
      step: "context",
      commands_remaining: 11,
      reason_code: null,
    },
    nextStateToken: "pdsv1.next.signature",
  };
  const nextState = Object.freeze({
    ...INITIAL_STATE,
    revision: 1,
    seen_commands: Object.freeze([Object.freeze({
      command_id: COMMAND_ID,
      expected_revision: 0,
      command: "inspect_agent",
    })]),
    surface: "agent",
    step: "context",
  });

  const mocks = new Map([
    ["@axtro/domain", {
      createUuidV7() {
        return SESSION_ID;
      },
    }],
    ["next/headers", {
      async cookies() {
        return cookieStore;
      },
    }],
    ["./index.ts", {
      PUBLIC_DEMO_EDGE_POLICY_ATTESTATION_ENV: "PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION",
      PUBLIC_DEMO_MAX_COMMANDS: 12,
      PUBLIC_DEMO_STATE_SECRET_ENV: "PORTAL_PUBLIC_DEMO_STATE_SECRET",
      acquirePublicDemoCapacity(operation) {
        calls.capacity.push(operation);
        if (options.capacityDenied === operation) return null;
        return {
          release() {
            calls.releases += 1;
          },
        };
      },
      createInitialPublicDemoState(...args) {
        const [sessionId] = args;
        calls.createState.push(sessionId);
        return options.realRuntime
          ? realPublicDemo.createInitialPublicDemoState(...args)
          : INITIAL_STATE;
      },
      executePublicDemoCommand(input) {
        calls.execute.push(input);
        return options.realRuntime ? realPublicDemo.executePublicDemoCommand(input) : output;
      },
      isPublicDemoEdgePolicyAttested(value) {
        return value === EDGE_POLICY_ATTESTATION;
      },
      isPublicDemoStateSecretConfigured(value) {
        return options.realRuntime
          ? realPublicDemo.isPublicDemoStateSecretConfigured(value)
          : typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
      },
      issuePublicDemoStateToken(...args) {
        const [state, secret] = args;
        calls.issue.push({ state, secret });
        return options.realRuntime
          ? realPublicDemo.issuePublicDemoStateToken(...args)
          : "pdsv1.initial.signature";
      },
      verifyPublicDemoStateToken(...args) {
        const [token, secret] = args;
        calls.verify.push({ token, secret });
        if (options.verifyFailure) throw new Error("invalid");
        if (options.realRuntime) return realPublicDemo.verifyPublicDemoStateToken(...args);
        return token === "pdsv1.next.signature" ? nextState : INITIAL_STATE;
      },
    }],
  ]);

  const compiled = ts.transpileModule(sessionSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "server-session.ts",
  }).outputText;
  const module = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected public demo session import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, {
    filename: "public-demo-session.runtime.cjs",
  });
  wrapper.runInNewContext({ Date, Error, Object, Promise, RegExp, process })(
    requireMock,
    module,
    module.exports,
  );
  return { session: module.exports, calls, values };
}

async function withEnvironment(values, run) {
  const keys = Object.keys(values);
  const before = new Map(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function enabledEnvironment(values = {}) {
  return {
    PORTAL_PUBLIC_DEMO_STATE_SECRET: SECRET,
    PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION: EDGE_POLICY_ATTESTATION,
    ...values,
  };
}

test("start creates only a dedicated short HttpOnly cookie", async () => {
  await withEnvironment(enabledEnvironment({ NODE_ENV: "production" }), async () => {
    const { session, calls, values } = loadSession({ cookies: { "sb-customer-auth": "untouched" } });
    assert.equal(await session.startPublicDemoSession(), true);
    assert.deepEqual(calls.createState, [SESSION_ID]);
    assert.equal(calls.issue.length, 1);
    assert.deepEqual(calls.capacity, ["start"]);
    assert.equal(calls.releases, 1);
    assert.equal(calls.sets.length, 1);
    assert.deepEqual({ ...calls.sets[0].attributes }, {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/demo",
      expires: new Date(INITIAL_STATE.expires_at),
      priority: "high",
    });
    assert.equal(calls.sets[0].name, "axtro_public_demo");
    assert.equal(values.get("sb-customer-auth"), "untouched");
  });
});

test("capacity denial fails closed before session work and preserves customer auth", async () => {
  await withEnvironment(enabledEnvironment(), async () => {
    const start = loadSession({
      capacityDenied: "start",
      cookies: { axtro_public_demo: "old", "sb-customer-auth": "untouched" },
    });
    assert.equal(await start.session.startPublicDemoSession(), false);
    assert.equal(start.calls.createState.length, 0);
    assert.equal(start.values.has("axtro_public_demo"), false);
    assert.equal(start.values.get("sb-customer-auth"), "untouched");

    const commandAttempt = loadSession({
      capacityDenied: "command",
      cookies: { axtro_public_demo: "old", "sb-customer-auth": "untouched" },
    });
    const commandResult = await commandAttempt.session.runPublicDemoCommand(command());
    assert.equal(commandResult.outcome, "unavailable");
    assert.equal(commandAttempt.calls.execute.length, 0);
    assert.equal(commandAttempt.values.get("axtro_public_demo"), "old");
    assert.equal(commandAttempt.values.get("sb-customer-auth"), "untouched");

    const read = loadSession({ capacityDenied: "read" });
    assert.equal(await read.session.readPublicDemoView(), null);
    assert.equal(read.calls.verify.length, 0);
  });
});

test("missing secret fails before issuing state and clears only the demo cookie", async () => {
  await withEnvironment({ PORTAL_PUBLIC_DEMO_STATE_SECRET: "", NODE_ENV: "production" }, async () => {
    const { session, calls, values } = loadSession({
      cookies: { axtro_public_demo: "old", "sb-customer-auth": "untouched" },
    });
    assert.equal(await session.startPublicDemoSession(), false);
    assert.equal(calls.createState.length, 0);
    assert.equal(calls.issue.length, 0);
    assert.equal(values.has("axtro_public_demo"), false);
    assert.equal(values.get("sb-customer-auth"), "untouched");
  });
});

test("edge policy attestation is required before the public demo can start", async () => {
  for (const attestation of [undefined, "", "axtro-public-demo-edge/v0"]) {
    await withEnvironment({
      PORTAL_PUBLIC_DEMO_STATE_SECRET: SECRET,
      PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION: attestation,
    }, async () => {
      const { session, calls, values } = loadSession({
        cookies: { axtro_public_demo: "old", "sb-customer-auth": "untouched" },
      });
      assert.equal(await session.startPublicDemoSession(), false);
      assert.equal(calls.createState.length, 0);
      assert.equal(calls.issue.length, 0);
      assert.equal(values.has("axtro_public_demo"), false);
      assert.equal(values.get("sb-customer-auth"), "untouched");
    });
  }
});

test("command keeps the signed token server-only and rotates the scoped cookie", async () => {
  await withEnvironment(enabledEnvironment({ NODE_ENV: "production" }), async () => {
    const { session, calls } = loadSession({ cookies: { axtro_public_demo: "pdsv1.initial.signature" } });
    const result = await session.runPublicDemoCommand(command());
    assert.equal(calls.execute.length, 1);
    assert.equal(calls.execute[0].stateToken, "pdsv1.initial.signature");
    assert.deepEqual(calls.execute[0].command, command());
    assert.equal(calls.sets.at(-1).value, "pdsv1.next.signature");
    assert.equal(calls.sets.at(-1).attributes.path, "/demo");
    assert.equal(Object.hasOwn(result, "nextStateToken"), false);
    assert.equal(Object.hasOwn(result, "state_token"), false);
    assert.doesNotMatch(JSON.stringify(result), /pdsv1|tenant|user|actor|provider|receipt/i);
  });
});

test("expired or unavailable execution deletes the demo cookie without touching customer auth", async () => {
  const output = {
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
  };
  await withEnvironment(enabledEnvironment(), async () => {
    const { session, values } = loadSession({
      output,
      cookies: { axtro_public_demo: "expired", "sb-customer-auth": "untouched" },
    });
    const result = await session.runPublicDemoCommand(command());
    assert.equal(result.outcome, "expired");
    assert.equal(values.has("axtro_public_demo"), false);
    assert.equal(values.get("sb-customer-auth"), "untouched");
  });
});

test("read returns a content-free snapshot and exit deletes only the demo cookie", async () => {
  await withEnvironment(enabledEnvironment(), async () => {
    const { session, calls, values } = loadSession({
      cookies: { axtro_public_demo: "pdsv1.initial.signature", "sb-customer-auth": "untouched" },
    });
    assert.deepEqual(JSON.parse(JSON.stringify(await session.readPublicDemoView())), {
      revision: 0,
      surface: "overview",
      step: "welcome",
      commandsRemaining: 12,
    });
    await session.endPublicDemoSession();
    assert.deepEqual(calls.capacity, ["read", "command"]);
    assert.equal(values.has("axtro_public_demo"), false);
    assert.equal(values.get("sb-customer-auth"), "untouched");
  });
});

test("real codec composition clears malformed and expired demo cookies only", async () => {
  const issuedAt = new Date(Date.now() - 16 * 60 * 1_000);
  const expiredState = realPublicDemo.createInitialPublicDemoState(SESSION_ID, issuedAt);
  const expiredToken = realPublicDemo.issuePublicDemoStateToken(expiredState, SECRET, issuedAt);

  for (const [stateToken, expectedOutcome] of [
    [`${expiredToken}x`, "unavailable"],
    [expiredToken, "expired"],
  ]) {
    await withEnvironment(enabledEnvironment(), async () => {
      const { session, values } = loadSession({
        realRuntime: true,
        cookies: { axtro_public_demo: stateToken, "sb-customer-auth": "untouched" },
      });
      const result = await session.runPublicDemoCommand(command());
      assert.equal(result.outcome, expectedOutcome);
      assert.equal(values.has("axtro_public_demo"), false);
      assert.equal(values.get("sb-customer-auth"), "untouched");
    });
  }
});
