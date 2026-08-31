import type {
  PortalPublicDemoActionResult,
  PortalPublicDemoCommand,
} from "@axtro/contracts-ts";

import {
  PUBLIC_DEMO_COMMANDS,
  type PublicDemoCommandName,
} from "./fixture.ts";

import {
  PUBLIC_DEMO_MAX_COMMANDS,
  PUBLIC_DEMO_MAX_REVISION,
  PublicDemoStateTokenError,
  type PublicDemoSignedStatePayload,
  issuePublicDemoStateToken,
  verifyPublicDemoStateToken,
} from "./state-token.ts";

export { PUBLIC_DEMO_COMMANDS, type PublicDemoCommandName } from "./fixture.ts";

export type PublicDemoCommand = Readonly<PortalPublicDemoCommand>;
export type PublicDemoActionResult = Readonly<PortalPublicDemoActionResult>;
export type PublicDemoReasonCode = NonNullable<PublicDemoActionResult["reason_code"]>;

export interface ExecutePublicDemoCommandInput {
  readonly stateToken: unknown;
  readonly command: unknown;
  readonly stateSecret: string;
  readonly now?: Date;
}

export interface ExecutePublicDemoCommandOutput {
  readonly result: PublicDemoActionResult;
  /** Server-only value for an HttpOnly cookie. Never include it in the action result. */
  readonly nextStateToken: string | null;
}

