#!/usr/bin/env python3
"""Teste cego de voz da Priscila: vozes abertas contra o ElevenLabs.

    python experiments/voice-lab/blind_test.py prepare --manifest clips.json --session /abs/sessao
    python experiments/voice-lab/blind_test.py score --session /abs/sessao ana.csv bruno.csv

`prepare` recebe os áudios já gerados por cada motor para as falas de
lines.json. Ele confere o SHA-256 de cada arquivo e exige o mesmo conjunto de
falas em todos os motores. Depois copia os clipes com nomes opacos e em ordem
embaralhada e grava duas coisas separadas: a planilha que vai para quem ouve e
a chave (clipe -> motor), que fica só com quem conduz o teste.

`score` lê uma planilha preenchida por ouvinte (notas de 1 a 5 para
naturalidade e pronúncia) e compara cada motor com o ElevenLabs por idioma,
usando a diferença pareada (mesmo ouvinte, mesma fala) com intervalo de 95% por
bootstrap. A regra é a do roadmap: só troca se ganhar. Ganhar é o limite
inferior da diferença de naturalidade acima de zero, sem perder pronúncia de
forma relevante. Com poucos pares, o veredito é "dados insuficientes", nunca
um palpite.

Só biblioteca padrão: nada aqui gera áudio, baixa modelo ou chama provedor.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import re
import secrets
import shutil
import statistics
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping

HERE = Path(__file__).resolve().parent
LINES_PATH = HERE / "lines.json"
BASELINE = "elevenlabs"
LANGUAGES = {"en", "pt", "es"}
AUDIO_SUFFIXES = {".wav", ".mp3", ".ogg", ".flac"}
ENGINE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
MIN_PAIRS = 12
PRONUNCIATION_TOLERANCE = -0.25
SHEET_FIELDS = ["clip_id", "language", "line_id", "text", "file", "naturalness", "pronunciation", "notes"]
MAX_CLIP_BYTES = 20 * 1024 * 1024


class BlindTestError(ValueError):
    """Entrada fora do protocolo. A mensagem nunca revela o motor de um clipe."""


def load_lines(path: Path = LINES_PATH) -> dict[tuple[str, str], str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    lines = {(line["language"], line["id"]): line["text"] for line in data["lines"]}
    if len(lines) != len(data["lines"]):
        raise BlindTestError("lines.json has duplicate (language, id) pairs")
    return lines


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 16), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_manifest(entries: Any, lines: Mapping[tuple[str, str], str]) -> list[dict[str, Any]]:
    if not isinstance(entries, list) or not entries:
        raise BlindTestError("manifest must be a non-empty list")
    clips: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise BlindTestError(f"entry {index} must be an object")
        engine, language, line_id = entry.get("engine"), entry.get("language"), entry.get("line_id")
        if not isinstance(engine, str) or not ENGINE_PATTERN.match(engine):
            raise BlindTestError(f"entry {index}: engine must match {ENGINE_PATTERN.pattern}")
        if language not in LANGUAGES or (language, line_id) not in lines:
            raise BlindTestError(f"entry {index}: unknown language or line_id")
        path = Path(str(entry.get("path", "")))
        if not path.is_absolute() or path.suffix.lower() not in AUDIO_SUFFIXES or not path.is_file():
            raise BlindTestError(f"entry {index}: path must be an existing absolute audio file")
        if path.stat().st_size > MAX_CLIP_BYTES:
            raise BlindTestError(f"entry {index}: clip larger than {MAX_CLIP_BYTES} bytes")
        expected = str(entry.get("sha256", "")).lower()
        if not re.fullmatch(r"[0-9a-f]{64}", expected) or sha256_file(path) != expected:
            raise BlindTestError(f"entry {index}: sha256 does not match the file")
        key = (engine, language, line_id)
        if key in seen:
            raise BlindTestError(f"entry {index}: duplicate clip for the same engine and line")
        seen.add(key)
        clips.append({"engine": engine, "language": language, "line_id": line_id, "path": path, "sha256": expected})
    engines = {clip["engine"] for clip in clips}
    if BASELINE not in engines or len(engines) < 2:
        raise BlindTestError(f"the test needs {BASELINE} plus at least one candidate")
    for language in {clip["language"] for clip in clips}:
        per_engine = [{clip["line_id"] for clip in clips if clip["engine"] == engine and clip["language"] == language} for engine in engines]
        if any(lines_set != per_engine[0] for lines_set in per_engine):
            raise BlindTestError(f"language {language}: every engine must cover the same lines (balanced design)")
    return clips


def prepare(manifest_path: Path, session: Path, rng: random.Random | None = None) -> dict[str, Any]:
    lines = load_lines()
    clips = validate_manifest(json.loads(manifest_path.read_text(encoding="utf-8")), lines)
    if session.exists() and any(session.iterdir()):
        raise BlindTestError("session directory must be new or empty")
    seed = secrets.randbits(64)
    shuffler = rng or random.Random(seed)
    shuffler.shuffle(clips)
    clip_dir = session / "clips"
    clip_dir.mkdir(parents=True, exist_ok=True)
    used: set[str] = set()
    key: dict[str, Any] = {"baseline": BASELINE, "clips": {}}
    rows = []
    for clip in clips:
        clip_id = secrets.token_hex(4)
        while clip_id in used:
            clip_id = secrets.token_hex(4)
        used.add(clip_id)
        file_name = f"{clip_id}{clip['path'].suffix.lower()}"
        shutil.copyfile(clip["path"], clip_dir / file_name)
        key["clips"][clip_id] = {"engine": clip["engine"], "language": clip["language"], "line_id": clip["line_id"], "sha256": clip["sha256"]}
        rows.append({
            "clip_id": clip_id, "language": clip["language"], "line_id": clip["line_id"],
            "text": lines[(clip["language"], clip["line_id"])], "file": f"clips/{file_name}",
            "naturalness": "", "pronunciation": "", "notes": "",
        })
    with (session / "sheet.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SHEET_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    (session / "key.json").write_text(json.dumps(key, indent=2), encoding="utf-8")
    return {"clips": len(rows), "sheet": str(session / "sheet.csv"), "key": str(session / "key.json")}


def read_ratings(path: Path, known: Mapping[str, Any]) -> list[dict[str, Any]]:
    listener = path.stem
    ratings = []
    with path.open(encoding="utf-8", newline="") as handle:
        for number, row in enumerate(csv.DictReader(handle), start=2):
            if not (row.get("naturalness") or "").strip() and not (row.get("pronunciation") or "").strip():
                continue
            clip_id = (row.get("clip_id") or "").strip()
            if clip_id not in known:
                raise BlindTestError(f"{path.name}:{number}: unknown clip_id")
            try:
                naturalness = int(row["naturalness"])
                pronunciation = int(row["pronunciation"])
            except (TypeError, ValueError) as error:
                raise BlindTestError(f"{path.name}:{number}: ratings must be integers 1..5") from error
            if not (1 <= naturalness <= 5 and 1 <= pronunciation <= 5):
                raise BlindTestError(f"{path.name}:{number}: ratings must be integers 1..5")
            ratings.append({"listener": listener, "clip_id": clip_id, "naturalness": naturalness, "pronunciation": pronunciation})
    return ratings


def bootstrap_interval(values: list[float], rng: random.Random, resamples: int) -> tuple[float, float]:
    if len(values) < 2:
        return (float("nan"), float("nan"))
    means = sorted(statistics.fmean(rng.choices(values, k=len(values))) for _ in range(resamples))
    return (means[int(0.025 * resamples)], means[int(0.975 * resamples) - 1])


def score(session: Path, rating_files: Iterable[Path], resamples: int = 4000, seed: int = 20261010) -> dict[str, Any]:
    key = json.loads((session / "key.json").read_text(encoding="utf-8"))
    clips = key["clips"]
    baseline = key["baseline"]
    ratings = [rating for path in rating_files for rating in read_ratings(path, clips)]
    rng = random.Random(seed)
    by_cell: dict[tuple[str, str, str, str], dict[str, int]] = {}
    for rating in ratings:
        clip = clips[rating["clip_id"]]
        by_cell[(clip["language"], clip["engine"], rating["listener"], clip["line_id"])] = rating
    report: dict[str, Any] = {"baseline": baseline, "ratings": len(ratings), "languages": {}}
    for language in sorted({clip["language"] for clip in clips.values()}):
        engines = sorted({clip["engine"] for clip in clips.values() if clip["language"] == language})
        summary: dict[str, Any] = {"engines": {}, "versus_baseline": {}}
        for engine in engines:
            cells = [cell for (lang, eng, _, _), cell in by_cell.items() if lang == language and eng == engine]
            summary["engines"][engine] = {
                "n": len(cells),
                "naturalness_mean": round(statistics.fmean(c["naturalness"] for c in cells), 3) if cells else None,
                "pronunciation_mean": round(statistics.fmean(c["pronunciation"] for c in cells), 3) if cells else None,
            }
        for engine in engines:
            if engine == baseline:
                continue
            pairs = [
                (cell, by_cell[(language, baseline, listener, line_id)])
                for (lang, eng, listener, line_id), cell in by_cell.items()
                if lang == language and eng == engine and (language, baseline, listener, line_id) in by_cell
            ]
            natural = [float(c["naturalness"] - b["naturalness"]) for c, b in pairs]
            spoken = [float(c["pronunciation"] - b["pronunciation"]) for c, b in pairs]
            entry: dict[str, Any] = {"pairs": len(pairs)}
            if len(pairs) < MIN_PAIRS:
                entry["verdict"] = f"insufficient data (need {MIN_PAIRS} paired ratings)"
            else:
                natural_low, natural_high = bootstrap_interval(natural, rng, resamples)
                spoken_low, spoken_high = bootstrap_interval(spoken, rng, resamples)
                entry.update({
                    "naturalness_diff": round(statistics.fmean(natural), 3),
                    "naturalness_ci95": [round(natural_low, 3), round(natural_high, 3)],
                    "pronunciation_diff": round(statistics.fmean(spoken), 3),
                    "pronunciation_ci95": [round(spoken_low, 3), round(spoken_high, 3)],
                    "verdict": "switch" if natural_low > 0 and spoken_low > PRONUNCIATION_TOLERANCE else f"keep {baseline}",
                })
            summary["versus_baseline"][engine] = entry
        report["languages"][language] = summary
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Teste cego de voz da Priscila")
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_parser = commands.add_parser("prepare")
    prepare_parser.add_argument("--manifest", type=Path, required=True)
    prepare_parser.add_argument("--session", type=Path, required=True)
    score_parser = commands.add_parser("score")
    score_parser.add_argument("--session", type=Path, required=True)
    score_parser.add_argument("ratings", type=Path, nargs="+")
    args = parser.parse_args(argv)
    result = prepare(args.manifest, args.session) if args.command == "prepare" else score(args.session, args.ratings)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BlindTestError as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)
