# ADR-038: Portal channels enter through a durable constitutional runtime bridge

**Status:** Accepted for M5-02
**Date:** 2026-08-18
**Related:** ADR-004, ADR-005, ADR-007, ADR-010, ADR-015, ADR-022 through ADR-025, ADR-032, ADR-034 through ADR-036

## Context

The Portal has real Tavus and Recall channel paths, but they were introduced
beside the canonical session runtime. A signed-in user or a service-to-service
caller could reserve and create a paid provider resource without an
authoritative interaction session, delivered AI disclosure, purpose-scoped
consent, a presenter floor, or a durable channel receipt. Provider and
retrieval content was also being placed in model `system` messages, and a
browser presentation surface could acknowledge a model-originated scene action
without an allowlisted manifest, a generation fence, policy, or receipt.

Those behaviors violate Constitution Arts. 1–3, 5–10 and 15. They also make a
visually polished public launch unsafe: a feature flag must never re-enable a
legacy direct provider path.

## Decision

### One durable authorization boundary

`apps/portal/src/lib/runtime/` owns `PortalChannelRuntimeBridge`, the only
Portal boundary permitted to authorize a Tavus or Recall creation, attachment,
or a provider-visible scene publish. The bridge is a control-plane transaction,
not a media loop and not an Axtro Agent dependency.

An authenticated human request or a separately authenticated provider callback
first resolves server-owned tenant, actor, agent, channel and capabilities. In
one durable, tenant-scoped transition it creates or replays an
`InteractionSession` projection, its digital presenter, disclosure evidence,
purpose evidence, current presenter/generation fence, and a short-lived
internal channel-provision grant. The grant is bound to the exact tenant,
session, agent, channel kind, capability set, command fingerprint and kill
switch version. It is one-time for provider dispatch; replay returns the same
grant/result and conflicting reuse fails closed.

Provider actions may begin their existing paid-effect reservation only after a
bridge grant is acquired. The reservation remains the M5-01 spend fence; the
bridge is the preceding constitutional authorization fence. A provider result,
its session mapping and its immutable channel receipt are persisted before it
is exposed to a client. A persistence ambiguity compensates the known provider
resource or remains `unknown`; it never falls back to the legacy direct path.

### External correlation and receipt integrity

A browser-generated `commandId` is an opaque, RFC 4122 UUID correlation value
only. It may be UUIDv1 through UUIDv8 because browser `crypto.randomUUID()`
generates UUIDv4; it is hashed before it participates in idempotency and never
selects tenant, actor, session, presenter, grant, evidence, or a persisted
server-owned identifier. Those authoritative identifiers remain UUIDv7.

The durable provider-channel receipt binds the exact provider reference (and
the provider URL when present) already committed by the matching reservation;
it cannot combine a valid grant/reservation with another resource from the
same provider or tenant. Kill-switch audit rows use composite tenant/switch
references so a cross-tenant receipt is structurally impossible. These checks
are forward-only database hardening and do not re-enable any legacy path.

The production storage adapter is additive and durable. Its rows use composite
tenant/session references, forced RLS, service-only mutation RPCs and
append-only receipts. It materializes the existing `InteractionSessionState`
and timeline semantics rather than treating browser state, provider state or a
new JSON blob as the source of truth.

### Disclosure and purpose-specific consent

AI identity disclosure must be durably delivered before a channel grant exists.
`essential_processing` must be present and granted for every real channel.
Every requested optional capability additionally requires its matching,
non-revoked purpose evidence: recording, persistent transcription,
behavioral analysis, visual analysis, or any future declared purpose. A caller
cannot assert consent, jurisdiction, disclosure version, tenant, presenter or
purpose by request body. An optional capability with no valid evidence is
removed before provider selection; if a provider cannot run without that
capability, creation is denied before the reservation.

External-meeting and lead routes receive only server-created consent/bridge
references. A meeting URL, provider payload or lead-controlled field is never
evidence that other participants consented.

### Floor, generations and scenes

