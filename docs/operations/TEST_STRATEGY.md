# Test Strategy

## Test pyramid

### Unit
Reducers, state machines, policy rules, normalizers, cost calculations and provider error mapping.

### Contract
JSON Schemas, generated types, OpenAPI clients, AsyncAPI payloads, adapter compliance and examples.

### Integration
Postgres RLS, outbox, Redis, workflow engine, object storage and provider sandbox.

### E2E
Walking skeleton, realtime harness, handoff, provider failure and post-call workflow.

### Chaos and performance
Timeouts, packet loss, delayed results, provider outage, pool leakage, budget flood and graceful shutdown.

## Mandatory negative tests

- missing or wrong tenant;
- tool input extra property;
- expired consent;
- stale suggestion;
- non-current generation output;
- invalid scene origin;
- duplicate write retry;
- human floor race;
- prompt injection in document;
- provider returns malformed response;
- secret-like value in log.

## Realtime replay

Fixtures are immutable and versioned. The harness can run without external network using fake STT/LLM/TTS/avatar adapters and simulated timestamps.

## Test data

Synthetic by default. Real call samples require consent, redaction and explicit dataset purpose.
