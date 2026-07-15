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

M1-06 replaces the temporary outbox replay source with durable snapshots and
timeline persistence. M2 owns a verified participant channel adapter plus
audio, TTS, avatar, and channel cancellation propagation beyond the textual
request boundary.