The bridge maintains exactly one digital `active_presenter_id` and monotonic
session generation/cancellation epochs. Every media or scene publication is
checked against the current fence immediately before it reaches the channel.
Late work is discarded and recorded as rejected; it cannot reclaim the floor.

The model can submit only a typed high-level `SceneIntent`. Server code runs it
through the closed `SceneManifestRegistry` and `SceneDirector`, applies policy,
checks the bridge generation and capability grant, renders via a controlled
adapter, and appends a `SceneExecutionReceipt`. A browser or provider tool
callback cannot report local success as an authority. While the bridge or scene
capability is disabled, it returns an explicit rejected result and performs no
local action.

### External data and the Axtro Agent

Only reviewed, static Portal policy/persona text may have the model `system`
role. Provider messages, transcripts, RAG records, perceptions, documents,
screens and specialist suggestions are provenance-labelled, bounded,
untrusted reference data. They cannot alter identity, policies, permissions,
tools, presenter ownership or scene selection.

The Axtro Agent receives redacted/authorized events and may return typed,
TTL-bounded suggestions asynchronously. `AXTRO_AGENT_BRIDGE_ENABLED=false`
discards those suggestions while local conversation policy and media continue.
It is never in the synchronous audio-to-audio path.

### Kill switches and reconciliation

`PORTAL_RUNTIME_BRIDGE_ENABLED` is a process-level fail-closed deployment
switch, defaulting to disabled until a release owner enables it after the
runtime schema is ready. A durable, audited kill switch also exists at tenant,
agent, channel/provider and capability scope. Both switches are checked before
grant issuance, paid dispatch, provider attachment, scene publish and callback
processing. Disabling a switch blocks new effects and invalidates unpublished
generations; it does not silently kill an established call. A separate,
explicit emergency termination policy may compensate an already-known provider
resource and records its receipt.

The operator reconciliation surface required by ADR-036 is separate from
normal channel authority. It accepts a server-derived operator identity, two
distinct approvals for one evidence fingerprint, idempotency, an append-only
receipt and no browser-supplied ledger/provider authority. Until all of those
conditions exist, unknown paid effects remain blocked.

### Rollout and rollback

The schema change is expand-contract. The initial contract is v43; the
forward-only integrity repair `0044_runtime_bridge_integrity_repair.sql` raises
the Portal readiness capability to v44 and is mandatory before the bridge can
become ready. The bridge is disabled by default and there is no direct-provider
fallback. During rollout, apply v43 and then v44 after v40–v42, validate the
capability and its grants/RLS, start at zero public traffic, run fake and
real-provider canaries, then explicitly enable the bridge for an approved
tenant. Rollback uses the durable kill switch or a forward fix; it never removes
receipts, re-opens the legacy channel path, or relaxes M5-01 unknown barriers.

## Alternatives considered

1. Keep the direct Portal actions and add UI checkboxes. Rejected: a client
   checkbox neither records durable disclosure/consent nor protects service or
   provider callback paths.
2. Reuse process-local M1 fakes in the Portal. Rejected: they do not coordinate
   replicas or survive a restart.
3. Let Tavus/Recall own the canonical session. Rejected: provider state cannot
   prove tenant policy, consent, floor or durable receipts.
4. Put the Axtro Agent or an LLM in the preflight/media critical path. Rejected
   by Art. 1 and creates an availability/cost dependency.
5. Use a feature flag that falls back to legacy creation when disabled.
   Rejected: the switch would restore the precise violation it is meant to
   contain.

## Consequences

Channel availability becomes explicit: a disabled or unproven channel is
truthfully unavailable instead of creating a provider resource optimistically.
The Portal gains a narrow, testable control-plane adapter while retaining
provider-specific media adapters and M5-01 reservation semantics. It adds
durable storage, migration/readiness work and client consent/disclosure UX,
but makes future native-room and worker integrations replaceable without
relaxing the constitutional boundaries.

## Revisit trigger

Revisit when a durable realtime worker becomes the production writer for the
same session timeline, when a provider supplies a signed session/consent
contract that can be verified independently, or when operator reconciliation
receives its approved production identity system.
