"""Bounded stdlib control fixtures. No production audio loop or SDK imports."""
from __future__ import annotations

import asyncio
import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Callable, Protocol

UUID7 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class LabError(Exception):
    """Closed code only; never leak a provider transcript or stderr."""
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, eq=False)
class GenerationScope:
    tenant_id: str
    session_id: str
    generation: int
    authority_epoch: int


class GenerationAuthority:
    def __init__(self, tenant_id: str, session_id: str):
        if not UUID7.fullmatch(tenant_id) or not UUID7.fullmatch(session_id):
            raise LabError("invalid_scope")
        self.tenant_id, self.session_id = tenant_id, session_id
        self._epoch = 0
        self._last_generation = 0
        self._scope: GenerationScope | None = None
        self._closed = False

    def begin(self, generation: int) -> GenerationScope:
        if self._closed or type(generation) is not int or not 1 <= generation <= 2**53 - 1:
            raise LabError("invalid_generation")
        if generation <= self._last_generation:
            raise LabError("non_monotonic_generation")
        self._epoch += 1
        self._last_generation = generation
        self._scope = GenerationScope(self.tenant_id, self.session_id, generation, self._epoch)
        return self._scope

    def permits(self, scope: GenerationScope) -> bool:
        # Object identity is the lab capability; caller-invented matching fields
        # cannot mint publication authority. This is not a new domain contract.
        return not self._closed and self._scope is scope

    def cancel(self, scope: GenerationScope) -> bool:
        if not self.permits(scope):
            return False
        self._epoch += 1
        self._scope = None
        return True

    def close(self) -> None:
        self._closed = True
        self._epoch += 1
        self._scope = None


@dataclass(frozen=True)
class OutputFrame:
    scope: GenerationScope
    marker: str


@dataclass(frozen=True)
class InterruptAck:
    processed: bool
    physical_silence_verified: bool = False


class RealtimeControlPort(Protocol):
    async def stream(self, scope: GenerationScope, emit: Callable[[OutputFrame], bool], cancelled: asyncio.Event) -> None: ...
    async def interrupt(self, scope: GenerationScope) -> InterruptAck: ...
    async def close(self) -> None: ...


class FakeRealtimeControl:
    """Marker transport fake; timing and cancellation are not media evidence."""
    def __init__(self, markers: tuple[str, ...] = ("first", "last"), *, wait: asyncio.Event | None = None, fail: bool = False):
        self.markers, self.wait, self.fail = markers, wait, fail
        self.closed = False
        self.started = asyncio.Event()

    async def stream(self, scope: GenerationScope, emit: Callable[[OutputFrame], bool], cancelled: asyncio.Event) -> None:
        self.started.set()
        if self.wait is not None:
            await self.wait.wait()
        for marker in self.markers:
            if cancelled.is_set():
                return
            if not emit(OutputFrame(scope, marker)):
                return
            await asyncio.sleep(0)
        if self.fail:
            raise LabError("adapter_failure")

    async def interrupt(self, scope: GenerationScope) -> InterruptAck:
        return InterruptAck(True)

    async def close(self) -> None:
        self.closed = True


