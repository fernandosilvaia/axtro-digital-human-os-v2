"""evaluate.py da avaliação de conversa: formato, ensaio e trava de gasto."""

from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("conversation_eval", ROOT / "experiments" / "conversation-eval" / "evaluate.py")
assert SPEC is not None and SPEC.loader is not None
evaluate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evaluate)

CONFIRMED = {
    "CONVERSATION_EVAL_JUDGE_CONFIRM": "spend-judge-credit",
    "OPENROUTER_API_KEY": "synthetic-only",
    "CONVERSATION_EVAL_JUDGE_MODEL": "synthetic/judge",
}


def conversation(source: str = "live") -> dict:
    return {
        "id": "synthetic",
        "source": source,
        "chatbot_role": "An AI consultant.",
        "scenario": "A synthetic person asks about coverage.",
        "expected_outcome": "The licensed agent gets the handoff.",
        "turns": [
            {"role": "user", "content": "How much do we need?"},
            {"role": "assistant", "content": "", "tools_called": [{"name": "estimate_coverage_need", "output": "Educational estimate"}]},
            {"role": "assistant", "content": "About 620 thousand, as an estimate.", "guardrail_flags": ["approval_claim"]},
            {"role": "user", "content": "OK"},
        ],
    }


class ConversationEvalTest(unittest.TestCase):
    def run_main(self, suite: str, rows: list[dict], env: dict, runners: dict | None = None) -> dict:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "rows.jsonl"
            path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                self.assertEqual(evaluate.main([suite, str(path)], env=env, runners=runners), 0)
            return json.loads(buffer.getvalue())

    def test_tool_turn_and_the_speech_after_it_are_one_turn_of_the_persona(self) -> None:
        merged = evaluate.merge_assistant_turns(conversation()["turns"])
        self.assertEqual([turn["role"] for turn in merged], ["user", "assistant", "user"])
        self.assertEqual(merged[1]["content"], "About 620 thousand, as an estimate.")
        self.assertEqual(merged[1]["tools_called"][0]["name"], "estimate_coverage_need")

    def test_report_needs_no_judge_and_surfaces_tools_and_sentinel_codes(self) -> None:
        item = evaluate.conversation_report([conversation()])["items"][0]
        self.assertEqual(item["tools_called"], ["estimate_coverage_need"])
        self.assertEqual(item["guardrail_flags"], ["approval_claim"])
        self.assertEqual(item["silent_turns"], 0)

    def test_malformed_rows_are_rejected_before_anything_runs(self) -> None:
        for mutate in (
            lambda row: row.pop("chatbot_role"),
            lambda row: row["turns"].insert(0, {"role": "assistant", "content": "Hi"}),
            lambda row: row["turns"].append({"role": "system", "content": "x"}),
            lambda row: row["turns"][1].update(tools_called=[{"output": "no name"}]),
        ):
            row = conversation()
            mutate(row)
            with self.assertRaises(evaluate.EvalDataError):
                evaluate.validate_conversation_row(row)
        with self.assertRaises(evaluate.EvalDataError):
            evaluate.validate_rag_row({"id": "x", "user_input": "q", "reference": "r", "source": "reference-only", "reference_contexts": []})

    def test_dry_run_is_never_scored_even_with_the_judge_confirmed(self) -> None:
        called = []
        runners = {"deepeval": lambda *args: called.append("deepeval") or {}, "ragas": lambda *args: {}, "judge": lambda *args: called.append("judge")}
        output = self.run_main("conversations", [conversation("dry-run")], CONFIRMED, runners)
        self.assertIn("dry-run", output["scores"])
        self.assertEqual(called, [])

    def test_no_judge_call_without_the_explicit_confirmation(self) -> None:
        called = []
        runners = {"deepeval": lambda *args: called.append("deepeval") or {}, "ragas": lambda *args: {}, "judge": lambda *args: called.append("judge")}
        output = self.run_main("conversations", [conversation()], {"OPENROUTER_API_KEY": "synthetic-only"}, runners)
        self.assertEqual(output["judge"], "off (no paid call)")
        self.assertEqual(called, [])
        output = self.run_main("conversations", [conversation()], CONFIRMED, runners)
        self.assertEqual(called, ["judge", "deepeval"])
        with self.assertRaises(evaluate.EvalDataError):
            evaluate.judge_settings({"CONVERSATION_EVAL_JUDGE_CONFIRM": "spend-judge-credit"})

    def test_missing_libraries_skip_with_a_reason_instead_of_crashing(self) -> None:
        def missing(*_args):
            raise ModuleNotFoundError("No module named 'ragas'", name="ragas")
        row = {"id": "x", "user_input": "q", "reference": "r", "source": "local-lexical", "reference_contexts": ["## A"], "retrieved_contexts": ["## A"]}
        output = self.run_main("rag", [row], {}, {"deepeval": missing, "ragas": missing, "judge": missing})
        self.assertIn("ragas is not installed", output["ragas"])

    def test_library_telemetry_is_off_before_any_library_is_imported(self) -> None:
        import os
        self.assertEqual(os.environ.get("DEEPEVAL_TELEMETRY_OPT_OUT"), "YES")
        self.assertEqual(os.environ.get("RAGAS_DO_NOT_TRACK"), "true")

    def test_judge_json_is_extracted_from_code_fences(self) -> None:
        self.assertEqual(evaluate.extract_json('```json\n{"score": 1}\n```'), '{"score": 1}')
        self.assertEqual(evaluate.extract_json('Here: {"verdict": "yes"} done'), '{"verdict": "yes"}')


if __name__ == "__main__":
    unittest.main()
