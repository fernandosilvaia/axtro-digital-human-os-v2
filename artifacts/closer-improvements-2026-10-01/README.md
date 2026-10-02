# Closer improvements local evidence

Validated implementation: `ef15716`. Documentation completion commits do not change the
implementation. `validation.json` separates automated tests, the synthetic browser demo,
real SDK lifecycle and real transcription against synthetic audio. No deployment, hosted
migration, customer deletion, commercial validation or production promotion is claimed.

- `closer-report.json` and `promptfoo-smoke-report.json`: intentional negative scenarios,
  aggregate blocked. Ten real optional CLI assertions match expected outcomes.
- `final-sdk-smoke.json`: actual LiveKit lifecycle, without room media or inference.
- `final-cpu-v1.9.4-{tiny,base}.json`: six synthetic PT/EN/ES samples per model, metrics and
  asset hashes only. CPU compute is unpriced. Assets are not distributed in this folder.
- `final-source-evidence.json`: frozen adapter source hashes, independently matched again.
- `native-build-provenance.json`: official pinned source/build, ignored local binary path.
- `manual-{mobile,closed}.jpg`: native JPEG captures from the current local production
  Portal build, with synthetic product data. The closed capture shows desktop after exit;
  mobile tested at 390 px without overflow.

Run commands and optional asset requirements live in the two experiment READMEs. SQL
0001-0075 passed with historical checksums, grant/RLS, financial, retrieval and governed
redaction regressions. Advisory evidence is a dated registry lookup, not a native-toolchain
certificate. Root Python checked 11 applicable packages; platform-conditional rows are not
counted as installed packages. Capability bundle 73 and canonical readiness false remain.