class ControlHarness:
    def __init__(self, authority: GenerationAuthority, port: RealtimeControlPort, *, queue_limit: int = 8, control_timeout: float = 0.25):
        if type(queue_limit) is not int or not 1 <= queue_limit <= 64:
            raise LabError("invalid_queue_bound")
        if not math.isfinite(control_timeout) or not 0.001 <= control_timeout <= 0.5:
            raise LabError("invalid_deadline")
        self.authority, self.port = authority, port
        self.queue: asyncio.Queue[OutputFrame] = asyncio.Queue(queue_limit)
        self.control_timeout = control_timeout
        self.cancelled = asyncio.Event()
        self.task: asyncio.Task[None] | None = None
        self.scope: GenerationScope | None = None
        self.accepted = self.stale_denied = self.overflow_denied = 0
        self.cleanup_complete = True
        self._closed = False

    def emit(self, frame: OutputFrame) -> bool:
        if self._closed or not self.cleanup_complete or not isinstance(frame, OutputFrame) or self.scope is not frame.scope or self.cancelled.is_set() or not self.authority.permits(frame.scope):
            self.stale_denied += 1
            return False
        if not isinstance(frame.marker, str) or not re.fullmatch(r"[a-z0-9_.-]{1,64}", frame.marker):
            self.authority.cancel(frame.scope)
            self.cancelled.set()
            return False
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            self.overflow_denied += 1
            self.authority.cancel(frame.scope)
            self.cancelled.set()
            self._clear_queue()
            return False
        self.accepted += 1
        return True

    def take(self) -> OutputFrame | None:
        while not self.queue.empty():
            frame = self.queue.get_nowait()
            if self.authority.permits(frame.scope) and not self._closed:
                return frame
            self.stale_denied += 1
        return None

    def _clear_queue(self) -> None:
        while not self.queue.empty():
            self.queue.get_nowait()

    async def _settle(self, task: asyncio.Task, *, cleanup: bool = False) -> bool:
        done, _pending = await asyncio.wait({task}, timeout=self.control_timeout)
        if not done:
            task.cancel()
            done, _pending = await asyncio.wait({task}, timeout=self.control_timeout)
        if done:
            # Consume errors, including CancelledError, without raw logging.
            try:
                task.result()
            except asyncio.CancelledError:
                if cleanup:
                    self.cleanup_complete = False
                    return False
            except Exception:
                if cleanup:
                    self.cleanup_complete = False
                    return False
            return True
        self.cleanup_complete = False
        return False

    async def cancel(self, scope: GenerationScope) -> InterruptAck:
        # Fence before awaiting ANY adapter callback. Old cancellation cannot
        # interrupt a newer generation or empty its queued output.
        if self.scope is not scope:
            return InterruptAck(False)
        self.authority.cancel(scope)
        self.cancelled.set()
        self._clear_queue()
        if self.task is not None:
            self.task.cancel()
        task = asyncio.create_task(self.port.interrupt(scope))
        done, _pending = await asyncio.wait({task}, timeout=self.control_timeout)
        if not done:
            await self._settle(task)
            return InterruptAck(False)
        try:
            ack = task.result()
            return ack if isinstance(ack, InterruptAck) and type(ack.processed) is bool and ack.physical_silence_verified is False else InterruptAck(False)
        except BaseException:
            return InterruptAck(False)

    async def run(self, scope: GenerationScope, *, timeout: float = 2.0) -> str:
        if self._closed or not self.cleanup_complete or not self.authority.permits(scope):
            return "stale_denied"
        if not math.isfinite(timeout) or not 0.001 <= timeout <= 120:
            raise LabError("invalid_deadline")
        if self.task is not None and not self.task.done():
            raise LabError("generation_already_running")
        overflow_at_start = self.overflow_denied
        self._clear_queue()
        self.scope, self.cancelled = scope, asyncio.Event()
        self.task = asyncio.create_task(self.port.stream(scope, self.emit, self.cancelled))
        try:
            done, _pending = await asyncio.wait({self.task}, timeout=timeout)
            if not done:
                await self.cancel(scope)
                await self._settle(self.task)
                return "deadline_exceeded"
            try:
                self.task.result()
            except asyncio.CancelledError:
                return "cancelled"
            except Exception:
                await self.cancel(scope)
                return "adapter_failure"
            return "backpressure_denied" if self.overflow_denied > overflow_at_start else ("cancelled" if self.cancelled.is_set() else "completed")
        except asyncio.CancelledError:
            await self.cancel(scope)
            await self._settle(self.task)
            raise

    async def close(self) -> None:
        self._closed = True
        self.authority.close()
        self.cancelled.set()
        self._clear_queue()
        if self.task is not None and not self.task.done():
            self.task.cancel()
            await self._settle(self.task)
        await self._settle(asyncio.create_task(self.port.close()), cleanup=True)


@dataclass(frozen=True)
class TranscriptSegment:
    start_ms: int
    end_ms: int
    text: str


@dataclass(frozen=True)
class Transcription:
    language: str
    segments: tuple[TranscriptSegment, ...]
    elapsed_ms: float
    evidence: str
    audio_duration_ms: float = 0.0

    @property
    def text(self) -> str:
        return " ".join(segment.text for segment in self.segments).strip()


def word_error_rate(reference: str, hypothesis: str) -> dict[str, int | float]:
    def tokens(value: str) -> list[str]:
        try:
            byte_count = len(value.encode("utf-8")) if isinstance(value, str) else 40001
        except UnicodeEncodeError:
            raise LabError("invalid_wer_text") from None
        if not isinstance(value, str) or byte_count > 40000:
            raise LabError("invalid_wer_text")
        normalized = unicodedata.normalize("NFKC", value).casefold()
        result = re.findall(r"[^\W_]+(?:['’][^\W_]+)*", normalized, re.UNICODE)
        if len(result) > 2048:
            raise LabError("wer_token_bound")
        return result
    ref, hyp = tokens(reference), tokens(hypothesis)
    if not ref:
        raise LabError("empty_wer_reference")
    previous = list(range(len(hyp) + 1))
    for i, left in enumerate(ref, 1):
        current = [i]
        for j, right in enumerate(hyp, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j-1] + (left != right)))
        previous = current
    # Insertions can exceed reference length. Do not clamp true WER to 1.
    return {"distance": previous[-1], "reference_tokens": len(ref), "hypothesis_tokens": len(hyp), "wer": previous[-1] / len(ref)}
