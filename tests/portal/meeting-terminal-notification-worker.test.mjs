import assert from "node:assert/strict";
import test from "node:test";

const worker = await import(
  "../../apps/portal/src/lib/workers/meeting-terminal-notifications.ts"
);

const LEASE_TOKEN = "018f1e2d-3c4b-7a03-8c9d-001122334457";
const COMMAND = Object.freeze({
  schema_version: "2.0.0",
  command_id: "018f1e2d-3c4b-7a01-8c9d-001122334455",
  tenant_id: "018f1e2d-3c4b-7a02-8c9d-001122334456",
  meeting_session_id: "018f1e2d-3c4b-7a01-8c9d-001122334455",
  terminal_status: "ended",
  template_version: 1,
  provider: "resend",
  provider_idempotency_key: "meeting-terminal:v1:018f1e2d-3c4b-7a01-8c9d-001122334455",
  attempt: 1,
  dispatch_deadline_at: "2099-08-31T23:00:00.000Z",
  recipient_emails: ["recipient-canary@example.test"],
  workspace_name: "Workspace Canary",
  agent_name: "Raissa",
  payload_frozen: false,
  subject: null,
  html: null,
  payload_fingerprint: null,
  data_classification: "restricted",
});

const EMPTY_BACKLOG = Object.freeze({
  pending: 0,
  delivering: 0,
  retryWait: 0,
  ambiguous: 0,
  providerAccepted: 1,
  simulated: 0,
  deadLetter: 0,
  suppressed: 0,
  oldestDispatchableAgeSeconds: 0,
});

