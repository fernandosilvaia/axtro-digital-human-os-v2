"""Explicit, local whisper.cpp port. No shell, downloads or credential discovery."""
from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import signal
import tempfile
import time
import wave
from dataclasses import dataclass

from realtime_lab import GenerationAuthority, GenerationScope, LabError, TranscriptSegment, Transcription

SHA = re.compile(r"^[0-9a-f]{64}$")
LANGUAGES = frozenset({"pt", "en", "es"})
MAX_JSON_BYTES = 1_000_000


@dataclass(frozen=True)
class AudioRequest:
    wav_path: Path
    wav_sha256: str
    language: str


@dataclass(frozen=True)
class WhisperConfig:
    binary_path: Path
    binary_sha256: str
    model_path: Path
    model_sha256: str
    temp_root: Path
    threads: int = 2
    timeout_seconds: float = 30.0
    model_min_bytes: int = 1_000_000
    model_max_bytes: int = 1_000_000_000


def verified_file(path: Path, digest: str, *, minimum: int, maximum: int) -> Path:
    if not isinstance(path, Path) or not path.is_absolute() or not isinstance(digest, str) or not SHA.fullmatch(digest):
        raise LabError("invalid_asset_configuration")
    try:
        resolved = path.resolve(strict=True)
        size = resolved.stat().st_size
        if not resolved.is_file() or not minimum <= size <= maximum:
            raise LabError("asset_size_bound")
        hasher = hashlib.sha256()
        with resolved.open("rb") as stream:
            for chunk in iter(lambda: stream.read(65536), b""):
                hasher.update(chunk)
        if hasher.hexdigest() != digest:
            raise LabError("asset_hash_mismatch")
        return resolved
    except OSError:
        raise LabError("asset_unavailable") from None


def parse_transcription(value: object, language: str, duration_ms: int) -> tuple[TranscriptSegment, ...]:
    if not isinstance(value, dict) or not isinstance(value.get("result"), dict) or value["result"].get("language") != language:
        raise LabError("malformed_transcription")
    raw = value.get("transcription")
    if not isinstance(raw, list) or not 1 <= len(raw) <= 256:
        raise LabError("malformed_transcription")
    segments: list[TranscriptSegment] = []
    previous_end = 0
    total_bytes = 0
    for item in raw:
        if not isinstance(item, dict) or not isinstance(item.get("offsets"), dict):
            raise LabError("malformed_transcription")
        text = item.get("text")
        start, end = item["offsets"].get("from"), item["offsets"].get("to")
        if type(start) is not int or type(end) is not int or not previous_end <= start <= end <= duration_ms + 1000:
            raise LabError("transcription_offset_bound")
        try:
            byte_count = len(text.encode("utf-8")) if isinstance(text, str) else 20001
        except UnicodeEncodeError:
            raise LabError("transcription_text_bound") from None
        if not isinstance(text, str) or not text.strip() or byte_count > 20000:
            raise LabError("transcription_text_bound")
        total_bytes += byte_count
        if total_bytes > 40000:
            raise LabError("transcription_text_bound")
        segments.append(TranscriptSegment(start, end, text.strip()))
        previous_end = end
    return tuple(segments)


