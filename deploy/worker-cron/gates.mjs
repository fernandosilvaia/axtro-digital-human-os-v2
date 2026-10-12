// Filtros de resposta dos workers agendados, sem dependencias.
//
// Reproduzem exatamente o que os workflows do GitHub Actions aplicam hoje com jq:
// scripts/worker-response-gate.jq (billing e reconciler) e o RESPONSE_GATE embutido em
// .github/workflows/meeting-terminal-notification-dispatch.yml. A equivalencia e provada
// por tests/operations/worker-cron.test.mjs, que roda os dois lados sobre os mesmos
// payloads. Se um filtro mudar, os testes falham ate os dois voltarem a concordar.

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const has = (payload, name) => Object.hasOwn(payload, name);
const nonNegativeInteger = (value) => typeof value === "number" && Number.isInteger(value) && value >= 0;
const requiredCounter = (payload, name) => has(payload, name) && nonNegativeInteger(payload[name]);
const requiredZeroCounter = (payload, name) => requiredCounter(payload, name) && payload[name] === 0;
const requiredAge = (payload, name, population) =>
  has(payload, name) && (nonNegativeInteger(payload[name]) || (payload[name] === null && population === 0));

const COMMON_COUNTERS = ["leased", "failed", "deadLettered", "backlog", "deadLetterBacklog",
  "providerInFlight", "unknown", "cleanupPending"];
const COMMON_ZERO_COUNTERS = ["failed", "deadLettered", "deadLetterBacklog", "unknown", "cleanupPending"];

function commonGate(payload) {
  return isObject(payload)
    && payload.ok === true
    && COMMON_COUNTERS.every((name) => requiredCounter(payload, name))
    && COMMON_ZERO_COUNTERS.every((name) => requiredZeroCounter(payload, name));
}

export function gateBilling(payload) {
  return commonGate(payload)
    && payload.catalogVerified === true
    && requiredCounter(payload, "delivered")
    && requiredCounter(payload, "held")
    && requiredAge(payload, "oldestAgeSeconds", payload.backlog)
    && requiredAge(payload, "oldestHeldAgeSeconds", payload.held)
    && requiredAge(payload, "oldestProviderPendingAgeSeconds",
      payload.providerInFlight + payload.unknown + payload.cleanupPending)
    && (!has(payload, "operatorRequired") || requiredZeroCounter(payload, "operatorRequired"));
}

export function gateReconciler(payload) {
  return commonGate(payload)
    && requiredCounter(payload, "reconciled")
    && requiredCounter(payload, "processing")
    && requiredZeroCounter(payload, "operatorRequired")
    && requiredAge(payload, "oldestAgeSeconds",
      payload.backlog + payload.processing + payload.deadLetterBacklog)
    && requiredAge(payload, "oldestUnknownAgeSeconds", payload.unknown);
}

const MEETING_KEYS = ["ok", "leased", "providerAccepted", "simulated", "retryScheduled",
  "ambiguous", "deadLettered", "suppressed", "backlog", "deadLetterBacklog",
  "ambiguousBacklog", "oldestDispatchableAgeSeconds"].sort();
const MEETING_COUNTERS = MEETING_KEYS.filter((name) => name !== "ok");
const MEETING_ZERO_COUNTERS = ["retryScheduled", "ambiguous", "deadLettered", "deadLetterBacklog", "ambiguousBacklog"];

export function gateMeeting(payload) {
  if (!isObject(payload)) return false;
  const keys = Object.keys(payload).sort();
  return keys.length === MEETING_KEYS.length
    && keys.every((key, index) => key === MEETING_KEYS[index])
    && payload.ok === true
    && MEETING_COUNTERS.every((name) => nonNegativeInteger(payload[name]))
    && MEETING_ZERO_COUNTERS.every((name) => payload[name] === 0);
}

// Cada worker: rota protegida do portal, teto de espera da chamada (o mesmo dos
// workflows), filtro de resposta e os campos que vao para o log.
export const WORKERS = Object.freeze({
  billing: Object.freeze({
    path: "/api/internal/billing-usage",
    maxTimeMs: 480_000,
    gate: gateBilling,
    summary: ["leased", "delivered", "failed", "deadLettered", "backlog", "oldestAgeSeconds",
      "deadLetterBacklog", "held", "oldestHeldAgeSeconds", "providerInFlight", "unknown",
      "cleanupPending", "oldestProviderPendingAgeSeconds"],
  }),
  reconciler: Object.freeze({
    path: "/api/internal/provider-effects/reconcile",
    maxTimeMs: 90_000,
    gate: gateReconciler,
    summary: ["leased", "reconciled", "failed", "deadLettered", "operatorRequired", "backlog",
      "processing", "deadLetterBacklog", "providerInFlight", "unknown", "cleanupPending",
      "oldestAgeSeconds", "oldestUnknownAgeSeconds"],
  }),
  meeting: Object.freeze({
    path: "/api/internal/meeting-terminal-notifications",
    maxTimeMs: 120_000,
    gate: gateMeeting,
    summary: ["leased", "providerAccepted", "simulated", "suppressed", "backlog",
      "oldestDispatchableAgeSeconds"],
  }),
});
