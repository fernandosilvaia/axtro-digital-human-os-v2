# Closer improvements, 2026-10-01

Status: local implementation and integrated review complete after audit baseline `72ab1e9`.

The owner authorized IMP-01 through IMP-05. ADR-049 defines reversible boundaries.
M6-04 remains in progress. Experiments do not select or activate a production provider.

## Execution

| Task | State | Evidence |
|---|---|---|
| IMP-01 receipt-based closer lab and Promptfoo | done | 105 goldens; real CLI 10 assertions; full isolated audit 0/633; independent architecture/security approval |
| IMP-02 pgvector hybrid retrieval | done | SQL 0001-0074; 15 fixtures; 94 focused Node, independent 109; 12 Python; 71 contracts; three reviews |
| IMP-03 LiveKit and whisper.cpp lab | done | 27 tests + 5 subtests; real SDK lifecycle; 12 CPU audio runs; zero/88 Python advisories; two reviews |
| IMP-05 typed turn redaction | done | SQL 0001-0075; lineage 10; exact two-field projection, lease/hold/catalog fences and physical verification |
| IMP-04 integrated review | done | 2,119 Node + 63 Python; SQL75; 14 browser + manual; hashes and architecture evidence review approved |

## Evidence boundaries

Local implementation, fake replay, synthetic retrieval benchmark, actual SDK/CLI integration,
physical media, real model quality and hosted rollout are reported separately. Missing assets
are dependencies, never successful tests. Historical financial adjustments, canonical data
governance SQL ledgers/projectors/outbox, independent backup restore and real provider proofs
remain explicit work until implemented and verified.

## Open source dependency decisions

Official versions checked on 2026-10-01, before implementation. Pins are experiment tooling,
not production defaults. No new production dependency is installed by this decision.