const COMMAND_KEYS = Object.freeze([
  "schema_version",
  "command_id",
  "expected_revision",
  "command",
] as const);
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function ownDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[String(key)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function parseCommand(value: unknown): PublicDemoCommand | null {
  const command = ownDataRecord(value);
  if (!command) return null;
  const keys = Object.keys(command);
  if (keys.length !== COMMAND_KEYS.length
    || !COMMAND_KEYS.every((key) => Object.hasOwn(command, key))
    || command.schema_version !== "2.0.0"
    || typeof command.command_id !== "string"
    || !UUID_V7_PATTERN.test(command.command_id)
    || !Number.isInteger(command.expected_revision)
    || Number(command.expected_revision) < 0
    || Number(command.expected_revision) > PUBLIC_DEMO_MAX_REVISION
    || typeof command.command !== "string"
    || !(PUBLIC_DEMO_COMMANDS as readonly string[]).includes(command.command)) return null;
  return Object.freeze({
    schema_version: "2.0.0",
    command_id: command.command_id,
    expected_revision: Number(command.expected_revision),
    command: command.command as PublicDemoCommandName,
  });
}

function result(
  outcome: PublicDemoActionResult["outcome"],
  reasonCode: PublicDemoActionResult["reason_code"],
  state: PublicDemoSignedStatePayload | null,
): PublicDemoActionResult {
  if (outcome === "applied" && state !== null && reasonCode === null) {
    return Object.freeze({
      schema_version: "2.0.0",
      outcome,
      revision: state.revision,
      surface: state.surface,
      step: state.step,
      commands_remaining: PUBLIC_DEMO_MAX_COMMANDS - state.revision,
      reason_code: null,
    });
  }
  if (outcome === "replayed" && state !== null && reasonCode === "duplicate_command") {
    return Object.freeze({
      schema_version: "2.0.0",
      outcome,
      revision: state.revision,
      surface: state.surface,
      step: state.step,
      commands_remaining: PUBLIC_DEMO_MAX_COMMANDS - state.revision,
      reason_code: reasonCode,
    });
  }
  if (outcome === "stale" && state !== null && reasonCode === "revision_mismatch") {
    return Object.freeze({
      schema_version: "2.0.0",
      outcome,
      revision: state.revision,
      surface: state.surface,
      step: state.step,
      commands_remaining: PUBLIC_DEMO_MAX_COMMANDS - state.revision,
      reason_code: reasonCode,
    });
  }
  if (outcome === "expired" && reasonCode === "state_expired") {
    return Object.freeze({
      schema_version: "2.0.0",
      outcome,
      revision: null,
      surface: null,
      step: null,
      commands_remaining: null,
      reason_code: reasonCode,
    });
  }
  return Object.freeze({
    schema_version: "2.0.0",
    outcome: "unavailable",
    revision: null,
    surface: null,
    step: null,
    commands_remaining: null,
    reason_code: "demo_unavailable",
  });
}

function nextLocation(
  state: PublicDemoSignedStatePayload,
  command: PublicDemoCommandName,
): Pick<PublicDemoSignedStatePayload, "surface" | "step"> | null {
  switch (command) {
    case "open_overview":
    case "reset":
      return { surface: "overview", step: "welcome" };
    case "inspect_agent":
      return { surface: "agent", step: "context" };
    case "inspect_knowledge":
      return { surface: "knowledge", step: "context" };
    case "inspect_conversation":
      return { surface: "conversation", step: "conversation" };
    case "advance": {
      const nextStep = {
        welcome: "context",
        context: "conversation",
        conversation: "handoff",
        handoff: null,
      } as const;
      const step = nextStep[state.step];
      return step === null ? null : { surface: state.surface, step };
    }
  }
}

export function reducePublicDemoCommand(
  state: PublicDemoSignedStatePayload,
  commandValue: unknown,
): Readonly<{
  outcome: "applied" | "replayed" | "stale" | "unavailable";
  reasonCode: PublicDemoActionResult["reason_code"];
  state: PublicDemoSignedStatePayload;
}> {
  const command = parseCommand(commandValue);
  if (command === null) {
    return Object.freeze({ outcome: "unavailable", reasonCode: "demo_unavailable", state });
  }
  const previous = state.seen_commands.find((candidate) => candidate.command_id === command.command_id);
  if (previous !== undefined) {
    const exactReplay = previous.expected_revision === command.expected_revision
      && previous.command === command.command;
    return exactReplay
      ? Object.freeze({ outcome: "replayed", reasonCode: "duplicate_command", state })
      : Object.freeze({ outcome: "unavailable", reasonCode: "demo_unavailable", state });
  }
  if (command.expected_revision !== state.revision) {
    return Object.freeze({ outcome: "stale", reasonCode: "revision_mismatch", state });
  }
  if (state.revision >= PUBLIC_DEMO_MAX_REVISION) {
    return Object.freeze({ outcome: "unavailable", reasonCode: "demo_unavailable", state });
  }
  const location = nextLocation(state, command.command);
  if (location === null) {
    return Object.freeze({ outcome: "unavailable", reasonCode: "demo_unavailable", state });
  }
  return Object.freeze({
    outcome: "applied",
    reasonCode: null,
    state: Object.freeze({
      ...state,
      revision: state.revision + 1,
      seen_commands: Object.freeze([
        ...state.seen_commands,
        Object.freeze({
          command_id: command.command_id,
          expected_revision: command.expected_revision,
          command: command.command,
        }),
      ]),
      surface: location.surface,
      step: location.step,
    }),
  });
}

export function executePublicDemoCommand(
  input: ExecutePublicDemoCommandInput,
): ExecutePublicDemoCommandOutput {
  const now = input.now ?? new Date();
  let state: PublicDemoSignedStatePayload;
  try {
    state = verifyPublicDemoStateToken(input.stateToken, input.stateSecret, now);
  } catch (error) {
    const expired = error instanceof PublicDemoStateTokenError && error.code === "state_token_expired";
    return Object.freeze({
      result: result(
        expired ? "expired" : "unavailable",
        expired ? "state_expired" : "demo_unavailable",
        null,
      ),
      nextStateToken: null,
    });
  }
  const reduced = reducePublicDemoCommand(state, input.command);
  if (reduced.outcome !== "applied") {
    return Object.freeze({
      result: result(reduced.outcome, reduced.reasonCode, reduced.state),
      nextStateToken: reduced.outcome === "unavailable" ? null : input.stateToken as string,
    });
  }
  try {
    return Object.freeze({
      result: result("applied", null, reduced.state),
      nextStateToken: issuePublicDemoStateToken(reduced.state, input.stateSecret, now),
    });
  } catch {
    return Object.freeze({
      result: result("unavailable", "demo_unavailable", null),
      nextStateToken: null,
    });
  }
}
