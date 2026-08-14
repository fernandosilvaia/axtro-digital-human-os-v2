import assert from "node:assert/strict";
import { test } from "node:test";

import { TextGenerationError } from "../../packages/provider-openrouter/dist/index.js";

const reservations = await import("../../apps/portal/src/lib/ai-budget/reservations.ts");

function client(handler) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return handler?.(name, args) ?? { data: null, error: null };
    },
  };
}

test("service boundary reserves the worst-case token and cost envelope before provider execution", async () => {
  const fake = client(() => ({ data: { outcome: "reserved", reservationId: "r1", state: "reserved", providerRequestRef: "ppr_1" }, error: null }));
  const result = await reservations.beginAiUsage({
    client: fake,
    tenantId: "tenant-1",
    operation: "chat_generation",
    idempotencyKey: reservations.stableAiUsageIdempotencyKey("chat_generation", "tenant:turn"),
    agentId: "agent-1",
  });
  assert.equal(result.allowed, true);
  assert.equal(fake.calls[0].name, "portal_begin_ai_usage_reservation_service");
  assert.equal(fake.calls[0].args.p_tenant_id, "tenant-1");
  assert.equal(fake.calls[0].args.p_max_input_tokens, 20_000);
  assert.equal(fake.calls[0].args.p_max_output_tokens, 512);
  assert.equal(fake.calls[0].args.p_max_cost_usd, 0.05);
});

test("capped, unknown and DB failure never authorize provider execution", async () => {
  for (const response of [
    { data: { outcome: "capped" }, error: null },
    { data: { outcome: "blocked_unknown" }, error: null },
    { data: null, error: { message: "db down" } },
  ]) {
    const result = await reservations.beginAiUsage({
      client: client(() => response), tenantId: "tenant-1", operation: "knowledge_ingestion_embedding", idempotencyKey: "ai:ingest:fixture",
    });
    assert.equal(result.allowed, false);
  }
});

test("service reservation fails closed without a server-derived tenant", async () => {
  const missing = await reservations.beginAiUsage({
    client: client(), tenantId: "", operation: "brain_generation", idempotencyKey: "ai:brain:missing",
  });
  assert.deepEqual(missing, { allowed: false, reason: "unavailable" });

  const fake = client(() => ({ data: { outcome: "reserved", reservationId: "r2", state: "reserved" }, error: null }));
  const ok = await reservations.beginAiUsage({
    client: fake, operation: "brain_generation", idempotencyKey: "ai:brain:tenant",
    tenantId: "tenant-1", agentId: "agent-1",
  });
  assert.equal(ok.allowed, true);
  assert.equal(fake.calls[0].name, "portal_begin_ai_usage_reservation_service");
  assert.equal(fake.calls[0].args.p_tenant_id, "tenant-1");
});

test("only the database winner reaches the provider fence", async () => {
  const fake = client(() => ({ data: { acquired: true, state: "provider_in_flight" }, error: null }));
  const reservation = { id: "r", costEventId: "c", outcome: "reserved", state: "reserved", providerRequestRef: null, operation: "chat_generation" };
  assert.equal(await reservations.markAiUsageInFlight(fake, reservation), true);
  assert.equal(fake.calls[0].name, "portal_mark_ai_usage_in_flight_service");
});

test("31st concurrent ingestion denied by the atomic cap makes zero provider calls", async () => {
  let reservationsWon = 0;
  let providerCalls = 0;
  const fake = client((name) => {
    if (name === "portal_begin_ai_usage_reservation_service") {
      reservationsWon += 1;
      return reservationsWon <= 30
        ? { data: { outcome: "reserved", reservationId: `r${reservationsWon}`, state: "reserved" }, error: null }
        : { data: { outcome: "capped" }, error: null };
    }
    if (name === "portal_mark_ai_usage_in_flight_service") return { data: { acquired: true, state: "provider_in_flight" }, error: null };
    if (name === "portal_commit_ai_usage_service") return { data: { committed: true, replayed: false }, error: null };
    return { data: null, error: { message: "unexpected RPC" } };
  });

  const results = await Promise.all(Array.from({ length: 31 }, (_, index) => reservations.executeReservedAiUsage({
    client: fake,
    tenantId: "tenant-1",
    operation: "knowledge_ingestion_embedding",
    idempotencyKey: `ai:ingest:${index}`,
    sourceId: `source-${index}`,
    execute: async () => {
      providerCalls += 1;
      return { inputTokens: 100 };
    },
    usage: (value) => ({ inputTokens: value.inputTokens, outputTokens: 0 }),
  })));

  assert.equal(providerCalls, 30);
  assert.equal(results.filter((result) => result.outcome === "committed").length, 30);
  assert.deepEqual(results[30], { outcome: "denied", reason: "capped" });
});

test("provider success followed by commit failure is fenced as unknown", async () => {
  const fake = client((name) => {
    if (name === "portal_begin_ai_usage_reservation_service") {
      return { data: { outcome: "reserved", reservationId: "r-commit", state: "reserved" }, error: null };
    }
    if (name === "portal_mark_ai_usage_in_flight_service") return { data: { acquired: true, state: "provider_in_flight" }, error: null };
    if (name === "portal_commit_ai_usage_service") return { data: null, error: { message: "connection lost" } };
    if (name === "portal_mark_ai_usage_unknown_service") return { data: true, error: null };
    return { data: null, error: { message: "unexpected RPC" } };
  });

  const result = await reservations.executeReservedAiUsage({
    client: fake,
    tenantId: "tenant-1",
    operation: "knowledge_ingestion_embedding",
    idempotencyKey: "ai:ingest:commit-lost",
    sourceId: "source-commit",
    execute: async () => ({ inputTokens: 100 }),
    usage: (value) => ({ inputTokens: value.inputTokens, outputTokens: 0 }),
  });

  assert.deepEqual(result, { outcome: "commit_pending" });
  assert.equal(fake.calls.at(-1).name, "portal_mark_ai_usage_unknown_service");
  assert.equal(fake.calls.at(-1).args.p_failure_code, "usage_commit_failed");
});

