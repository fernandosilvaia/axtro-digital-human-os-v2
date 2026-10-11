#!/usr/bin/env python3
"""Laboratório: Pipecat comandando a Tavus, com o cérebro da Axtro como LLM.

Hoje a Tavus faz tudo na chamada: escuta, decide o fim do turno, chama o LLM,
fala e renderiza o rosto. Aqui ela só renderiza o rosto (TavusVideoService, com
a persona especial "pipecat0", que usa a nossa voz). O resto fica com a gente,
peça por peça, para medir:

- **Turno:** Silero VAD (MIT) para fala e silêncio, e Smart Turn v3 (BSD-2,
  local, em CPU) para decidir se a pessoa terminou de falar ou só respirou.
- **Cérebro:** a mesma rota /api/brain/<agentId> da produção, como LLM
  compatível com OpenAI. Doutrina, sentinela e teto de entrada iguais.
- **Voz:** ElevenLabs como base, ou uma voz aberta (Chatterbox, MIT, ou
  Qwen3-TTS, Apache-2.0) servida localmente por um servidor compatível com a
  API de TTS da OpenAI. O teste cego (blind_test.py) decide se troca.
- **Ouvido:** Whisper local (faster-whisper, MIT).

Gasta dinheiro (Tavus, Daily, ElevenLabs e o cérebro). Por isso só sobe com
VOICE_LAB_LIVE_CONFIRM=spend-tavus-and-voice-credit. Sem isso, valida a
configuração e mostra o plano, sem rede. Nunca é caminho de cliente: é
laboratório, com sala Daily de teste.

    python experiments/voice-lab/pipeline.py            # plano, sem rede
    VOICE_LAB_LIVE_CONFIRM=... python experiments/voice-lab/pipeline.py
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping
from urllib.parse import urlparse

LIVE_CONFIRM = "spend-tavus-and-voice-credit"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
BRAIN_PATH = re.compile(r"^/api/brain/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
LANGUAGES = {"en": "en", "pt": "pt", "es": "es"}
TTS_ENGINES = {"elevenlabs", "openai-compatible"}


class LabConfigError(ValueError):
    """Configuração fora do contrato. Nunca repete o valor de um segredo."""


@dataclass(frozen=True)
class LabConfig:
    # repr=False: um print ou log acidental do objeto nunca mostra segredo.
    brain_base_url: str
    brain_secret: str = field(repr=False)
    tavus_api_key: str = field(repr=False)
    tavus_replica_id: str
    daily_room_url: str
    daily_token: str | None = field(repr=False)
    language: str
    tts: str
    tts_voice: str
    elevenlabs_api_key: str | None = field(repr=False)
    tts_base_url: str | None
    whisper_model: str

    def plan(self) -> dict[str, Any]:
        """O que subiria, sem nenhum segredo."""
        safe = asdict(self)
        for key in ("brain_secret", "tavus_api_key", "daily_token", "elevenlabs_api_key"):
            safe[key] = "set" if safe[key] else None
        return safe


def _https_or_loopback(url: str, name: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme == "https" or (parsed.scheme == "http" and parsed.hostname in LOOPBACK_HOSTS):
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise LabConfigError(f"{name} must not carry credentials, query or fragment")
        return url.rstrip("/")
    raise LabConfigError(f"{name} must be https (http only on loopback)")


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise LabConfigError(f"{name} is required")
    return value


def config_from_env(env: Mapping[str, str]) -> LabConfig:
    brain_base_url = _https_or_loopback(_required(env, "VOICE_LAB_BRAIN_BASE_URL"), "VOICE_LAB_BRAIN_BASE_URL")
    if not BRAIN_PATH.match(urlparse(brain_base_url).path):
        raise LabConfigError("VOICE_LAB_BRAIN_BASE_URL must be <origin>/api/brain/<agentId> (the base, without /chat/completions)")
    daily_room_url = _https_or_loopback(_required(env, "VOICE_LAB_DAILY_ROOM_URL"), "VOICE_LAB_DAILY_ROOM_URL")
    language = env.get("VOICE_LAB_LANGUAGE", "en").strip()
    if language not in LANGUAGES:
        raise LabConfigError("VOICE_LAB_LANGUAGE must be en, pt or es")
    tts = env.get("VOICE_LAB_TTS", "elevenlabs").strip()
    if tts not in TTS_ENGINES:
        raise LabConfigError("VOICE_LAB_TTS must be elevenlabs or openai-compatible")
    elevenlabs_api_key = _required(env, "ELEVENLABS_API_KEY") if tts == "elevenlabs" else None
    tts_base_url = _https_or_loopback(_required(env, "VOICE_LAB_TTS_BASE_URL"), "VOICE_LAB_TTS_BASE_URL") if tts == "openai-compatible" else None
    return LabConfig(
        brain_base_url=brain_base_url,
        brain_secret=_required(env, "VOICE_LAB_BRAIN_SECRET"),
        tavus_api_key=_required(env, "TAVUS_API_KEY"),
        tavus_replica_id=_required(env, "TAVUS_REPLICA_ID"),
        daily_room_url=daily_room_url,
        daily_token=env.get("VOICE_LAB_DAILY_TOKEN", "").strip() or None,
        language=language,
        tts=tts,
        tts_voice=_required(env, "VOICE_LAB_TTS_VOICE"),
        elevenlabs_api_key=elevenlabs_api_key,
        tts_base_url=tts_base_url,
        whisper_model=env.get("VOICE_LAB_WHISPER_MODEL", "small").strip() or "small",
    )


def build_pipeline(config: LabConfig, session: Any, stt: Any = None) -> Any:  # pragma: no cover - exige o SDK
    """Monta a pipeline com as classes reais do Pipecat 1.12, sem abrir rede.

    Conferido contra o SDK instalado: no 1.12 o VAD fica nos parâmetros do
    agregador do usuário. O DailyParams ainda aceita `vad_analyzer`, mas
    descarta em silêncio, e o laboratório rodaria sem VAD sem ninguém
    perceber. `stt` só existe para checar a montagem sem o faster-whisper.
    """
    from pipecat.audio.turn.smart_turn.local_smart_turn_v3 import LocalSmartTurnAnalyzerV3
    from pipecat.audio.vad.silero import SileroVADAnalyzer
    from pipecat.audio.vad.vad_analyzer import VADParams
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.task import PipelineParams, PipelineTask
    from pipecat.processors.aggregators.llm_context import LLMContext
    from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
    from pipecat.services.openai.llm import OpenAILLMService
    from pipecat.services.tavus.video import TavusVideoService
    from pipecat.transcriptions.language import Language
    from pipecat.transports.daily.transport import DailyParams, DailyTransport
    from pipecat.turns.user_stop import TurnAnalyzerUserTurnStopStrategy
    from pipecat.turns.user_turn_strategies import UserTurnStrategies

    transport = DailyTransport(
        config.daily_room_url,
        config.daily_token,
        "Priscila (lab)",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            video_out_enabled=True,
            video_out_is_live=True,
            video_out_width=1280,
            video_out_height=720,
        ),
    )
    language = {"en": Language.EN, "pt": Language.PT, "es": Language.ES}[config.language]
    if stt is None:
        from pipecat.services.whisper.stt import WhisperSTTService
        stt = WhisperSTTService(model=config.whisper_model, language=language)
    # O cérebro é a mesma rota da produção. A Tavus acrescenta /chat/completions
    # à base; o cliente OpenAI faz o mesmo, então a base é idêntica.
    # No 1.12, modelo e voz vão em `settings` (os parâmetros soltos estão depreciados).
    llm = OpenAILLMService(
        api_key=config.brain_secret,
        base_url=config.brain_base_url,
        settings=OpenAILLMService.Settings(model="axtro-digital-human-os-brain"),
    )
    if config.tts == "elevenlabs":
        from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
        tts = ElevenLabsTTSService(api_key=config.elevenlabs_api_key, settings=ElevenLabsTTSService.Settings(voice=config.tts_voice))
    else:
        from pipecat.services.openai.tts import OpenAITTSService
        tts = OpenAITTSService(api_key="local-voice-server", base_url=config.tts_base_url, settings=OpenAITTSService.Settings(voice=config.tts_voice))
    tavus = TavusVideoService(api_key=config.tavus_api_key, replica_id=config.tavus_replica_id, session=session)

    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        LLMContext([]),
        user_params=LLMUserAggregatorParams(
            # stop curto: quem decide o fim do turno é o Smart Turn, não o silêncio.
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.2)),
            user_turn_strategies=UserTurnStrategies(stop=[TurnAnalyzerUserTurnStopStrategy(turn_analyzer=LocalSmartTurnAnalyzerV3())]),
        ),
    )
    pipeline = Pipeline([
        transport.input(), stt, user_aggregator, llm, tts, tavus, transport.output(), assistant_aggregator,
    ])
    return PipelineTask(pipeline, params=PipelineParams(enable_metrics=True, enable_usage_metrics=True))


async def run_live(config: LabConfig) -> None:  # pragma: no cover - exige Tavus, Daily e voz reais
    import aiohttp
    from pipecat.pipeline.runner import PipelineRunner

    async with aiohttp.ClientSession() as session:
        await PipelineRunner().run(build_pipeline(config, session))


def main(env: Mapping[str, str] = os.environ) -> int:
    config = config_from_env(env)
    if env.get("VOICE_LAB_LIVE_CONFIRM", "").strip() != LIVE_CONFIRM:
        json.dump({"mode": "plan (no network, no spend)", "config": config.plan()}, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0
    asyncio.run(run_live(config))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except LabConfigError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