class WhisperAdapter:
    def __init__(self, authority: GenerationAuthority, config: WhisperConfig):
        if type(config.threads) is not int or not 1 <= config.threads <= 8:
            raise LabError("invalid_threads")
        if not math.isfinite(config.timeout_seconds) or not 0.01 <= config.timeout_seconds <= 120:
            raise LabError("invalid_deadline")
        if not (type(config.model_min_bytes) is int and type(config.model_max_bytes) is int
                and 1 <= config.model_min_bytes <= config.model_max_bytes <= 1_000_000_000):
            raise LabError("invalid_model_bound")
        if not isinstance(config.temp_root, Path) or not config.temp_root.is_absolute():
            raise LabError("invalid_temp_root")
        self.authority, self.config = authority, config
        self._process: asyncio.subprocess.Process | None = None
        self.closed = False
        self.cleanup_complete = True
        self._operation: object | None = None
        self._operation_scope: GenerationScope | None = None
        self._spawn_task: asyncio.Task | None = None

    async def _kill_and_reap(self, process: asyncio.subprocess.Process) -> None:
        # Children may still own this group after the parent has exited.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        waiter = asyncio.create_task(process.wait())
        done, _pending = await asyncio.wait({waiter}, timeout=1.0)
        if not done:
            self.cleanup_complete = False
            waiter.cancel()
        else:
            try:
                waiter.result()
            except (Exception, asyncio.CancelledError):
                self.cleanup_complete = False

    async def _watch_output(self, path: Path) -> None:
        while True:
            if path.exists() and (path.is_symlink() or path.stat().st_size > MAX_JSON_BYTES):
                raise LabError("json_size_bound")
            await asyncio.sleep(0.01)

    async def transcribe(self, scope: GenerationScope, request: AudioRequest, cancelled: asyncio.Event) -> Transcription:
        if self.closed or not self.cleanup_complete or self._operation is not None or not self.authority.permits(scope) or cancelled.is_set():
            raise LabError("stale_or_cancelled")
        token = object()
        self._operation, self._operation_scope = token, scope
        try:
            return await self._transcribe_owned(scope, request, cancelled)
        finally:
            if self._operation is token:
                self._operation = self._operation_scope = None

    async def _transcribe_owned(self, scope: GenerationScope, request: AudioRequest, cancelled: asyncio.Event) -> Transcription:
        if self.closed or self._process is not None or not self.authority.permits(scope) or cancelled.is_set():
            raise LabError("stale_or_cancelled")
        if not isinstance(request.language, str) or request.language not in LANGUAGES:
            raise LabError("invalid_language")
        start = time.monotonic()
        config = self.config
        binary = verified_file(config.binary_path, config.binary_sha256, minimum=1, maximum=100_000_000)
        model = verified_file(config.model_path, config.model_sha256, minimum=config.model_min_bytes, maximum=config.model_max_bytes)
        wav = verified_file(request.wav_path, request.wav_sha256, minimum=44, maximum=2_000_000)
        if not os.access(binary, os.X_OK):
            raise LabError("binary_not_executable")
        try:
            with wave.open(str(wav), "rb") as audio:
                if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or audio.getframerate() != 16000 or audio.getcomptype() != "NONE":
                    raise LabError("invalid_wav_format")
                frames = audio.getnframes()
                if not 800 <= frames <= 960000:
                    raise LabError("audio_duration_bound")
                pcm = audio.readframes(frames)
                if len(pcm) != frames * 2:
                    raise LabError("truncated_wav")
        except (OSError, wave.Error, EOFError):
            raise LabError("invalid_wav_format") from None
        if self.closed or not self.authority.permits(scope) or cancelled.is_set():
            raise LabError("stale_or_cancelled")
        remaining = config.timeout_seconds - (time.monotonic() - start)
        if remaining <= 0:
            raise LabError("deadline_exceeded")
        process = None
        waiter = cancel_waiter = output_watcher = None
        # Tenant/session scoped private temporary output; even failure removes it.
        with tempfile.TemporaryDirectory(prefix=f"whisper-{scope.tenant_id}-{scope.session_id}-", dir=config.temp_root) as directory:
            staged = Path(directory) / "input.wav"
            with wave.open(str(staged), "wb") as target:
                target.setnchannels(1); target.setsampwidth(2); target.setframerate(16000); target.writeframes(pcm)
            output = Path(directory) / "transcript"
            argv = [str(binary), "-m", str(model), "-f", str(staged), "-l", request.language,
                    "-oj", "-of", str(output), "-np", "-t", str(config.threads), "-ng", "-nf"]
            try:
                def limit_output():
                    resource.setrlimit(resource.RLIMIT_FSIZE, (64_000_000, 64_000_000))
                self._spawn_task = asyncio.create_task(asyncio.create_subprocess_exec(*argv, stdin=asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                    env={"PATH": "/usr/bin:/bin", "LANG": "C", "OMP_NUM_THREADS": str(config.threads)},
                    start_new_session=True, preexec_fn=limit_output))
                done, _pending = await asyncio.wait({self._spawn_task},
                    timeout=max(0, config.timeout_seconds-(time.monotonic()-start)))
                if not done:
                    self.authority.cancel(scope)
                    raise LabError("deadline_exceeded")
                process = self._spawn_task.result()
                self._process = process
                if self.closed or not self.authority.permits(scope) or cancelled.is_set():
                    raise LabError("stale_or_cancelled")
                waiter = asyncio.create_task(process.wait())
                cancel_waiter = asyncio.create_task(cancelled.wait())
                output_watcher = asyncio.create_task(self._watch_output(output.with_suffix(".json")))
                done, _pending = await asyncio.wait({waiter, cancel_waiter, output_watcher},
                    timeout=max(0, config.timeout_seconds-(time.monotonic()-start)), return_when=asyncio.FIRST_COMPLETED)
                if not done:
                    raise LabError("deadline_exceeded")
                if output_watcher in done:
                    output_watcher.result()
                if self.closed or cancel_waiter in done or not self.authority.permits(scope):
                    raise LabError("stale_or_cancelled")
                if process.returncode != 0:
                    if output.with_suffix(".json").exists() and output.with_suffix(".json").stat().st_size > MAX_JSON_BYTES:
                        raise LabError("json_size_bound")
                    raise LabError("process_failure")
                path = output.with_suffix(".json")
                if not path.is_file() or path.is_symlink() or path.stat().st_size > MAX_JSON_BYTES:
                    raise LabError("json_size_bound")
                raw = path.read_bytes()
                if len(raw) > MAX_JSON_BYTES:
                    raise LabError("json_size_bound")
                try:
                    parsed = json.loads(raw)
                except (UnicodeDecodeError, ValueError, RecursionError):
                    raise LabError("malformed_json") from None
                segments = parse_transcription(parsed, request.language, math.ceil(frames / 16))
                if self.closed or not self.authority.permits(scope) or cancelled.is_set():
                    raise LabError("stale_or_cancelled")
                return Transcription(request.language, segments, (time.monotonic()-start)*1000, "local_model_audio", frames / 16)
            except asyncio.CancelledError:
                self.authority.cancel(scope)
                raise
            except OSError:
                raise LabError("process_unavailable") from None
            finally:
                # A cancellation can arrive while spawn is returning its handle.
                # Shield that owned future and reap its eventual process too.
                if process is None and self._spawn_task is not None:
                    done, _pending = await asyncio.wait({self._spawn_task}, timeout=1.0)
                    if done:
                        try:
                            process = self._spawn_task.result()
                        except (Exception, asyncio.CancelledError):
                            pass
                    else:
                        self.cleanup_complete = False
                        async def late_reap(spawn):
                            try:
                                await self._kill_and_reap(await spawn)
                            except (Exception, asyncio.CancelledError):
                                pass
                        # Keep the owned cleanup observable until it settles.
                        self._late_cleanup = asyncio.create_task(late_reap(self._spawn_task))
                if process is not None:
                    await self._kill_and_reap(process)
                self._process = None
                self._spawn_task = None
                for task in (waiter, cancel_waiter, output_watcher):
                    if task is not None and not task.done():
                        task.cancel()
                helpers = {task for task in (waiter, cancel_waiter, output_watcher) if task is not None}
                if helpers:
                    done, pending = await asyncio.wait(helpers, timeout=1.0)
                    if pending:
                        self.cleanup_complete = False
                    for task in done:
                        try:
                            task.result()
                        except (Exception, asyncio.CancelledError):
                            pass

    async def interrupt(self, scope: GenerationScope):
        from realtime_lab import InterruptAck
        if self._operation_scope is not scope:
            return InterruptAck(False)
        self.authority.cancel(scope)
        if self._process is not None:
            await self._kill_and_reap(self._process)
        return InterruptAck(True)

    async def close(self) -> None:
        self.closed = True
        if self._operation_scope is not None:
            self.authority.cancel(self._operation_scope)
        if self._process is not None:
            await self._kill_and_reap(self._process)
        if self._spawn_task is not None:
            done, _pending = await asyncio.wait({self._spawn_task}, timeout=1.0)
            if done:
                try:
                    await self._kill_and_reap(self._spawn_task.result())
                except (Exception, asyncio.CancelledError):
                    self.cleanup_complete = False
            else:
                self.cleanup_complete = False
        late = getattr(self, "_late_cleanup", None)
        if late is not None and not late.done():
            await asyncio.wait({late}, timeout=1.0)


class FakeWhisperAdapter:
    def __init__(self, authority: GenerationAuthority, text: str = "synthetic transcription"):
        self.authority, self.text = authority, text
        self.closed = False

    async def transcribe(self, scope: GenerationScope, request: AudioRequest, cancelled: asyncio.Event) -> Transcription:
        if self.closed or not self.authority.permits(scope) or cancelled.is_set():
            raise LabError("stale_or_cancelled")
        if not isinstance(request.language, str) or request.language not in LANGUAGES:
            raise LabError("invalid_language")
        return Transcription(request.language, (TranscriptSegment(0, 100, self.text),), 0.0, "fake_control")

    async def interrupt(self, scope: GenerationScope):
        from realtime_lab import InterruptAck
        return InterruptAck(self.authority.cancel(scope))

    async def close(self) -> None:
        self.closed = True
