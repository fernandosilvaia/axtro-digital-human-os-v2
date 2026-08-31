import { createHash } from "node:crypto";

import type { MeetingTerminalNotificationCommand } from "@axtro/contracts-ts";
import { createUuidV7, isUuidV7 } from "@axtro/domain";

import {
  isMeetingTerminalNotificationProviderConfigured,
  sendMeetingTerminalNotificationProvider,
  type MeetingTerminalNotificationProviderResult,
} from "../meeting-terminal-notification-provider.ts";
import { constantTimeEquals } from "../security.ts";
import { createServiceRoleClient } from "../supabase/service.ts";
import { logEvent } from "../telemetry.ts";

const LEASE_SECONDS = 60;
// Four sequential 10-second provider calls fit inside the 60-second lease with
// a 20-second database and scheduling margin. Raising either side requires a
// cumulative-latency test and a matching operational review.
const BATCH_LIMIT = 4;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RFC3339_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const COMMAND_KEYS = Object.freeze([
  "agent_name",
  "attempt",
  "command_id",
  "data_classification",
  "dispatch_deadline_at",
  "html",
  "meeting_session_id",
  "payload_fingerprint",
  "payload_frozen",
  "provider",
  "provider_idempotency_key",
  "recipient_emails",
  "schema_version",
  "subject",
  "template_version",
  "tenant_id",
  "terminal_status",
  "workspace_name",
]);

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface NotificationRpcClient {
  rpc(name: string, parameters?: Readonly<Record<string, unknown>>): PromiseLike<RpcResult>;
}

interface BacklogSnapshot {
  readonly pending: number;
  readonly delivering: number;
  readonly retryWait: number;
  readonly ambiguous: number;
  readonly providerAccepted: number;
  readonly simulated: number;
  readonly deadLetter: number;
  readonly suppressed: number;
  readonly oldestDispatchableAgeSeconds: number;
}

export interface MeetingTerminalNotificationDispatchDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly createClient?: () => NotificationRpcClient;
  readonly createLeaseToken?: () => string;
  readonly sendProvider?: typeof sendMeetingTerminalNotificationProvider;
  readonly logEvent?: typeof logEvent;
}

export interface MeetingTerminalNotificationDispatchResult {
  readonly leased: number;
  readonly providerAccepted: number;
  readonly simulated: number;
  readonly retryScheduled: number;
  readonly ambiguous: number;
  readonly deadLettered: number;
  readonly suppressed: number;
  readonly backlog: number;
  readonly deadLetterBacklog: number;
  readonly ambiguousBacklog: number;
  readonly oldestDispatchableAgeSeconds: number;
}

