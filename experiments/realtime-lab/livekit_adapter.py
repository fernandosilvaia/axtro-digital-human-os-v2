"""Opt-in SDK control smoke. No room, inference engines or physical media."""
from __future__ import annotations

import asyncio
import importlib
import importlib.metadata
from typing import Callable

from realtime_lab import GenerationAuthority, GenerationScope, InterruptAck, LabError, OutputFrame

SDK_VERSION = "1.8.3"


def _session_factory(sdk):
    # None is deliberate: this experiment has no inference engine. Actual
    # local whisper audio is evaluated separately; SDK ACK is not silence.
    return sdk.AgentSession(
        llm=None, stt=None, tts=None, vad=None,
        turn_handling={"turn_detection": "manual", "preemptive_generation": {"enabled": False}},
        user_away_timeout=None, ivr_detection=False, max_tool_steps=0,
    )


class LiveKitControl:
    def __init__(self, authority: GenerationAuthority, session, agent):
        self.authority, self.session, self.agent = authority, session, agent
        self.started = asyncio.Event()
        self.scope: GenerationScope | None = None
        self.closed = False

    async def stream(self, scope: GenerationScope, emit: Callable[[OutputFrame], bool], cancelled: asyncio.Event) -> None:
        if self.closed or not self.authority.permits(scope):
            raise LabError("stale_or_cancelled")
        self.scope = scope
        # No Room is supplied, so this starts local SDK lifecycle only.
        await self.session.start(self.agent, record=False, session_host=False)
        self.started.set()
        await cancelled.wait()

    async def interrupt(self, scope: GenerationScope) -> InterruptAck:
        if self.scope is not scope or self.closed:
            return InterruptAck(False)
        try:
            await self.session.interrupt(force=True)
            return InterruptAck(True, False)
        except Exception:
            return InterruptAck(False, False)

    async def close(self) -> None:
        if not self.closed:
            self.closed = True
            await self.session.aclose()


def create_livekit_control(authority: GenerationAuthority) -> LiveKitControl:
    # Optional package is never imported by ordinary lab/module imports.
    try:
        if importlib.metadata.version("livekit-agents") != SDK_VERSION:
            raise LabError("sdk_version_drift")
        sdk = importlib.import_module("livekit.agents")
    except importlib.metadata.PackageNotFoundError:
        raise LabError("optional_sdk_not_installed") from None
    session = _session_factory(sdk)
    agent = sdk.Agent(instructions="Local lifecycle control fixture only.", llm=None, stt=None, tts=None, vad=None,
                      turn_handling={"turn_detection": "manual", "preemptive_generation": {"enabled": False}})
    return LiveKitControl(authority, session, agent)
