# ADR-047: Browser call lifecycle and remote effect recovery

**Status:** Accepted for local corrective audit AUD-03
**Date:** 2026-10-01
**Related:** ADR-004, ADR-034, ADR-036, ADR-038, ADR-041

## Context

Daily may emit tracks before live elements mount. Late tool results can reach a
new call, pending start can continue after unmount, and left-meeting can hide a
failed remote stop. A null URL represents both admission denial and ambiguous
provider effects; it does not authorize forgetting a paid intention.

## Decision

Add the closed `portal_video_start_effect` contract before changing producer and
consumer. Each start result carries an effect classification: `not_started`
only for proven predispatch denial, `possible` for ambiguous dispatch or
compensation, and `committed` for a committed remote room. This is an additive
application result field; it grants no provider authority. Classification describes
this invocation, not historical status of an arbitrary reused command. Browser
starts always use a fresh UUID; stored recovery commands invoke stop only.

Persist only the opaque command UUID in tab sessionStorage before start, with
server-resolved tenant, agent and channel in its key. Composite agent identity
must never be treated as globally unique. Restore a pending command as recovery
on remount. Clear it only on explicit not_started or authorized stop acceptance.
Lost transport responses stay possible. Storage failure blocks new paid starts
with a visible error. No URL, provider reference, consent, transcript or secret
is persisted. Storage is untrusted correlation; server RPCs retain authority.

Each local call attempt has an epoch. Events, media, asynchronous imports, joins,
tools and stop continuations must still match its captured call and command.
Cache initial tracks and bind them when elements mount. Remove stopped tracks.
Dispose exactly the captured partial object once, including join failure or
unmount. Local cleanup never invokes remote stop without human feedback.

Local room exit and remote stop acceptance are separate. A pending command
keeps an explicit retry action and blocks new calls even after left-meeting.
Provider acceptance is not proof of physical silence. Unknown remote resources
without a stoppable reference remain blocked for operator reconciliation; a
future authenticated status/cancellation API must resolve them without replaying
start. Closing a tab discards its sessionStorage; durable server reconciliation
remains necessary and is not claimed by this client repair.

For the Turn Coordinator, current-generation completion is accepted from
committed or agent_interrupted and transitions to idle, clears generation and
utterance counters. Completed playback cannot resume after a false interruption.
Stale completion is ignored. This preserves the one-presenter boundary.

## Alternatives and consequences

Keeping a command only in refs loses recovery on navigation. Automatic remote
stop on unmount has no confirmed feedback or retry. Treating every null URL as
not_started discards ambiguous effects. A new status RPC is useful but exceeds
this bounded client repair. The reversible default is explicit recovery and
closed new creation until resolution.

No provider selection, realtime rollout, consent policy or paid fence changes.
Canonical M6-04/M6-05/M6-06 gates remain closed where previously required.

## Validation

Replay real TSX with controlled React/Daily/actions; cover initial tracks,
old-call tool success/rejection, late events, start/import/join across unmount,
partial cleanup, ambiguous stop and remount, storage isolation/failure and fake
presentation. Replay interrupted completion and stale generation. Browser smoke
with fakes complements these tests; it does not prove live audiovisual silence.
