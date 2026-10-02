# Closer evidence lab

IMP-01 and ADR-049. This is an executable synthetic regression lab. It does not
call a closer model, grade natural conversation quality or authorize promotion.
It is outside the pnpm workspace and outside the synchronous audio path.

Run the default report without installing optional tooling:

```sh
pnpm quality:closer
node --test tests/golden/*.test.mjs
```

`quality:closer` builds existing workspace packages, then prints deterministic
JSON matching `report.schema.json`. The corpus intentionally contains missing
disclosure, late consent, cross-tenant and ambiguous-effect negatives. Its
aggregate decision is blocked. Exit zero means report generation succeeded,
not that a candidate passed a promotion gate. Promptfoo separately asserts
the expected block or human-review result for each of ten fixed scenarios.
No raw result, subject reference, checkout URL, transcript or tenant/session
identifier is included in the report.

The read-only canonical projection joins ActionIntent and ToolExecutionReceipt
by tenant, session and intent, checks the exact recognized tool/action pairing,
success semantics, chronology, result shape and canonical effect hash. It
distinguishes lead registration, dispatched meeting and created checkout link.
Reservation, pending approval, provider ambiguity and model completion claims
cannot establish these effects. Payment confirmation has no canonical tool
result producer here and stays unavailable. No checkout result proves payment.

Disclosure and subject/purpose-specific consent use canonical records and
version/chronology checks. An evaluation annotation is never their authority.
Later revocation/expiry conservatively removes current consent authority. The
projection is not a historical audit of whether past effects were lawful.
Duplicate records replay idempotently; conflicting identities fail closed.
Inputs must be supplied by authenticated canonical storage. Structural shape
and a hash do not authenticate arbitrary model-created receipts. Current Portal
business-action bridge receipts use another shape and have no consumer or
adapter wired to this projection. Production funnel/dashboard integration is
still a separate governed task.

Comparisons require identical scenario expectations, tenant/session/subject,
reference clock, disclosure/consent proofs, locale and evaluator version.
Executions can differ across version candidates. Critical violations,
regressions and unresolved effects block the candidate. Human review is always
required. The lab explicitly uses evaluator 2.0.0: naturalness is unmeasured and
excluded from its five-dimension numerical mean. Historical evaluator major 0/1
retains the legacy six-dimension mean for reproducibility, including its human
review marker. This legacy average is not a new measured quality claim. Existing
result fields remain available, but malformed results and non-finite scores or
costs no longer cross the pilot gate. Different evaluator versions are rejected
within a candidate comparison; advancing the algorithm requires an explicit
version change and re-evaluation, without rewriting historical results.

## Optional Promptfoo integration

Tooling is isolated development-only and exact-pinned in this directory. The
evaluated latest Promptfoo 0.123.1 was rejected because full registry audit
reported unpatched node-forge `GHSA-86w9-cpqp-85rv` through jks-js. Promptfoo
0.116.7 (MIT) supports our custom ESM provider, with patched transitive pins:

| Dependency | Exact version | Reason |
| --- | --- | --- |
| basic-ftp | 6.2.1 | Directory parser CPU denial of service through 6.2.0 |
| drizzle-orm | 0.45.2 | Identifier escaping SQL injection |
| mathjs | 15.2.0 | Unsafe object property setters |
| sharp | 0.35.5 | libvips/libheif advisories |
| tmp | 0.2.7 | Path traversal, including bypass in 0.2.6 |
| csv-parse | 7.0.2 | Prototype replacement via columns |
| fast-xml-parser | 5.7.0 | XML comment/CDATA injection |
| uuid | 11.1.1 | Buffer bounds checks |
| better-sqlite3 | 13.0.3 | Native Node 26 compatibility, MIT |

Compatibility evidence covers only the local custom provider and structural
assertions used here. These overrides do not establish compatibility of the
unused cloud, database, image or model providers. Full local registry audit on
2026-10-01 found zero advisories across the final 633-package isolated tree.
Future installation must rerun the live audit, without advisory suppressions.

```sh
cd experiments/closer-lab
npm ci --ignore-scripts --no-fund --no-audit
npm audit --audit-level=high
```

The default tests and app build do not need this tree. Do not enable all npm
lifecycle scripts. The explicit smoke additionally requires only the SQLite
native addon compiled from the pinned source with local Node headers and an
existing node-gyp/compiler. On the audited macOS/Homebrew host, the command was:

```sh
cd node_modules/better-sqlite3
node /opt/homebrew/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --release --force_build=1 --nodedir=/opt/homebrew --jobs=2
cp build/Release/better_sqlite3.node prebuilds/darwin-arm64.node
cd ../../../..
node experiments/closer-lab/run.mjs --promptfoo
```

Other hosts must supply their own existing node-gyp path, local Node header
directory and platform/architecture filename. No headers or native binaries
are downloaded by this build command. The reviewed binding.gyp compiles bundled
SQLite and node-addon-api; no package lifecycle script is invoked. The earlier
better-sqlite3 11.10.0 source failed on Node 26 V8 API changes and was rejected.
Version 13.0.3 prefers its packaged prebuild, so the local build must replace
that exact host file, or the packaged host file must be removed. The smoke
refuses a missing local Release build or a differing packaged binary.

The actual successful smoke ran Node 26.10.0, Promptfoo 0.116.7 and ten assertions,
with `eval --config promptfooconfig.js --no-cache --no-write --no-table
--no-progress-bar --max-concurrency 1 --output <temporary JSON>`. This older CLI
does not support `--no-share`; `sharing:false` plus
`PROMPTFOO_DISABLE_SHARING=1` enforce its supported equivalent. Temporary CLI
database/config/output files are removed afterward; only the content-free
comparison artifact is printed. The child receives an explicit environment
allowlist, telemetry/update/remote-generation disable flags, and no provider,
proxy, NODE_OPTIONS or cloud credentials.

Promptfoo 0.116.7 still attempts one best-effort "telemetry disabled" event even
with its telemetry flag set. The preload rejects fetch without dispatch, so
that attempt is caught by upstream and sends no request. The preload also denies
common Node HTTP/TCP/TLS/UDP/HTTP2/DNS paths, subprocesses and workers, with direct
and promise/resolver regression tests. This is defense for fixed trusted tooling,
not an OS sandbox or a guarantee for arbitrary native code. No external provider
is configured. ESM `.js` files avoid the older loader's `.mjs` tsx subprocess and
worker transformation. The CLI has a 60-second deadline and bounded output;
provider failures, mismatch, timeout or failed assertions return a failure.

Official sources: [Promptfoo](https://github.com/promptfoo/promptfoo),
[0.116.7 package](https://github.com/promptfoo/promptfoo/blob/0.116.7/package.json),
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3),
[node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
