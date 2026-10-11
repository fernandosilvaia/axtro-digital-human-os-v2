# ADR-050: Brain tool-calling bridge and the regulated closer envelope

**Status:** Accepted for the local branch `integration/codex-2026-10`. The wire format Tavus sends and expects is not yet confirmed against a live call.
**Date:** 2026-10-11
**Related:** ADR-036, ADR-039, ADR-041, ADR-047, ADR-049, D-V2-195, D-V2-196, D-V2-197

## Context

ADR-041 defined the tool-call funnel for personas whose LLM Tavus hosts. A persona served by the portal's own brain (`/api/brain/<agentId>/chat/completions`) could not use it: the route streamed text only, the parser rejected the `tool` role, and the video prompt still promised scheduling tools. The model therefore invented appointment times that nothing booked.

Three constraints shape any fix:

- The reservation envelope for `brain_generation` (20,000 input tokens, measured in bytes, 512 output, US$ 0.05) is pinned inside the database reservation functions (migrations 0040, 0067, 0074). Changing the constant in code alone makes every reservation fail.
- A throw after a paid provider response marks the reservation `unknown`, and `blocked_unknown` then refuses every new AI reservation for the tenant, embeddings included, until someone reconciles by SQL.
- Everything Tavus sends is untrusted input. That includes the `tools` field of the request body, the `tool` messages, and the arguments a browser returns.

The Life Insurance vertical adds a regulatory constraint: a sentence that claims a license, an approval, a government link or a guaranteed return creates exposure the moment it becomes audio.

## Decision

**Trust boundary.** From the `tools` field of a request only the tool name is used, and only when it is in a closed list (`brain-tools.ts`). The description and JSON Schema the model sees are always ours: the three business tools repeat the ADR-041 contract verbatim, and a test fails if they drift from `scripts/provision-tavus-business-tools.mjs`. A fourth tool, `estimate_coverage_need`, is offered only in video and only in the life insurance qualification vertical.

**Wire format.** The route emits the OpenAI streaming shape: a content chunk, a `tool_calls` delta (`index`, `id`, `type`, `function.name`, `function.arguments`), a final chunk with `finish_reason` `tool_calls` or `stop`, and `[DONE]`. The helper lives in `lib/brain/completion-stream.ts` because route files cannot export arbitrary functions.

**Tool results.** A `tool` message becomes a user turn behind a label that only the parser can produce. The same label typed by a person, or embedded in a result, is replaced with neutral text. Results are capped at 2,000 characters, lose perception tags, and skip knowledge retrieval for that turn.

**Calculator.** `estimate_coverage_need` runs in the browser: the DIME method, deterministic, no cost, nothing stored. The person sees the full breakdown on screen. The text returned to the model always frames it as an educational estimate and leaves amount and product to the licensed agent. A small gap is never rounded to zero for speech.

**Malformed tool calls never lock the tenant.** The adapter drops each invalid call on its own (bad id or name, truncated JSON, non-object arguments, not offered, beyond four) and reports `droppedToolCalls`. When nothing usable remains the error carries `billedUsage`, but only if the provider reported two finite, non-negative token counts. The route then commits the reservation with that usage instead of marking it unknown. If the model asked for a tool and no call was usable, the core records the cost and throws `BrainToolCallUnusableError`, so the turn degrades to the fixed retry line instead of speaking a preamble ("let me check the calendar") for a tool that never ran.

**Fit inside the pinned envelope.** Until a coordinated migration raises the ceiling, optional context is fitted by priority: the two most recent turns, knowledge from best-ranked down, perception and provider context trimmed from the start, then older history as one contiguous block. The system prompt, tool schemas and the live user turn are never cut; if they alone exceed the ceiling the call fails closed before the provider, as before. What was trimmed is returned as a report. The route logs `brain_context_trimmed` with counts and states only, and the trace carries the same summary. Degradation never looks like health.

