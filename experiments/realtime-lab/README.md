# Local realtime lab (IMP-03)

This opt-in development experiment has no Portal consumer or production media connection. It preserves tenant/session identity and monotonically increasing generation authority, fences publication before cancellation callbacks, bounds marker queues, and fails closed after incomplete adapter or process cleanup. Axtro Agent and the evaluator stay outside the synchronous audio loop.

The evidence types are deliberately separate:

* `fake_control_only` tests marker transport, authority, deadlines and cleanup. It measures no speech or physical media.
* `sdk_lifecycle_only` starts the actual LiveKit Agents session locally, processes `interrupt(force=True)` and closes it. All inference engines and VAD are explicitly `None`, turn detection is manual, and preemptive generation is disabled. No room, STT/LLM/TTS string, inference request, model prewarm or download is configured. An SDK interruption acknowledgement does not prove physical silence.
* `synthetic_audio_local_model` invokes an explicitly supplied whisper.cpp executable and model against synthetic WAV files. WER can exceed 1 because insertions are not clamped. These small fixtures do not establish real customer transcription quality or provider selection.

Every report denies production promotion, requires human review, and records local compute as unpriced rather than free. Reports omit transcript text, references, voices, asset paths and raw vendor JSON. Errors use fixed codes without exception messages. Input fixture metadata is trusted local experiment configuration, not runtime customer input.

## Optional SDK

LiveKit Agents **1.8.3**, Apache-2.0, and pip-audit **2.10.1** are isolated in this directory's manifest and `uv.lock`. Root tests do not install or import this SDK. Run with an existing Python 3.11 to 3.13 interpreter:

```sh
UV_PYTHON_DOWNLOADS=never uv sync --project experiments/realtime-lab --python .venv/bin/python --group audit
experiments/realtime-lab/.venv/bin/pip-audit
python3 experiments/realtime-lab/run.py --mode sdk-smoke --output /tmp/realtime-sdk.json
```

The SDK entry launches its own isolated interpreter with `-I` and an allowlisted environment containing only `PATH` and `LANG`, before SDK import. Output is monitored with a 100 KB cap and 15 second deadline; the process group is killed and reaped on every exit. The report is an exact closed shape and cannot assert media proof. This is a defense for fixed trusted local tooling, not an OS sandbox or permission to run arbitrary third-party code.

## Local whisper.cpp

whisper.cpp is MIT licensed. No executable, model or audio is shipped here; all assets must already exist, have absolute paths, and match explicit SHA-256 values. Runtime never downloads them. The adapter validates PCM16 mono 16 kHz WAV, 0.05 to 60 seconds, input/model/file bounds, `pt`/`en`/`es`, transcription offsets and bounded text. It stages audio in a private tenant/session directory and deletes that directory on success or failure.

Arguments are fixed: `-m MODEL -f WAV -l LANGUAGE -oj -of OUTPUT -np -t THREADS -ng -nf`. There is no shell. Credentials, proxies and host Python configuration are absent from the child environment. Stdio goes to DEVNULL. JSON is monitored during execution and bounded at 1 MB before parsing. A separate 64 MB per-file child resource limit permits trusted backend compiler scratch; the installed 1.9.2 Metal backend can compile at startup even with `-ng`. This scratch limit is distinct from the JSON limit. Timeout includes asset validation and process startup, with no retry; asynchronous spawn and reaping also have explicit bounds. Unresolved cleanup denies further admission and prevents a successful audio report.

```sh
python3 experiments/realtime-lab/run.py --mode whisper \
  --fixtures /absolute/synthetic-fixtures.json \
  --binary /absolute/whisper-cli --binary-sha256 VERIFIED_SHA256 \
  --model /absolute/ggml-tiny.bin --model-sha256 VERIFIED_SHA256 \
  --model-label tiny --temp-root /absolute/private-temp \
  --output /absolute/realtime-tiny-report.json
```

Fixture files contain 1 to 12 closed rows: `fixture_id` (`pt|en|es` plus `-eddy|-standard`), `language`, optional `voice`, `reference`, `wav_path`, `wav_sha256`, `duration_seconds`, `synthetic:true`. Audio duration and real-time factor come from validated WAV frames, not the manifest's claimed duration. Serial execution retains the first cold-start observation and includes asset verification/startup in elapsed time. Full utterance processing latency is not end-of-turn latency.

The local measured executables are Homebrew whisper.cpp 1.9.2 and an opt-in CPU-static 1.9.4 build from upstream commit `927cfce34f31707e17f2bff35c349632fb9e2c3a`. The latter avoids dynamic Metal backend startup in this machine's experiment. Its build provenance, binary hashes, model hashes, fixture assets and measured comparisons are kept in ignored local artifacts by the parent task. Neither executable is a production default.

## Deterministic verification

```sh
python3 -m unittest discover -s tests/python -p 'test_realtime_lab*.py'
python3 experiments/realtime-lab/run.py --mode fake --output /tmp/realtime-fake.json
```

Control callbacks have a maximum 0.5 second per-wait budget: composed cancellation is at most 1.5 seconds and close at most 2 seconds. Uncooperative callbacks are reported as incomplete cleanup. Generation cancellation never resets the monotonic generation counter. A fake has the same typed port shape as its actual adapter, while its evidence label remains distinct.
