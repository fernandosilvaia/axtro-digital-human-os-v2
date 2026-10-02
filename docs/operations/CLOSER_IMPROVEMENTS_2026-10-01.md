# Closer improvements, 2026-10-01

Status: local implementation in progress after audit baseline `72ab1e9`.

The owner authorized IMP-01 through IMP-05. ADR-049 defines reversible boundaries.
M6-04 remains in progress. Experiments do not select or activate a production provider.

## Execution

| Task | State | Evidence |
|---|---|---|
| IMP-01 receipt-based closer lab and Promptfoo | done | 105 goldens; real CLI 10 assertions; full isolated audit 0/633; independent architecture/security approval |
| IMP-02 pgvector hybrid retrieval | pending | pending |
| IMP-03 LiveKit and whisper.cpp lab | pending | pending |
| IMP-05 typed turn redaction | pending | pending |
| IMP-04 integrated review | pending | pending |

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
