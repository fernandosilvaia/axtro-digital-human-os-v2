# Textual Turn Driver boundary in M1

The canonical M1 textual Turn Driver lives only in `@axtro/turns`. It writes
authorized participant turns, Presenter responses, and interruption markers
through the canonical TypeScript outbox. The Session Actor in
`@axtro/session-runtime` observes the committed envelopes only.

The Python realtime worker continues to own trusted telemetry handling only in
M1. It must not duplicate turn parsing, participant authorization, the
idempotency ledger, the session lane, Fast Lane behavior, the actor, the
reducer, the outbox source, or a transcript store.

M1 Fast Lane is a local deterministic fake with one restricted text input and
a bounded textual response plus state patch. It receives both generation and
trusted request cancellation signals. It has no provider SDK, network,
tool, Action Runtime, media, scene, specialist, or synchronous Axtro Agent
dependency. It receives a generation signal and its result is rejected unless
the same generation and Presenter floor remain authoritative.

Before the Fast Lane runs, the Turn Driver invokes `@axtro/context-composer`
after the participant event has been committed and projected. This happens
outside the session lane and Actor mailbox. The explicit
`context_composition` payload is tenant and session scoped, versioned from the
projected state, UTF-8 bounded, provenance-preserving, and contains only
confirmed state, approved catalog snippets, and valid uncertain snapshots.
The Composer accepts the opaque projected-state snapshot only, never a raw
state object. Therefore the textual submit boundary requires both
`session:write` and `session:read` before its participant commit.
The Turn Driver reparses the payload and uses its own clock to reject expired,
future, or incoherent provenance before the fake receives it as structured
data. A future renderer may expose entry content and trust labels to a model,
but never provenance identifiers as instructions. No transcript timeline,
cache, RAG lookup, or asynchronous agent work is added to this synchronous
path.

M1-06 replaces the temporary outbox replay source with durable snapshots and
timeline persistence. M2 owns a verified participant channel adapter plus
audio, TTS, avatar, and channel cancellation propagation beyond the textual
request boundary.

M1-05's explicit catalog lookup coordinator is intentionally outside this
boundary. The Fast Lane neither emits `action_intent` nor imports Action
Runtime. A receipt-backed catalog candidate is not automatic speech, a
Presenter event, or a timeline entry; a later durable publication boundary
must apply its own floor and generation fences.