test("a rejected commit RPC is fenced as unknown before control returns", async () => {
  const fake = client((name) => {
    if (name === "portal_begin_ai_usage_reservation_service") {
      return { data: { outcome: "reserved", reservationId: "r-rejected-commit", state: "reserved" }, error: null };
    }
    if (name === "portal_mark_ai_usage_in_flight_service") {
      return { data: { acquired: true, state: "provider_in_flight" }, error: null };
    }
    if (name === "portal_commit_ai_usage_service") throw new Error("RPC transport reset");
    if (name === "portal_mark_ai_usage_unknown_service") return { data: true, error: null };
    return { data: null, error: { message: "unexpected RPC" } };
  });

  const result = await reservations.executeReservedAiUsage({
    client: fake,
    tenantId: "tenant-1",
    operation: "knowledge_query_embedding",
    idempotencyKey: "ai:query:commit-rpc-rejected",
    agentId: "agent-1",
    execute: async () => ({ inputTokens: 99 }),
    usage: (value) => ({ inputTokens: value.inputTokens, outputTokens: 0 }),
  });

  assert.deepEqual(result, { outcome: "commit_pending" });
  assert.deepEqual(
    fake.calls.slice(-2).map((call) => call.name),
    ["portal_mark_ai_usage_unknown_service", "portal_mark_ai_usage_unknown_service"],
    "the helper fences the rejected commit and the caller verifies the idempotent durable receipt",
  );
});

test("commit forwards provider-reported cost and deterministic replay result", async () => {
  const fake = client(() => ({ data: { committed: true, replayed: false, costEventId: "c" }, error: null }));
  const reservation = { id: "r", costEventId: "c", outcome: "reserved", state: "reserved", providerRequestRef: null, operation: "brain_generation" };
  assert.equal(await reservations.commitAiUsage(fake, reservation, { inputTokens: 42, outputTokens: 17, reportedCostUsd: 0.0012 }), true);
  assert.deepEqual(fake.calls[0].args, { p_id: "r", p_actual_input_tokens: 42, p_actual_output_tokens: 17, p_reported_cost_usd: 0.0012 });
});

test("every failure after dispatch, including provider_rejected, becomes unknown", async () => {
  const reservation = { id: "r", costEventId: "c", outcome: "reserved", state: "reserved", providerRequestRef: null, operation: "chat_generation" };
  for (const error of [
    new TextGenerationError("provider_rejected", "HTTP rejection with ambiguous billing"),
    new TextGenerationError("provider_timeout", "timeout"),
    new TextGenerationError("malformed_provider_response", "bad"),
  ]) {
    const ambiguous = client(() => ({ data: true, error: null }));
    await reservations.recordAiUsageProviderFailure(ambiguous, reservation, error);
    assert.equal(ambiguous.calls[0].name, "portal_mark_ai_usage_unknown_service");
    assert.equal(ambiguous.calls.some((call) => call.name === "portal_release_ai_usage_service"), false);
  }
});

test("unknown and not-dispatched transitions require an exact durable true receipt", async () => {
  const reservation = { id: "r", costEventId: "c", outcome: "reserved", state: "reserved", providerRequestRef: null, operation: "chat_generation" };
  for (const response of [
    { data: false, error: null },
    { data: null, error: { message: "database unavailable" } },
  ]) {
    await assert.rejects(
      reservations.markAiUsageUnknown(client(() => response), reservation, "ambiguous"),
      /durable success receipt/,
    );
    await assert.rejects(
      reservations.releaseAiUsageNotDispatched(client(() => response), reservation),
      /durable success receipt/,
    );
  }
});

test("provider request scope is stable with authenticated request identity and unique without it", () => {
  assert.equal(reservations.aiProviderRequestScope("tavus-request-0001"), "provider:tavus-request-0001");
  assert.equal(reservations.aiProviderRequestScope("tavus-request-0001"), "provider:tavus-request-0001");
  const first = reservations.aiProviderRequestScope(null);
  const second = reservations.aiProviderRequestScope(null);
  assert.match(first, /^request:[0-9a-f-]{36}$/);
  assert.notEqual(first, second, "identical message bodies in separate provider requests cannot collide forever");
  assert.notEqual(reservations.aiProviderRequestScope("bad id with spaces"), reservations.aiProviderRequestScope("bad id with spaces"));
});

test("generation model must match the reviewed rate-card allowlist", () => {
  assert.equal(
    reservations.configuredOpenRouterGenerationModel({}),
    reservations.OPENROUTER_GENERATION_MODEL,
  );
  assert.equal(
    reservations.configuredOpenRouterGenerationModel({ OPENROUTER_MODEL: reservations.OPENROUTER_GENERATION_MODEL }),
    reservations.OPENROUTER_GENERATION_MODEL,
  );
  assert.throws(
    () => reservations.configuredOpenRouterGenerationModel({ OPENROUTER_MODEL: "unreviewed/expensive-model" }),
    /active AI usage rate card/,
  );
});
