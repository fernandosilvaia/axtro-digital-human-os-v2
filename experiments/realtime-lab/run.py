#!/usr/bin/env python3
"""Explicit local benchmark. Reports contain metrics and asset hashes, not speech."""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
from pathlib import Path
import re
import tempfile
import time
import sys
import subprocess
import signal

from realtime_lab import ControlHarness, FakeRealtimeControl, GenerationAuthority, LabError, word_error_rate
from whisper_adapter import AudioRequest, WhisperAdapter, WhisperConfig

TENANT = "019f0000-0000-7000-8000-000000000003"
SESSION = "019f0000-0000-7000-8000-000000000004"
MAX_REPORT_BYTES = 100_000


def report_base(kind: str) -> dict:
    return {"schema_version": "1.0.0", "evidence_kind": kind,
            "productionPromotionAllowed": False, "requiresHumanReview": True,
            "physicalSilenceVerified": False, "cost": {"provider_requests": 0,
            "local_compute_usd": None, "pricing_status": "unpriced"}}


def load_fixtures(path: Path) -> list[dict]:
    if not path.is_absolute() or not path.is_file() or path.stat().st_size > 100_000:
        raise LabError("fixture_file_bound")
    try:
        value = json.loads(path.read_bytes())
    except (OSError, ValueError, RecursionError):
        raise LabError("invalid_fixtures") from None
    allowed = {"fixture_id", "language", "voice", "reference", "wav_path", "wav_sha256", "duration_seconds", "synthetic"}
    if not isinstance(value, list) or not 1 <= len(value) <= 12:
        raise LabError("fixture_count_bound")
    seen = set()
    for row in value:
        if not isinstance(row, dict) or set(row) - allowed or row.get("synthetic") is not True:
            raise LabError("synthetic_fixture_required")
        identity = row.get("fixture_id")
        if not isinstance(identity, str) or not re.fullmatch(r"(?:pt|en|es)-(?:eddy|standard)", identity) or identity in seen:
            raise LabError("invalid_fixture_identity")
        seen.add(identity)
        if row.get("language") != identity[:2] or not isinstance(row.get("reference"), str):
            raise LabError("invalid_fixture_language")
        word_error_rate(row["reference"], "")  # bound reference before dispatch
        if not isinstance(row.get("wav_path"), str) or not isinstance(row.get("wav_sha256"), str):
            raise LabError("invalid_fixture_audio")
        duration = row.get("duration_seconds")
        if type(duration) not in (int, float) or not math.isfinite(duration) or not 0.05 <= duration <= 60:
            raise LabError("invalid_fixture_duration")
    return value


async def whisper_benchmark(args) -> dict:
    for key in ("binary", "binary_sha256", "model", "model_sha256", "fixtures", "temp_root", "model_label"):
        if getattr(args, key) is None:
            raise LabError("explicit_assets_required")
    rows = load_fixtures(args.fixtures)
    authority = GenerationAuthority(TENANT, SESSION)
    config = WhisperConfig(args.binary, args.binary_sha256, args.model, args.model_sha256, args.temp_root,
                           threads=args.threads, timeout_seconds=args.timeout)
    adapter = WhisperAdapter(authority, config)
    output = report_base("synthetic_audio_local_model")
    output.update({"model_label": args.model_label, "model_sha256": args.model_sha256,
                   "binary_sha256": args.binary_sha256, "threads": args.threads,
                   "latency_includes_asset_validation_and_process_startup": True, "samples": []})
    try:
        for index, row in enumerate(rows, 1):
            scope = authority.begin(index)
            result = await adapter.transcribe(scope, AudioRequest(Path(row["wav_path"]), row["wav_sha256"], row["language"]), asyncio.Event())
            wer = word_error_rate(row["reference"], result.text)
            output["samples"].append({"fixture_id": row["fixture_id"], "language": result.language,
                "wav_sha256": row["wav_sha256"], "synthetic_audio": True,
                "elapsed_ms": round(result.elapsed_ms, 3), "audio_duration_ms": round(result.audio_duration_ms, 3),
                "real_time_factor": round(result.elapsed_ms/result.audio_duration_ms, 6), **wer})
    finally:
        authority.close()
        await adapter.close()
    if not adapter.cleanup_complete:
        raise LabError("cleanup_incomplete")
    output["cleanup_complete"] = True
    return output


async def fake_benchmark() -> dict:
    authority = GenerationAuthority(TENANT, SESSION)
    harness = ControlHarness(authority, FakeRealtimeControl())
    scope = authority.begin(1)
    start = time.monotonic()
    try:
        outcome = await harness.run(scope)
        authority.begin(2)
        from realtime_lab import OutputFrame
        denied = not harness.emit(OutputFrame(scope, "late"))
    finally:
        await harness.close()
    report = report_base("fake_control_only")
    report.update({"outcome": outcome, "accepted_marker_count": harness.accepted,
                   "late_marker_denied": denied, "elapsed_ms": round((time.monotonic()-start)*1000, 3),
                   "cleanup_complete": harness.cleanup_complete, "real_audio_evaluated": False})
    return report