function createClient(options = {}) {
  const calls = [];
  const client = {
    calls,
    async rpc(name, parameters = {}) {
      calls.push({ name, parameters });
      if (name === "portal_lease_meeting_terminal_notifications_service") {
        return { data: options.commands ?? [COMMAND], error: null };
      }
      if (name === "portal_begin_meeting_terminal_notification_dispatch_service") {
        return {
          data: options.beginReceipt ?? { begun: true, terminal: false, failureCode: null },
          error: options.beginError ?? null,
        };
      }
      if (name === "portal_ack_meeting_terminal_notification_service") {
        return { data: options.ackReceipt ?? true, error: options.ackError ?? null };
      }
      if (name === "portal_fail_meeting_terminal_notification_service") {
        const permanent = ["payload_invalid", "recipient_invalid", "provider_rejected", "idempotency_conflict"]
          .includes(parameters.p_failure_code);
        const status = permanent ? "dead_letter"
          : ["provider_timeout", "transport_unknown", "provider_receipt_invalid"].includes(parameters.p_failure_code)
            ? "ambiguous"
            : "retry_wait";
        return { data: { settled: true, status, terminal: permanent }, error: null };
      }
      if (name === "portal_cleanup_meeting_terminal_notifications_service") {
        return { data: { deletedPayloads: 0 }, error: null };
      }
      if (name === "portal_meeting_terminal_notification_backlog_service") {
        return { data: options.backlog ?? EMPTY_BACKLOG, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  return client;
}

test("parser estrito rejeita propriedades extras, IDs trocados e payload condicional inválido", () => {
  assert.deepEqual(worker.parseMeetingTerminalNotificationCommand(COMMAND), COMMAND);
  for (const invalid of [
    { ...COMMAND, extra: true },
    { ...COMMAND, meeting_session_id: "018f1e2d-3c4b-7a04-8c9d-001122334458" },
    { ...COMMAND, recipient_emails: ["Admin@Example.test"] },
    { ...COMMAND, dispatch_deadline_at: "2099-08-31 23:00:00" },
    { ...COMMAND, workspace_name: "🚀".repeat(161) },
    { ...COMMAND, payload_frozen: true, subject: null, html: null, payload_fingerprint: null },
  ]) assert.throws(() => worker.parseMeetingTerminalNotificationCommand(invalid));
  assert.equal(worker.parseMeetingTerminalNotificationCommand({
    ...COMMAND, workspace_name: "🚀".repeat(160),
  }).workspace_name, "🚀".repeat(160));
});

test("provider ausente falha antes de lease e credencial temporária não consome tentativa", async () => {
  assert.equal(worker.meetingTerminalNotificationProviderReady({}), false);
  assert.equal(worker.meetingTerminalNotificationProviderReady({ PORTAL_FAKE_PROVIDERS: "1" }), true);
  assert.equal(worker.meetingTerminalNotificationProviderReady({ RESEND_API_KEY: "re_test_key" }), true);
  let clientCreated = false;
  await assert.rejects(worker.dispatchMeetingTerminalNotifications({
    env: {},
    createClient: () => {
      clientCreated = true;
      return createClient();
    },
  }), /provider is not configured/);
  assert.equal(clientCreated, false);
});

test("provider aceito só vira sucesso depois do fence e do ACK booleano", async () => {
  const client = createClient();
  const order = [];
  const result = await worker.dispatchMeetingTerminalNotifications({
    env: { PORTAL_FAKE_PROVIDERS: "0", RESEND_API_KEY: "re_test_key" },
    createClient: () => ({
      rpc: async (name, parameters) => {
        order.push(name);
        return client.rpc(name, parameters);
      },
    }),
    createLeaseToken: () => LEASE_TOKEN,
    sendProvider: async (input) => {
      order.push("provider");
      assert.equal(input.idempotencyKey, COMMAND.provider_idempotency_key);
      assert.deepEqual(input.to, COMMAND.recipient_emails);
      return { outcome: "provider_accepted", providerReceiptRef: "email_receipt_123" };
    },
    logEvent: () => {},
  });
  assert.equal(result.providerAccepted, 1);
  assert.equal(result.ambiguous, 0);
  const lease = client.calls.find(({ name }) => name === "portal_lease_meeting_terminal_notifications_service");
  assert.equal(lease.parameters.p_limit, 4);
  assert.equal(lease.parameters.p_lease_seconds, 60);
  assert.ok(order.indexOf("portal_begin_meeting_terminal_notification_dispatch_service") < order.indexOf("provider"));
  assert.ok(order.indexOf("provider") < order.indexOf("portal_ack_meeting_terminal_notification_service"));
  const ack = client.calls.find(({ name }) => name === "portal_ack_meeting_terminal_notification_service");
  assert.match(ack.parameters.p_provider_receipt_digest, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(ack).includes("email_receipt_123"), false);
});

test("resposta ambígua é persistida como ambígua com a mesma chave", async () => {
  const client = createClient({ backlog: { ...EMPTY_BACKLOG, providerAccepted: 0, ambiguous: 1 } });
  const providerCalls = [];
  const result = await worker.dispatchMeetingTerminalNotifications({
    createClient: () => client,
    createLeaseToken: () => LEASE_TOKEN,
    sendProvider: async (input) => {
      providerCalls.push(input);
      return { outcome: "provider_ambiguous", failureCode: "provider_timeout" };
    },
    logEvent: () => {},
  });
  assert.equal(result.ambiguous, 1);
  assert.equal(providerCalls[0].idempotencyKey, COMMAND.provider_idempotency_key);
  const failure = client.calls.find(({ name }) => name === "portal_fail_meeting_terminal_notification_service");
  assert.equal(failure.parameters.p_failure_code, "provider_timeout");
  assert.ok(failure.parameters.p_retry_seconds >= 5);
});

test("aceite remoto com ACK local perdido nunca é qualificado como sucesso", async () => {
  const client = createClient({
    ackReceipt: false,
    backlog: { ...EMPTY_BACKLOG, providerAccepted: 0, delivering: 1 },
  });
  const result = await worker.dispatchMeetingTerminalNotifications({
    createClient: () => client,
    createLeaseToken: () => LEASE_TOKEN,
    sendProvider: async () => ({ outcome: "provider_accepted", providerReceiptRef: "email_receipt_123" }),
    logEvent: () => {},
  });
  assert.equal(result.providerAccepted, 0);
  assert.equal(result.ambiguous, 1);
  assert.equal(client.calls.some(({ name }) => name === "portal_fail_meeting_terminal_notification_service"), false);
});

test("payload congelado divergente e comando poison vão direto a dead letter sem provider", async () => {
  const rendered = worker.renderMeetingTerminalNotificationV1(COMMAND);
  const frozenConflict = {
    ...COMMAND,
    payload_frozen: true,
    subject: rendered.subject,
    html: rendered.html,
    payload_fingerprint: "a".repeat(64),
  };
  const poison = { ...COMMAND, terminal_status: "delivered" };
  for (const candidate of [frozenConflict, poison]) {
    const client = createClient({
      commands: [candidate],
      backlog: { ...EMPTY_BACKLOG, providerAccepted: 0, deadLetter: 1 },
    });
    let providerCalls = 0;
    const result = await worker.dispatchMeetingTerminalNotifications({
      createClient: () => client,
      createLeaseToken: () => LEASE_TOKEN,
      sendProvider: async () => { providerCalls += 1; throw new Error("must not send"); },
      logEvent: () => {},
    });
    assert.equal(result.deadLettered, 1);
    assert.equal(providerCalls, 0);
  }
});

test("revogação detectada no fence vira dead letter sem provider e sem abortar o batch", async () => {
  const client = createClient({
    beginReceipt: { begun: false, terminal: true, failureCode: "recipient_authority_changed" },
    backlog: { ...EMPTY_BACKLOG, providerAccepted: 0, deadLetter: 1 },
  });
  let providerCalls = 0;
  const result = await worker.dispatchMeetingTerminalNotifications({
    createClient: () => client,
    createLeaseToken: () => LEASE_TOKEN,
    sendProvider: async () => { providerCalls += 1; throw new Error("must not send"); },
    logEvent: () => {},
  });
  assert.equal(result.deadLettered, 1);
  assert.equal(providerCalls, 0);
});

test("telemetria do batch é agregada e não contém destinatário, HTML ou resposta crua", async () => {
  const events = [];
  const client = createClient();
  await worker.dispatchMeetingTerminalNotifications({
    createClient: () => client,
    createLeaseToken: () => LEASE_TOKEN,
    sendProvider: async () => ({ outcome: "simulated", providerReceiptRef: "RAW_PROVIDER_RESPONSE_CANARY" }),
    logEvent: (event, context) => events.push({ event, context }),
  });
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("recipient-canary@example.test"), false);
  assert.equal(serialized.includes("<p>"), false);
  assert.equal(serialized.includes("RAW_PROVIDER_RESPONSE_CANARY"), false);
});

test("autorização e flag são estritas e falham fechadas", () => {
  const secret = "meeting-notification-secret-for-tests";
  assert.equal(worker.isMeetingTerminalNotificationDispatchEnabled({ MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: "true" }), true);
  for (const value of [" TRUE ", "TRUE", "1", "false", undefined]) {
    assert.equal(worker.isMeetingTerminalNotificationDispatchEnabled({ MEETING_TERMINAL_NOTIFICATION_OUTBOX_ENABLED: value }), false);
  }
  assert.equal(worker.authorizeMeetingTerminalNotificationDispatch(`Bearer ${secret}`, secret), "authorized");
  assert.equal(worker.authorizeMeetingTerminalNotificationDispatch("Bearer wrong", secret), "unauthorized");
  assert.equal(worker.authorizeMeetingTerminalNotificationDispatch(null, "short"), "not_configured");
});
