from __future__ import annotations

from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "realtime-worker" / "src"))

from axtro_realtime_worker.telemetry import (  # noqa: E402
    InternalTraceValidationError,
    InternalTraceparent,
    TrustedWorkerTelemetryContext,
    create_trusted_worker_context,
    create_child_traceparent,
    parse_internal_carrier,
    parse_internal_traceparent,
    start_worker_span,
)


class RealtimeWorkerTelemetryTests(unittest.TestCase):
    def test_worker_continues_strict_internal_traceparent(self) -> None:
        trace_id = "a" * 32
        parent_span_id = "b" * 16
        parsed = parse_internal_carrier({"traceparent": f"00-{trace_id}-{parent_span_id}-01"})

        self.assertEqual(parsed.trace_id, trace_id)
        self.assertEqual(parsed.parent_span_id, parent_span_id)
        self.assertEqual(create_child_traceparent(parsed, "c" * 16), f"00-{trace_id}-{'c' * 16}-01")

    def test_worker_rejects_public_or_malformed_trace_carriers(self) -> None:
        invalid = [
            None,
            {"traceparent": f"00-{'a' * 32}-{'b' * 16}-01", "baggage": "tenant=alpha"},
            {"traceparent": f"00-{'0' * 32}-{'b' * 16}-01"},
            {"traceparent": f"00-{'a' * 32}-{'0' * 16}-01"},
            {"traceparent": f"01-{'a' * 32}-{'b' * 16}-01"},
            f"00-{'a' * 31}-{'b' * 16}-01",
        ]
        for carrier in invalid:
            with self.subTest(carrier=carrier):
                with self.assertRaises(InternalTraceValidationError):
                    if isinstance(carrier, dict):
                        parse_internal_carrier(carrier)
                    else:
                        parse_internal_traceparent(carrier)

    def test_worker_span_preserves_parent_and_emits_narrow_child_carrier(self) -> None:
        trace_id = "a" * 32
        parent_span_id = "b" * 16
        worker_span_id = "c" * 16
        tenant_id = "018bcfe5-6800-7000-8000-000000000081"
        session_id = "018bcfe5-6800-7000-8000-000000000082"
        correlation_id = "018bcfe5-6800-7000-8000-000000000084"
        parent = parse_internal_carrier({"traceparent": f"00-{trace_id}-{parent_span_id}-01"})
        context = create_trusted_worker_context(tenant_id, session_id, correlation_id, None)

        span = start_worker_span(context, parent, worker_span_id)
        record = span.record()

        self.assertEqual(record["service_name"], "realtime-worker")
        self.assertEqual(record["trace_id"], trace_id)
        self.assertEqual(record["trace_flags"], "01")
        self.assertEqual(record["span_id"], worker_span_id)
        self.assertEqual(record["parent_span_id"], parent_span_id)
        self.assertEqual(record["outcome"], "success")
        self.assertEqual(record["attributes"], {"component": "realtime_worker"})
        self.assertEqual(span.internal_carrier(), {"traceparent": f"00-{trace_id}-{worker_span_id}-01"})

    def test_worker_revalidates_forged_public_dataclasses(self) -> None:
        valid_parent = parse_internal_carrier({"traceparent": f"00-{'a' * 32}-{'b' * 16}-01"})
        valid_context = create_trusted_worker_context(
            "018bcfe5-6800-7000-8000-000000000081",
            "018bcfe5-6800-7000-8000-000000000082",
            "018bcfe5-6800-7000-8000-000000000084",
            None,
        )
        forged_contexts = [
            TrustedWorkerTelemetryContext("MarinaOliveira", valid_context.session_id, valid_context.correlation_id, None),
            TrustedWorkerTelemetryContext(valid_context.tenant_id, "marina-session", valid_context.correlation_id, None),
            TrustedWorkerTelemetryContext(valid_context.tenant_id, valid_context.session_id, "marina-correlation", None),
            TrustedWorkerTelemetryContext(valid_context.tenant_id, valid_context.session_id, valid_context.correlation_id, "marina-causation"),
        ]
        forged_parents = [
            InternalTraceparent("marina-trace", valid_parent.parent_span_id, "01"),
            InternalTraceparent(valid_parent.trace_id, "marina-span", "01"),
            InternalTraceparent(valid_parent.trace_id, valid_parent.parent_span_id, "zz"),
        ]

        for context in forged_contexts:
            with self.subTest(context=context):
                with self.assertRaises(InternalTraceValidationError):
                    start_worker_span(context, valid_parent, "c" * 16)
        for parent in forged_parents:
            with self.subTest(parent=parent):
                with self.assertRaises(InternalTraceValidationError):
                    start_worker_span(valid_context, parent, "c" * 16)
                with self.assertRaises(InternalTraceValidationError):
                    create_child_traceparent(parent, "c" * 16)


if __name__ == "__main__":
    unittest.main()