export type MeetingTerminalNotificationDispatchAuthorization = "authorized" | "not_configured" | "unauthorized";

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : null;
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function validEmail(value: unknown): value is string {
  return typeof value === "string"
    && value === value.trim().toLowerCase()
    && codePointLength(value) >= 3
    && codePointLength(value) <= 320
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function parseMeetingTerminalNotificationCommand(value: unknown): MeetingTerminalNotificationCommand {
  const command = ownRecord(value);
  if (!command || !exactKeys(command, COMMAND_KEYS)) {
    throw new Error("meeting terminal notification command shape is invalid");
  }
  const recipients = command.recipient_emails;
  const recipientSet = Array.isArray(recipients) ? new Set(recipients) : null;
  const deadline = typeof command.dispatch_deadline_at === "string"
    && RFC3339_DATE_TIME_PATTERN.test(command.dispatch_deadline_at)
    ? Date.parse(command.dispatch_deadline_at)
    : Number.NaN;
  const commonValid = command.schema_version === "2.0.0"
    && typeof command.command_id === "string" && UUID_V7_PATTERN.test(command.command_id)
    && typeof command.tenant_id === "string" && UUID_V7_PATTERN.test(command.tenant_id)
    && typeof command.meeting_session_id === "string" && UUID_V7_PATTERN.test(command.meeting_session_id)
    && command.command_id === command.meeting_session_id
    && (command.terminal_status === "ended" || command.terminal_status === "failed")
    && command.template_version === 1
    && command.provider === "resend"
    && command.provider_idempotency_key === `meeting-terminal:v1:${command.meeting_session_id}`
    && codePointLength(command.provider_idempotency_key) <= 256
    && Number.isInteger(command.attempt) && Number(command.attempt) >= 1 && Number(command.attempt) <= 8
    && Number.isFinite(deadline)
    && Array.isArray(recipients) && recipients.length >= 1 && recipients.length <= 50
    && recipients.every(validEmail) && recipientSet?.size === recipients.length
    && typeof command.workspace_name === "string"
    && codePointLength(command.workspace_name) >= 1 && codePointLength(command.workspace_name) <= 160
    && typeof command.agent_name === "string"
    && codePointLength(command.agent_name) >= 1 && codePointLength(command.agent_name) <= 160
    && command.data_classification === "restricted";
  if (!commonValid) throw new Error("meeting terminal notification command values are invalid");
  if (command.payload_frozen === true) {
    if (
      typeof command.subject !== "string" || codePointLength(command.subject) < 1 || codePointLength(command.subject) > 200
      || typeof command.html !== "string" || codePointLength(command.html) < 1 || codePointLength(command.html) > 20_000
      || typeof command.payload_fingerprint !== "string" || !SHA256_PATTERN.test(command.payload_fingerprint)
    ) throw new Error("frozen meeting notification payload is invalid");
  } else if (
    command.payload_frozen !== false || command.subject !== null
    || command.html !== null || command.payload_fingerprint !== null
  ) {
    throw new Error("unfrozen meeting notification payload is invalid");
  }
  return command as unknown as MeetingTerminalNotificationCommand;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMeetingTerminalNotificationV1(command: MeetingTerminalNotificationCommand): {
  readonly subject: string;
  readonly html: string;
} {
  const workspace = escapeHtml(command.workspace_name);
  const agent = escapeHtml(command.agent_name);
  const statusLabel = command.terminal_status === "ended" ? "encerrou" : "não conseguiu concluir";
  const subject = `${command.agent_name} ${statusLabel} uma reunião externa: ${command.workspace_name}`;
  const html = [
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px">`,
    `<h2 style="font-size:18px;margin:0 0 12px">Reunião externa: ${workspace}</h2>`,
    `<p style="color:#444;line-height:1.5;margin:0 0 12px"><strong>${agent}</strong> ${statusLabel} a reunião externa agendada.</p>`,
    `<p style="color:#444;line-height:1.5;margin:0">Abra o Axtro Digital Human OS para consultar o registro operacional da sessão.</p>`,
    `</div>`,
  ].join("");
  if (codePointLength(subject) > 200 || codePointLength(html) > 20_000) {
    throw new Error("rendered notification payload exceeds its contract");
  }
  return { subject, html };
}

function tupleDigest(values: readonly string[]): string {
  const canonical = values.map((value) => `${Array.from(value).length}:${value};`).join("");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function meetingTerminalNotificationPayloadFingerprint(
  recipients: readonly string[],
  subject: string,
  html: string,
  idempotencyKey: string,
): string {
  return tupleDigest([recipients.join("\n"), subject, html, idempotencyKey]);
}

export function isMeetingTerminalNotificationDispatchEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED === "true";
}

export function meetingTerminalNotificationProviderReady(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return isMeetingTerminalNotificationProviderConfigured(env);
}

export function authorizeMeetingTerminalNotificationDispatch(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
): MeetingTerminalNotificationDispatchAuthorization {
  const expected = (expectedSecret ?? "").trim();
  if (expected.length < 24) return "not_configured";
  const match = /^(?:Bearer)\s+([^\s]+)$/i.exec(authorizationHeader ?? "");
  if (!match || !constantTimeEquals(match[1] ?? "", expected)) return "unauthorized";
  return "authorized";
}

function retryDelay(attempt: number): number {
  return Math.min(3600, Math.max(5, 5 * 2 ** Math.min(Math.max(attempt - 1, 0), 9)));
}

function poisonIdentity(value: unknown): { readonly tenantId: string; readonly notificationId: string } | null {
  const record = ownRecord(value);
  if (!record || !isUuidV7(record.tenant_id) || !isUuidV7(record.command_id)) return null;
  return { tenantId: record.tenant_id, notificationId: record.command_id };
}

function parseBacklog(value: unknown): BacklogSnapshot {
  const record = ownRecord(value);
  const keys = [
    "ambiguous", "deadLetter", "delivering", "oldestDispatchableAgeSeconds", "pending",
    "providerAccepted", "retryWait", "simulated", "suppressed",
  ];
  if (!record || !exactKeys(record, keys)) throw new Error("meeting notification backlog shape is invalid");
  for (const key of keys) {
    if (!Number.isSafeInteger(record[key]) || Number(record[key]) < 0) {
      throw new Error("meeting notification backlog values are invalid");
    }
  }
  return record as unknown as BacklogSnapshot;
}

async function settleFailure(
  client: NotificationRpcClient,
  command: Pick<MeetingTerminalNotificationCommand, "tenant_id" | "command_id">,
  leaseToken: string,
  failureCode: string,
  retrySeconds: number,
): Promise<"retry_wait" | "ambiguous" | "dead_letter"> {
  const { data, error } = await client.rpc("portal_fail_meeting_terminal_notification_service", {
    p_tenant_id: command.tenant_id,
    p_notification_id: command.command_id,
    p_lease_token: leaseToken,
    p_failure_code: failureCode,
    p_retry_seconds: retrySeconds,
  });
  const receipt = ownRecord(data);
  if (error || receipt?.settled !== true || !["retry_wait", "ambiguous", "dead_letter"].includes(String(receipt.status))) {
    throw new Error("meeting notification failure receipt was not applied");
  }
  return receipt.status as "retry_wait" | "ambiguous" | "dead_letter";
}

async function settleProviderResult(
  client: NotificationRpcClient,
  command: MeetingTerminalNotificationCommand,
  leaseToken: string,
  result: MeetingTerminalNotificationProviderResult,
): Promise<"provider_accepted" | "simulated" | "retry_wait" | "ambiguous" | "dead_letter" | "ack_lost"> {
  if (result.outcome === "provider_accepted" || result.outcome === "simulated") {
    const digest = createHash("sha256").update(result.providerReceiptRef, "utf8").digest("hex");
    const { data, error } = await client.rpc("portal_ack_meeting_terminal_notification_service", {
      p_tenant_id: command.tenant_id,
      p_notification_id: command.command_id,
      p_lease_token: leaseToken,
      p_provider_receipt_digest: digest,
      p_simulated: result.outcome === "simulated",
    });
    if (error || data !== true) return "ack_lost";
    return result.outcome;
  }
  if (result.outcome === "permanent_failure") {
    return settleFailure(client, command, leaseToken, result.failureCode, 0);
  }
  const retrySeconds = result.outcome === "retryable_failure" && result.retryAfterSeconds !== null
    ? result.retryAfterSeconds
    : retryDelay(command.attempt);
  return settleFailure(client, command, leaseToken, result.failureCode, retrySeconds);
}

/** Lease, freeze, dispatch and settle a bounded batch without exposing PII in telemetry. */
export async function dispatchMeetingTerminalNotifications(
  dependencies: MeetingTerminalNotificationDispatchDependencies = {},
): Promise<MeetingTerminalNotificationDispatchResult> {
  const env = dependencies.env ?? process.env;
  if (dependencies.sendProvider === undefined && !meetingTerminalNotificationProviderReady(env)) {
    throw new Error("meeting terminal notification provider is not configured");
  }
  const client = (dependencies.createClient ?? (() => createServiceRoleClient() as NotificationRpcClient))();
  const leaseToken = (dependencies.createLeaseToken ?? createUuidV7)();
  if (!isUuidV7(leaseToken)) throw new Error("meeting notification lease token must be a UUIDv7");
  const leased = await client.rpc("portal_lease_meeting_terminal_notifications_service", {
    p_lease_token: leaseToken,
    p_limit: BATCH_LIMIT,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (leased.error || !Array.isArray(leased.data) || leased.data.length > BATCH_LIMIT) {
    throw new Error("meeting notification lease failed");
  }

  let providerAccepted = 0;
  let simulated = 0;
  let retryScheduled = 0;
  let ambiguous = 0;
  let deadLettered = 0;
  for (const candidate of leased.data) {
    let command: MeetingTerminalNotificationCommand;
    try {
      command = parseMeetingTerminalNotificationCommand(candidate);
    } catch {
      const poison = poisonIdentity(candidate);
      if (poison === null) throw new Error("unsettleable meeting notification command");
      const status = await settleFailure(client, {
        tenant_id: poison.tenantId,
        command_id: poison.notificationId,
      }, leaseToken, "payload_invalid", 0);
      if (status !== "dead_letter") throw new Error("invalid meeting notification was not dead-lettered");
      deadLettered += 1;
      continue;
    }

    let subject: string;
    let html: string;
    let fingerprint: string;
    if (command.payload_frozen) {
      subject = command.subject;
      html = command.html;
      fingerprint = meetingTerminalNotificationPayloadFingerprint(
        command.recipient_emails,
        subject,
        html,
        command.provider_idempotency_key,
      );
      if (fingerprint !== command.payload_fingerprint) {
        const status = await settleFailure(client, command, leaseToken, "idempotency_conflict", 0);
        if (status !== "dead_letter") throw new Error("frozen payload conflict was not dead-lettered");
        deadLettered += 1;
        continue;
      }
    } else {
      ({ subject, html } = renderMeetingTerminalNotificationV1(command));
      fingerprint = meetingTerminalNotificationPayloadFingerprint(
        command.recipient_emails,
        subject,
        html,
        command.provider_idempotency_key,
      );
    }

    const begun = await client.rpc("portal_begin_meeting_terminal_notification_dispatch_service", {
      p_tenant_id: command.tenant_id,
      p_notification_id: command.command_id,
      p_lease_token: leaseToken,
      p_subject: subject,
      p_html: html,
      p_payload_fingerprint: fingerprint,
    });
    const beginReceipt = ownRecord(begun.data);
    if (
      begun.error
      || !beginReceipt
      || !exactKeys(beginReceipt, ["begun", "failureCode", "terminal"])
    ) throw new Error("meeting notification provider fence receipt is invalid");
    if (
      beginReceipt.begun === false
      && beginReceipt.terminal === true
      && beginReceipt.failureCode === "recipient_authority_changed"
    ) {
      deadLettered += 1;
      continue;
    }
    if (
      beginReceipt.begun !== true
      || beginReceipt.terminal !== false
      || beginReceipt.failureCode !== null
    ) throw new Error("meeting notification provider fence was not applied");

    const providerResult = await (dependencies.sendProvider ?? sendMeetingTerminalNotificationProvider)({
      to: command.recipient_emails,
      subject,
      html,
      idempotencyKey: command.provider_idempotency_key,
    }, { env });
    const settled = await settleProviderResult(client, command, leaseToken, providerResult);
    if (settled === "provider_accepted") providerAccepted += 1;
    else if (settled === "simulated") simulated += 1;
    else if (settled === "retry_wait") retryScheduled += 1;
    else if (settled === "dead_letter") deadLettered += 1;
    else ambiguous += 1;
  }

  const cleanup = await client.rpc("portal_cleanup_meeting_terminal_notifications_service", { p_limit: 500 });
  if (cleanup.error || ownRecord(cleanup.data)?.deletedPayloads === undefined) {
    throw new Error("meeting notification payload cleanup failed");
  }
  const backlogResult = await client.rpc("portal_meeting_terminal_notification_backlog_service");
  if (backlogResult.error) throw new Error("meeting notification backlog failed");
  const backlog = parseBacklog(backlogResult.data);
  const result = Object.freeze({
    leased: leased.data.length,
    providerAccepted,
    simulated,
    retryScheduled,
    ambiguous,
    deadLettered,
    suppressed: backlog.suppressed,
    backlog: backlog.pending + backlog.delivering + backlog.retryWait + backlog.ambiguous,
    deadLetterBacklog: backlog.deadLetter,
    ambiguousBacklog: backlog.ambiguous,
    oldestDispatchableAgeSeconds: backlog.oldestDispatchableAgeSeconds,
  });
  (dependencies.logEvent ?? logEvent)("meeting_terminal_notification_batch_completed", result);
  return result;
}
