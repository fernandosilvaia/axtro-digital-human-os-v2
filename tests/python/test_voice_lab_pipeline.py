"""Laboratório Pipecat: contrato de configuração e trava de gasto, sem rede."""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("voice_lab_pipeline", ROOT / "experiments" / "voice-lab" / "pipeline.py")
assert SPEC is not None and SPEC.loader is not None
pipeline = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = pipeline  # dataclasses resolve anotações pelo módulo registrado
SPEC.loader.exec_module(pipeline)

AGENT = "019f6de0-0000-7000-8000-00000aa00001"
ENV = {
    "VOICE_LAB_BRAIN_BASE_URL": f"https://closer.example.com/api/brain/{AGENT}",
    "VOICE_LAB_BRAIN_SECRET": "synthetic-brain-secret",
    "TAVUS_API_KEY": "synthetic-tavus-key",
    "TAVUS_REPLICA_ID": "rsynthetic",
    "VOICE_LAB_DAILY_ROOM_URL": "https://axtro-lab.daily.co/priscila",
    "VOICE_LAB_TTS_VOICE": "synthetic-voice",
    "ELEVENLABS_API_KEY": "synthetic-eleven-key",
}


class VoiceLabPipelineTest(unittest.TestCase):
    def test_brain_url_is_the_base_tavus_and_openai_append_chat_completions_to(self) -> None:
        self.assertEqual(pipeline.config_from_env(ENV).brain_base_url, ENV["VOICE_LAB_BRAIN_BASE_URL"])
        for bad in (f"{ENV['VOICE_LAB_BRAIN_BASE_URL']}/chat/completions", "https://closer.example.com/api/brain/not-a-uuid",
                    f"http://closer.example.com/api/brain/{AGENT}", f"https://user:pw@closer.example.com/api/brain/{AGENT}"):
            with self.subTest(bad), self.assertRaises(pipeline.LabConfigError):
                pipeline.config_from_env({**ENV, "VOICE_LAB_BRAIN_BASE_URL": bad})
        local = pipeline.config_from_env({**ENV, "VOICE_LAB_BRAIN_BASE_URL": f"http://127.0.0.1:3101/api/brain/{AGENT}"})
        self.assertTrue(local.brain_base_url.startswith("http://127.0.0.1"))

    def test_each_voice_engine_requires_its_own_settings(self) -> None:
        without_eleven = {key: value for key, value in ENV.items() if key != "ELEVENLABS_API_KEY"}
        with self.assertRaises(pipeline.LabConfigError):
            pipeline.config_from_env(without_eleven)
        with self.assertRaises(pipeline.LabConfigError):
            pipeline.config_from_env({**without_eleven, "VOICE_LAB_TTS": "openai-compatible"})
        open_voice = pipeline.config_from_env({**without_eleven, "VOICE_LAB_TTS": "openai-compatible", "VOICE_LAB_TTS_BASE_URL": "http://localhost:8004/v1"})
        self.assertEqual(open_voice.tts, "openai-compatible")
        self.assertIsNone(open_voice.elevenlabs_api_key)
        with self.assertRaises(pipeline.LabConfigError):
            pipeline.config_from_env({**ENV, "VOICE_LAB_TTS": "bark"})
        with self.assertRaises(pipeline.LabConfigError):
            pipeline.config_from_env({**ENV, "VOICE_LAB_LANGUAGE": "fr"})

    def test_without_confirmation_it_only_prints_a_plan_with_no_secrets(self) -> None:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            self.assertEqual(pipeline.main(ENV), 0)
        output = buffer.getvalue()
        for secret in ("synthetic-brain-secret", "synthetic-tavus-key", "synthetic-eleven-key"):
            self.assertNotIn(secret, output)
        self.assertEqual(json.loads(output)["config"]["brain_secret"], "set")
        self.assertNotIn("pipecat", sys.modules, "the plan never imports the SDK")

    def test_the_open_voice_server_must_be_on_loopback_and_the_brain_host_is_shown(self) -> None:
        local = {key: value for key, value in ENV.items() if key != "ELEVENLABS_API_KEY"}
        local["VOICE_LAB_TTS"] = "openai-compatible"
        for remote in ("https://tts.example.com/v1", "http://192.168.0.20:8004/v1", "http://localhost.evil.com/v1", "ftp://localhost/v1"):
            with self.subTest(remote), self.assertRaises(pipeline.LabConfigError):
                pipeline.config_from_env({**local, "VOICE_LAB_TTS_BASE_URL": remote})
        ok = pipeline.config_from_env({**local, "VOICE_LAB_TTS_BASE_URL": "http://127.0.0.1:8004/v1"})
        self.assertEqual(ok.tts_base_url, "http://127.0.0.1:8004/v1")
        self.assertEqual(ok.plan()["brain_host"], "closer.example.com")

    def test_an_accidental_print_of_the_config_shows_no_secret(self) -> None:
        text = repr(pipeline.config_from_env(ENV))
        for secret in ("synthetic-brain-secret", "synthetic-tavus-key", "synthetic-eleven-key"):
            self.assertNotIn(secret, text)
        self.assertIn("brain_base_url", text)

    def test_errors_never_echo_a_secret(self) -> None:
        with self.assertRaises(pipeline.LabConfigError) as raised:
            pipeline.config_from_env({**ENV, "VOICE_LAB_DAILY_ROOM_URL": "ftp://synthetic-tavus-key@room"})
        self.assertNotIn("synthetic-tavus-key", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