**Spoken language is separate from instruction language.** `SpokenLanguage` adds `spanish` without touching the many English or Portuguese branches that would otherwise route it to Portuguese silently. Spanish personas use the reviewed English instructions plus a directive (US Hispanic Spanish, *usted* by default), Spanish fixed lines, and a Spanish retreat sentence from the sentinel.

**Bounded tool hops.** Every hop is a new request with a new reservation of up to US$ 0.05, so a model stuck in a loop (the calculator answers "insufficient data" and the model asks again) could drain the tenant ceiling. The parser counts the tool results that close the conversation without a person turn between them. At three, no tool is offered and the prompt stops promising tools, so the model has to speak. A real person turn resets the count.

**Compliance sentinel.** It stays deterministic and post-generation, in three languages. Matching runs on a normalized copy (NFKC, typographic apostrophes, zero-width and soft hyphen removed, Cyrillic and Greek lookalikes mapped), while the spoken text keeps its original characters. Negation only absolves what comes before the claim or inside it in the same clause, so "you're pre-approved with no medical exam" is still a violation, and "don't worry" is not treated as a negation. A conditional before the claim exempts approval talk only. Rules cover government affiliation (including "backed by" and framing without a first-person subject), federal license, self-described underwriter, an AI claiming to be licensed (with or without a preposition), approval promises in present and future with adverbs and other subjects, explicit product recommendation, tax-free guarantees, loss guarantees, requests for SSN, bank or card numbers by voice, and definitive quotes (including other periods, "bucks", and a hedge that speaks of something else). "Endorsed by AARP" and "100% safe" are deliberately not flagged because both have legitimate uses and a false positive replaces a good explanation with the retreat line.

**Observability.** One trace per turn goes to Langfuse over OTLP/HTTP JSON with no SDK, scheduled with `after()` so it never delays audio. It carries ids, timings, model, token counts including cached tokens, cost, tool names, sentinel codes, degradation reason and the fit summary. It never carries what the person or the persona said, tool arguments or tool results. It is off unless three variables are set, and there is no default host because Cloud EU, Cloud US or a self-hosted instance is a data residency decision.

**Evaluation and voice labs stay outside the app.** `experiments/conversation-eval/` and `experiments/voice-lab/` pin their dependencies in their own requirements files, run in dry-run by default, accept a retrieval backend only on loopback, and require an exact confirmation value before any paid call.

## Alternatives rejected

- **Use the tool schemas Tavus sends.** The provider's text would reach the model with the authority of our prompt.
- **Throw on a malformed tool call.** It was the first implementation; the review showed it can block all AI for a tenant after a paid response.
- **Raise the ceiling in code only.** Every reservation would be refused until the database functions change.
- **Send conversation text to the observability vendor.** The consent given for the demonstration covers conducting the conversation, not a third-party analytics copy.
- **An LLM judge inside the compliance path.** Non-deterministic, one more paid call, and added latency on the audio path.

## Consequences

- A brain-served persona can register leads and schedule real meetings once the tools are attached to the persona and the business action bridge is enabled for the tenant.
- With all four tools and a full knowledge result, roughly 2.3 KB of the envelope remains for context. In long calls the persona remembers less of the beginning. The report makes this visible; raising the ceiling is recorded in `docs/NEEDS_CONNECTION.md` and must be applied in production before the deploy that changes the constant.
- The sentinel is pattern based and cannot be exhaustive. It narrows the exposure; it does not replace the licensed agent.
- Langfuse becomes a subprocessor only when its variables are set. Choosing the host, the legal basis and the processing record is a human decision.

## Not decided here

- The exact request and response format Tavus uses for tool calls on a custom LLM endpoint. The bridge follows the OpenAI contract and needs one paid call to confirm.
- The model quality of the persona. Offline checks use simulated replies; no live generation has been scored.
- Any production action: no persona, tool, migration, deploy or credential was created or changed by this work.
