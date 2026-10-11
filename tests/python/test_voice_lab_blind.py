"""Teste cego de voz: anonimato da sessão e regra "só troca se ganhar"."""

from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import random
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("voice_blind_test", ROOT / "experiments" / "voice-lab" / "blind_test.py")
assert SPEC is not None and SPEC.loader is not None
blind = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(blind)

EN_LINES = sorted(line_id for (language, line_id) in blind.load_lines() if language == "en")


class BlindTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def clip(self, engine: str, line_id: str, language: str = "en") -> dict:
        path = self.root / "source" / f"{engine}-{language}-{line_id}.wav"
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = f"synthetic audio {engine} {language} {line_id}".encode()
        path.write_bytes(payload)
        return {"engine": engine, "language": language, "line_id": line_id, "path": str(path), "sha256": hashlib.sha256(payload).hexdigest()}

    def manifest(self, entries: list[dict]) -> Path:
        path = self.root / "manifest.json"
        path.write_text(json.dumps(entries), encoding="utf-8")
        return path

    def prepared_session(self, engines=("elevenlabs", "chatterbox")) -> Path:
        session = self.root / "session"
        blind.prepare(self.manifest([self.clip(engine, line_id) for engine in engines for line_id in EN_LINES]), session, random.Random(1))
        return session

    def ratings(self, session: Path, listener: str, scores: dict[str, tuple[int, int]], lines=EN_LINES) -> Path:
        key = json.loads((session / "key.json").read_text(encoding="utf-8"))["clips"]
        path = self.root / f"{listener}.csv"
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=blind.SHEET_FIELDS)
            writer.writeheader()
            for clip_id, clip in key.items():
                if clip["line_id"] not in lines:
                    continue
                naturalness, pronunciation = scores[clip["engine"]]
                writer.writerow({"clip_id": clip_id, "language": clip["language"], "line_id": clip["line_id"], "naturalness": naturalness, "pronunciation": pronunciation})
        return path

    def test_listeners_never_see_which_engine_made_a_clip(self) -> None:
        session = self.prepared_session()
        sheet = (session / "sheet.csv").read_text(encoding="utf-8")
        self.assertNotIn("elevenlabs", sheet)
        self.assertNotIn("chatterbox", sheet)
        files = sorted(path.name for path in (session / "clips").iterdir())
        self.assertEqual(len(files), 2 * len(EN_LINES))
        self.assertTrue(all(name[:8].isalnum() and "eleven" not in name and "chatter" not in name for name in files))
        key = json.loads((session / "key.json").read_text(encoding="utf-8"))
        self.assertEqual({clip["engine"] for clip in key["clips"].values()}, {"elevenlabs", "chatterbox"})

    def test_manifest_violations_stop_before_any_copy(self) -> None:
        good = [self.clip(engine, line_id) for engine in ("elevenlabs", "qwen3") for line_id in EN_LINES]
        cases = {
            "unbalanced": good[:-1],
            "no baseline": [entry for entry in good if entry["engine"] != "elevenlabs"],
            "bad hash": [dict(good[0], sha256="0" * 64), *good[1:]],
            "relative path": [dict(good[0], path="clip.wav"), *good[1:]],
            "unknown line": [dict(good[0], line_id="pricing"), *good[1:]],
            "engine name": [dict(good[0], engine="Eleven Labs"), *good[1:]],
            "duplicate": [*good, good[0]],
        }
        for name, entries in cases.items():
            with self.subTest(name), self.assertRaises(blind.BlindTestError):
                blind.prepare(self.manifest(entries), self.root / f"session-{name.replace(' ', '-')}")
        session = self.root / "used"
        session.mkdir()
        (session / "old.txt").write_text("x", encoding="utf-8")
        with self.assertRaises(blind.BlindTestError):
            blind.prepare(self.manifest(good), session)

    def test_a_candidate_switches_only_when_it_clearly_wins(self) -> None:
        session = self.prepared_session()
        better = [self.ratings(session, f"listener{i}", {"elevenlabs": (3, 4), "chatterbox": (4 + (i % 2), 4)}) for i in range(3)]
        verdict = blind.score(session, better)["languages"]["en"]["versus_baseline"]["chatterbox"]
        self.assertEqual(verdict["pairs"], 3 * len(EN_LINES))
        self.assertEqual(verdict["verdict"], "switch")

        tied = [self.ratings(session, f"tie{i}", {"elevenlabs": (4, 4), "chatterbox": (4, 4)}) for i in range(3)]
        self.assertEqual(blind.score(session, tied)["languages"]["en"]["versus_baseline"]["chatterbox"]["verdict"], "keep elevenlabs")

        mumbles = [self.ratings(session, f"mumble{i}", {"elevenlabs": (3, 5), "chatterbox": (5, 2)}) for i in range(3)]
        self.assertEqual(blind.score(session, mumbles)["languages"]["en"]["versus_baseline"]["chatterbox"]["verdict"], "keep elevenlabs",
                         "more natural but mispronouncing product names does not win")

    def test_too_few_paired_ratings_is_never_a_verdict(self) -> None:
        session = self.prepared_session()
        few = [self.ratings(session, "solo", {"elevenlabs": (2, 4), "chatterbox": (5, 5)})]
        verdict = blind.score(session, few)["languages"]["en"]["versus_baseline"]["chatterbox"]
        self.assertEqual(verdict["pairs"], len(EN_LINES))
        self.assertTrue(verdict["verdict"].startswith("insufficient data"))

    def test_bad_ratings_are_rejected(self) -> None:
        session = self.prepared_session()
        key = json.loads((session / "key.json").read_text(encoding="utf-8"))["clips"]
        clip_id = next(iter(key))
        for row in ({"clip_id": clip_id, "naturalness": "6", "pronunciation": "3"},
                    {"clip_id": clip_id, "naturalness": "great", "pronunciation": "3"},
                    {"clip_id": "deadbeef", "naturalness": "3", "pronunciation": "3"}):
            path = self.root / "bad.csv"
            with path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=blind.SHEET_FIELDS)
                writer.writeheader()
                writer.writerow(row)
            with self.subTest(row), self.assertRaises(blind.BlindTestError):
                blind.score(session, [path])


if __name__ == "__main__":
    unittest.main()
