# ADR-020: Fail-closed application ingress and adapter egress baseline

**Status:** Accepted for M0-M1
**Date:** 2026-07-14

## Context

The control API has authenticated tenancy, typed configuration and deterministic provider fakes, but it has no framework-specific HTTP server yet. It still needs a safe, reusable boundary for hostile request input, bounded resource use and future adapter network calls.

## Decision

Keep the application security baseline framework-neutral in `@axtro/security` and compose it from `@axtro/api`.

- Measure actual received bytes before JSON parsing or authentication. `Content-Length` is advisory only. The baseline has explicit, code-owned limits for body bytes, header count, header name and value size, and total header bytes.
- Authenticate before rate limiting. A bounded, injected-clock limiter uses only an authenticated tenant and actor plus a code-owned route key. Public headers, body fields, client IP and forwarded headers never identify a quota bucket.
- Turn the validated `request_timeout_ms` into an absolute deadline and derived `AbortSignal`. A guarded execution rejects a late result and clears its timer.
- Return a closed API response-header profile with no-store, JSON charset, no-sniff, frame protection, restrictive CSP, restrictive Permissions Policy, referrer protection and same-origin opener policy. CORS reflection and wildcard CORS are absent. HSTS remains a trusted TLS composition concern, not an unconditional application header.
- Default deny all outbound destinations. Composition creates an opaque, adapter-specific egress capability from static registrations. The capability binds each approved token to its normalized target; only its `dispatch` boundary resolves that target for a transport. It permits only exact HTTPS origins and rejects userinfo, fragments, IP literals, loopback names, wildcard or suffix matching, alternate ports and unvalidated redirects. M0 fakes receive no egress capability and perform no network I/O.
- The release gate scans committed pnpm and uv locks against a committed, versioned advisory snapshot. A malformed or unavailable snapshot fails closed. High and critical findings fail the gate. The snapshot is deliberately local and deterministic during M0-M1; its external refresh is an operational input, not runtime egress.

## Alternatives considered

Add an HTTP framework or edge service before routes exist; allow adapters to receive raw URLs; query an online audit service during local tests.

## Consequences

M0-M1 gain a tested ingress and egress seam without selecting an HTTP framework, provider SDK or network client. Future API transports must compose the ingress gate before parsing and future real adapters must validate every redirect hop before I/O. DNS resolution and connected-peer IP validation remain a future real-transport responsibility.

## Revisit trigger

A production transport, distributed rate limiting requirement or real adapter is introduced.