async def sdk_smoke_local() -> dict:
    from livekit_adapter import SDK_VERSION, create_livekit_control
    authority = GenerationAuthority(TENANT, SESSION)
    port = create_livekit_control(authority)
    harness = ControlHarness(authority, port, control_timeout=0.5)
    scope = authority.begin(1)
    run = asyncio.create_task(harness.run(scope, timeout=10))
    try:
        await asyncio.wait_for(port.started.wait(), timeout=5)
        ack = await harness.cancel(scope)
        outcome = await run
    finally:
        await harness.close()
    report = report_base("sdk_lifecycle_only")
    report.update({"sdk_version": SDK_VERSION, "interrupt_processed": ack.processed,
                   "outcome": outcome, "cleanup_complete": harness.cleanup_complete,
                   "media_input_connected": False, "media_output_connected": False,
                   "inference_engines_configured": False, "real_audio_evaluated": False})
    if not ack.processed or not harness.cleanup_complete:
        raise LabError("sdk_smoke_failed")
    return report


def validate_sdk_report(report: object) -> dict:
    expected = report_base("sdk_lifecycle_only")
    expected.update({"sdk_version": "1.8.3", "interrupt_processed": True,
        "outcome": "cancelled", "cleanup_complete": True,
        "media_input_connected": False, "media_output_connected": False,
        "inference_engines_configured": False, "real_audio_evaluated": False})
    # Exact shape and primitive types deny invented media proof or raw content.
    if not isinstance(report, dict) or set(report) != set(expected):
        raise LabError("sdk_smoke_failed")
    for key, value in expected.items():
        actual = report[key]
        if isinstance(value, dict):
            if not isinstance(actual, dict) or set(actual) != set(value):
                raise LabError("sdk_smoke_failed")
            if any(type(actual[k]) is not type(v) or actual[k] != v for k, v in value.items()):
                raise LabError("sdk_smoke_failed")
        elif type(actual) is not type(value) or actual != value:
            raise LabError("sdk_smoke_failed")
    return report


def _run_sdk_child(interpreter: Path, child: Path) -> bytes:
    process = None
    # File-backed stdout bounds memory during execution. The fixed trusted
    # child emits one small report; its process group is always reaped.
    with tempfile.TemporaryFile() as output:
        try:
            process = subprocess.Popen([str(interpreter), "-I", str(child)], stdin=subprocess.DEVNULL,
                stdout=output, stderr=subprocess.DEVNULL, start_new_session=True,
                env={"PATH": "/usr/bin:/bin", "LANG": "C"})
            deadline = time.monotonic() + 15
            while process.poll() is None:
                if os.fstat(output.fileno()).st_size > MAX_REPORT_BYTES:
                    raise LabError("sdk_smoke_failed")
                if time.monotonic() >= deadline:
                    raise LabError("sdk_deadline_exceeded")
                time.sleep(0.01)
            if process.returncode != 0 or os.fstat(output.fileno()).st_size > MAX_REPORT_BYTES:
                raise LabError("sdk_smoke_failed")
            output.seek(0)
            return output.read(MAX_REPORT_BYTES+1)
        finally:
            if process is not None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=1)


def sdk_smoke_subprocess() -> dict:
    interpreter = Path(__file__).resolve().parent / ".venv" / "bin" / "python"
    child = Path(__file__).resolve().parent / "sdk_smoke_child.py"
    if not interpreter.is_file():
        raise LabError("optional_sdk_not_installed")
    # -I excludes PYTHONPATH/user site; keys/proxies/OTEL/HOME are absent
    # before optional SDK import. No room or inference engine is configured.
    raw = _run_sdk_child(interpreter, child)
    try:
        report = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise LabError("sdk_smoke_failed") from None
    return validate_sdk_report(report)


def write_report(path: Path, report: dict) -> None:
    raw = (json.dumps(report, ensure_ascii=True, sort_keys=True, indent=2, allow_nan=False)+"\n").encode()
    if len(raw) > MAX_REPORT_BYTES or not path.is_absolute() or not path.parent.is_dir():
        raise LabError("report_output_bound")
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix="realtime-report-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(raw)
            stream.flush()
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["fake", "whisper", "sdk-smoke"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path)
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--binary-sha256")
    parser.add_argument("--model", type=Path)
    parser.add_argument("--model-sha256")
    parser.add_argument("--model-label", choices=["tiny", "base"])
    parser.add_argument("--temp-root", type=Path)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()
    try:
        report = sdk_smoke_subprocess() if args.mode=="sdk-smoke" else asyncio.run(whisper_benchmark(args) if args.mode=="whisper" else fake_benchmark())
        write_report(args.output, report)
        print(json.dumps({"status": "completed", "evidence_kind": report["evidence_kind"], "productionPromotionAllowed": False}))
        return 0
    except LabError as error:
        print(json.dumps({"status": "failed", "code": error.code, "productionPromotionAllowed": False}))
        return 1
    except Exception:
        print(json.dumps({"status": "failed", "code": "internal_failure", "productionPromotionAllowed": False}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
