# Session Actor boundary in M1

The canonical M1 Session Actor lives only in `@axtro/session-runtime`. It is a
tenant and session keyed hot projection of already committed canonical events.

The Python realtime worker remains responsible for trusted telemetry handling
only in M1. It must not implement a second reducer, mailbox, snapshot cache,
outbox writer, provider call, media publisher, or synchronous Axtro Agent
bridge.

A future worker adapter must pass a validated internal carrier and a canonical
event to the TypeScript runtime boundary. Durable snapshot persistence belongs
to M1-06. Python media and provider cancellation integration belongs to M2.