| Tool | Verified pin and license | Purpose | Alternative |
|---|---|---|---|
| [Promptfoo](https://github.com/promptfoo/promptfoo/blob/0.116.7/package.json) | 0.116.7 selected development pin; 0.123.1 evaluated and rejected, MIT root package | Isolated development runner with a local provider | Existing Node golden runner |
| [LiveKit Agents](https://github.com/livekit/agents/releases) | 1.8.3, Apache-2.0 framework | Explicit-engine session/cancellation experiment | Existing Tavus/Recall adapters |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4) | v1.9.4, MIT | Explicit local binary/model transcription benchmark | Existing provider STT ports |
| [pgvector](https://github.com/pgvector/pgvector/blob/v0.8.6/README.md) | v0.8.6 upstream reference, PostgreSQL License | Reuse installed extension for exact hybrid retrieval | Existing vector-only RPC |

Extension and local executable versions must be reported from the actual run. An upstream
reference pin is not proof that the installed local or hosted extension has that version.
Promptfoo remote-generation opt-out is not an operating-system network sandbox. The offline
runner uses only checked-in synthetic fixtures, disables telemetry/update/cloud paths and
rejects credentials; it does not promise to isolate arbitrary third-party JavaScript.
LiveKit default inference, string engine shortcuts and implicit prewarming are avoided.
whisper assets are explicit, hashed and never downloaded by the runtime adapter.

## Remaining governance scope

The five canonical data-governance schemas, fixtures, AsyncAPI and generated types already
exist. The uncompleted M6-04 work is canonical SQL command/status/work-item/receipt ledgers
and atomic outbox integration, typed projectors beyond conversation transcripts, real external
adapters, independent verification and backup/PITR restore evidence. A getter returning a
canonical-looking shape cannot replace durable lineage. M6-05/M6-06 still depend on M6-04.

### IMP-01 isolated dependency repair

Installing Promptfoo 0.123.1 with scripts disabled exposed a current transitive basic-ftp
parser advisory affecting versions through 6.2.0. The experiment alone pins an override to
6.2.1; root production dependencies are unchanged. Compatibility must pass the actual local
Promptfoo CLI and the live isolated dependency audit, not just provider unit tests.

The latest evaluated Promptfoo 0.123.1 also imports an unpatched node-forge RSA verification
advisory through jks-js. It is rejected rather than excluded from audit. The official 0.116.7
release is selected for the local custom-provider runner, contingent on its full audit and
real CLI compatibility tests. The [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
and [selected release manifest](https://github.com/promptfoo/promptfoo/blob/0.116.7/package.json)
are primary sources. This choice does not apply an older prompt/model or provider in production.

### Evaluation authority

The pilot aggregator accepts reviewed records and their `resolved` marker from a trusted
operator workflow. Structural validation does not authenticate that workflow or create a
resolution receipt. Neither browser input nor LLM annotations may supply those records.
Its strongest result is `ready_for_human_review`, never approval for customer traffic.
The new receipt projection also assumes authenticated canonical storage; it verifies
scope, chronology, closed result shapes and effect fingerprints without inventing storage
authenticity. The current Portal business bridge uses a different receipt shape and needs
an audited adapter before this projection can become its customer-facing funnel.

### IMP-01 completed evidence

105 focused golden tests pass without skips. The actual guarded Promptfoo 0.116.7 CLI
passes ten expected-case assertions, including intentional critical negative cases.
The default report aggregate is blocked because its corpus deliberately contains missing
consent, disclosure and foreign-tenant evidence; exit zero means report generation succeeded,
not that an agent passed promotion. `productionPromotionAllowed` remains false.

The isolated full audit has zero findings across 633 packages. Exact overrides in the lab
manifest close basic-ftp, drizzle-orm, mathjs, sharp, tmp, csv-parse, fast-xml-parser and uuid
advisories; better-sqlite3 13.0.3 additionally makes the opt-in native tool compatible with
local Node 26.10.0. It was compiled from pinned local source with local Node headers and
`--force_build=1`. The runner requires the explicit build and verifies that a preferred
packaged binary is identical to it. No production dependency or global Node version changed.
Only the lab custom provider/CLI path is covered by this compatibility result.

Older CLI sharing uses `sharing:false` and `PROMPTFOO_DISABLE_SHARING=1`, because that
release does not support the newer `--no-share` flag. Its best-effort telemetry still attempts
fetch despite the disable flag; the guard rejects the request without egress and lets the
upstream promise catch complete. This is documented defense in depth, not an OS sandbox.
Default workspace tests do not import or install optional tooling. CI audits its lock and
runs deterministic tests/report generation. Naturalness is excluded from evaluator major 2;
major 0/1 and their parsers preserve the historical algorithm for honest replay/comparison.

### IMP-02 documentation and numerical review

Primary Supabase documentation confirms [hybrid RRF retrieval](https://supabase.com/docs/guides/ai/hybrid-search)
and [permission-aware RAG](https://supabase.com/docs/guides/ai/rag-with-permissions).
The [2026 extension change](https://supabase.com/changelog/extension-version-pinning-ignored)
means hosted extension version clauses no longer establish an installed pin. This increment
reuses the existing extension without installing or updating it. The reviewer measured local
PostgreSQL 17 with pgvector 0.8.5, distinct from the 0.8.6 upstream documentation reference.

Independent SQL reproduction exposed float32 overflow: opposite finite vectors with 1e30
components produced a NaN cosine, which PostgreSQL least/greatest could clamp to similarity 1.
The patch must normalize safely or reject non-finite raw similarities before clamping, with
actual positive and negative extreme-vector regressions. This is an implementation finding,
not a claim of measured production recall.

The security review also rejected a compatibility fallback to the old vector-only RPC:
its response cannot establish source access policy or version validity. If the new RPC
is missing, the new consumer returns no knowledge and does not retry the paid embedding.
Historical SQL files remain immutable. The additive migration must also harden legacy
search/digest bodies while preserving their signatures and wire shapes; an unverified citation label would
not make restricted or expired content permissible.

### IMP-02 measured local evidence and limits

PostgreSQL applies immutable contiguous migrations 0001 through 0074. Actual installed
pgvector is 0.8.5. The 15-fixture synthetic corpus passes lexical Recall@6 1/1, natural
commercial-question Recall@6 3/3 (PT/EN/ES), vector Recall@12 2/2 and exclusions 5/5.
These are fixture-sized denominators, not population estimates or commercial-quality claims.
RRF score for a single top-ranked lane is 0.01639344262295082. Extreme and tiny vectors,
source admission/dispatch, direct legacy search/digest, wrong tenants and financial replay
also pass. Historical null validity endpoints remain explicitly unbounded.

The new typed result brings the contract count to 71. Unicode uses code-point lengths for
schema compatibility and UTF-8 bytes for context budgeting. Empty excerpts are skipped,
telemetry sink errors cannot escape retrieval, and the real video-brain route consumes the
new helper. Text Preview remains closed. Unrecognized source policies fail closed; Portal
still has no canonical role/product/locale policy columns. In-memory filters retain their
existing richer structure and now use optional genuine vectors instead of hash similarity.

Source status is checked under locks both before reservation and before provider dispatch.
Only a still-reserved operation may be released as not dispatched; dispatched, unknown and
committed evidence is preserved. This does not establish authenticated actor binding or close
the remaining human-role revocation race. The database capability bundle remains version 73,
while the migration lineage head is 74; no production-readiness version is expanded.

The lexical index expression is eligible for planner optimization through NOT MATERIALIZED;
actual index use requires EXPLAIN. Exact semantic search still scans eligible embeddings.
Candidate/result bounds are not a proof of bounded scan work, large-tenant latency or capacity.
Readonly RPC cancellation/degradation is separate from a database execution-time proof and
from financial mutation reconciliation. Hosted schema and extension versions are unverified.

IMP-02 is complete locally: architecture, data and security reviews approve the bounded
patch. The optional readonly search has a maximum two-second response deadline and uses
Postgrest abortSignal when available; never-settling PromiseLike fakes degrade safely too.
This deadline does not race mutating usage receipts or prove server-side query cancellation.
Build, Portal typecheck, lint, diff check and all nine validators pass.

### IMP-03 local asset provenance

Installed whisper.cpp is 1.9.2, distinct from upstream 1.9.4. The resolved Homebrew binary
has SHA-256 `40bca494d49af736058eb3f33cbcebaa020eacf6d0087b623f334946e1ab2128`.
Runtime assets are supplied explicitly and never downloaded by an adapter. The parent fetched
immutable official model files and independently checked LFS pointers, sizes and SHA-256:

| Model | Bytes | SHA-256 |
|---|---:|---|
| [tiny](https://huggingface.co/ggerganov/whisper.cpp/raw/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.bin) | 77,691,713 | `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21` |
| [base](https://huggingface.co/ggerganov/whisper.cpp/raw/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin) | 147,951,465 | `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` |

Six disclosure/meeting phrases were synthesized locally with installed macOS voices: Eddy
PT/EN/ES and Luciana/Samantha/Mónica. PCM16 mono 16kHz WAVs, model binaries and source audio
stay in ignored `artifacts/local/realtime-lab`. Corpus metadata records fixture ID, voice,
reference, waveform hash and duration. No real customer recording or transcript is involved.
The preliminary Portuguese CLI probe completed in 1.069s (tiny) and 1.033s (base), with CPU
flags, but both made errors on Eddy; these probes are not the final adapter benchmark.
Retaining these difficult cases prevents reporting only favorable synthetic voices.

The real SDK source confirms that omitted turn/VAD defaults can infer cloud engines and that
an injected LLM object can immediately prewarm. Explicit None/manual settings and a reviewed
local factory are required. An interrupt Future establishes SDK processing, not physical silence.

### IMP-03 native CPU experiment

The owner-authorized local experiment additionally builds the official whisper.cpp v1.9.4
[tag](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4) at immutable commit
`927cfce34f31707e17f2bff35c349632fb9e2c3a`. The explicit isolated build disables Metal,
dynamic backend loading and shared libraries; WHISPER_BUILD_IS_DEV=OFF yields the measured
version string 1.9.4. Apple Clang 21.0.0 and transient CMake Python distribution 4.4.3 were
used. [CMake](https://cmake.org/licensing/) is BSD-3-Clause upstream; its
[Python distribution](https://pypi.org/project/cmake/4.4.3/) reports Apache-2.0 packaging.
Reason: avoid the measured backend initialization in a CPU-only experiment. Alternative:
retain the installed 1.9.2 runtime, or alter global Homebrew, which this task does not do.
No production dependency or executable was replaced.

The local release binary SHA-256 is
`86cac73d92558f15c60f3f08f32ade47cd6ea87ca15aeab89dbb2de65e2ee6af`.
Build provenance records source archive checksum, compiler and flags. Temporary source
extraction and CMake cache were removed after building; the immutable archive, models,
provenance and byte-identical relocated executable remain ignored local assets. The build emits a known upstream
stb_vorbis pointer-comparison warning; the adapter only stages validated PCM WAV inputs.
Python advisory scans do not certify the entire native toolchain.

The preliminary real adapter/CLI comparison uses identical six synthetic WAVs per model,
78 reference tokens per model, measured frame duration, four CPU threads and no fallback
sampling. Reports contain metrics and asset hashes, not transcripts or references:

| Binary/configuration | Model | Errors/tokens | Pooled WER | Median latency | Maximum latency |
|---|---|---:|---:|---:|---:|
| Installed 1.9.2 | tiny | 19/78 | 24.36% | 629 ms | 18,072 ms |
| Installed 1.9.2 | base | 10/78 | 12.82% | 1,038 ms | 1,099 ms |
| Local CPU 1.9.4 | tiny | 19/78 | 24.36% | 330 ms | 454 ms |
| Local CPU 1.9.4 | base | 10/78 | 12.82% | 589 ms | 860 ms |

These measurements include asset validation and process startup. The initial 1.9.2 outlier
is retained; repeated timings need independent cold/warm and load trials. The CPU build
removes that outlier in this experiment, not a universal latency guarantee. Base has fewer
errors in this tiny synthetic corpus and is slower/larger. No acoustic fairness, customer
satisfaction, physical interruption or production-provider selection follows from this table.
Final frozen-source reports and independent review are required before closing IMP-03.

### IMP-03 completed frozen-source evidence

27 deterministic tests plus five subtests pass. Architecture and security reviews approve
local commit. The final fake CLI, sanitized actual LiveKit 1.8.3 SDK lifecycle CLI and twelve
CPU whisper.cpp 1.9.4 audio runs pass. Five adapter/entry source hashes are identical before
and after execution. SDK start, force interrupt and close are real; no inference engine,
room media input or media output is connected. Physical silence remains unverified.

Final CPU timings on the same six WAVs are tiny median 230ms/max252ms and base median
391ms/max411ms, with unchanged 19/78 versus 10/78 errors. The preliminary table is retained
to expose timing variation and the original startup outlier. The isolated SDK full advisory
scan covers 88 packages with zero known findings; a separate current scan of CMake Python
4.4.3 finds zero. These scans do not certify native dependencies or acoustic quality.
Nine validators, lint and diff check pass. No production dependency/default changed.

### IMP-05 typed turn projection

Migration 0075 enrolls only the known 13-column turn shape and installs an UPDATE/DELETE
append-only guard absent from the portable predecessor. Authorized projection sets only
transcript_text and transcript_ciphertext to NULL and compares all eleven other fields
exactly. Normal insert and governed irreversible-deletion authority remain separate paths.
The v71 catalog checks are preserved and extended with exact trigger, version and shape.

Apply and independent verify require tenant/request/item/target, current inventory fingerprint,
nonnull matching lease/fencing tokens, live write generation and legal-hold authority. Session
GUCs alone grant nothing. Final verification reads the actual row and requires present identity
with both content fields NULL, even after a successful receipt. Existing transcript projections
and the financial/retrieval regressions remain supported. Full local PostgreSQL 0001-0075,
ten lineage tests and the database validator pass. Unknown schema, disabled guard, nullable
authority, metadata drift, restore, structural edits, holds and text/cipher/missing-row tamper
all have negative coverage. M6-04 is still incomplete; no canonical SQL/outbox or remote deletion
is claimed. SQL head is 75, capability bundle stays 73 and canonical readiness stays false.

Data and security reviewers approve the frozen IMP-05 patch. Lint, diff check and all nine
validators pass. No actual customer data or hosted schema was changed.

### IMP-04 integrated evidence

Validated implementation commit is `ef15716`. The final suite passes 2,119 Node tests without
skips and 63 Python unittest tests; independent pytest also passes 63. Typecheck/build,
contract drift, lint and nine validators pass. The full PostgreSQL 0001-0075 replay includes
older financial/retrieval cases and new turn projection negatives. Portal production build
at `87a1364` has identical app sources through `ef15716`; no rebuild-only source claim is made.

Current browser proof includes 14 public E2E tests in 48.4 seconds with axe checks for active
and closed demo at 1280/390 px. The manual Chrome pass starts the demo, opens all four surfaces,
advances, restarts and exits. Mobile viewport and document width both measure 390 px; captured
console warnings/errors are zero. These pages use synthetic state and explicit provider masks.
The previous audit's 17 authenticated browser cases were not rerun in this improvement cycle.
Neither browser pass invokes the new RAG RPC or proves a physical audiovisual conversation.

The real guarded Promptfoo CLI again passes all ten expected assertions. Root Node registry
metadata reports zero known vulnerabilities; isolated Promptfoo reports zero across 633 packages;
root Python checks 11 currently applicable packages with zero findings. The earlier current
SDK scan covers 88 packages with zero, and CMake packaging covers one with zero. Optional
SDK/model reports retain their evidence labels, fixed hashes and unpriced compute fields.
[Saved evidence](../../artifacts/closer-improvements-2026-10-01/README.md) contains bounded JSON,
source/build provenance and native JPEG screenshots, excluding raw audio, models and transcripts.

### Next measured product increments

The implemented foundations enable three experiments: receipt-driven conversion comparison,
permission-aware knowledge comparisons, and local transcription/SDK cancellation benchmarks.
The next closer-quality increment should connect the Portal receipt shape through an audited
adapter and collect consented human reviews on fixed PT/EN/ES conversations. Real-time latency,
physical interruption, acoustic variation and commercial outcomes need separate measurements.
No fake score or six synthetic utterances establishes superiority for real sales.

Before any hosted activation, verify current schema parity and execute the canonical M6-04
ledger/outbox work, external reconciliation and independent restore verification. Financial
operator reconciliation, historical append-only adjustment evidence and authenticated actor
revocation fences remain distinct backlog work. No production provider, migration or paid
external effect was selected or executed in this improvement cycle.

IMP-04 closes locally after independent architecture/evidence approval. The reviewer verifies
ten saved artifact hashes, five current realtime source hashes, recalculates WER/latency,
confirms Portal source parity and inspects both native browser screenshots. Full-suite and
registry counts are parent-executed evidence, not claimed as independently rerun by that
reviewer. The preexisting next-env development imports are restored exactly and remain
unstaged. This completes the authorized bounded improvement cycle, preserving all named
production and commercial dependencies.
