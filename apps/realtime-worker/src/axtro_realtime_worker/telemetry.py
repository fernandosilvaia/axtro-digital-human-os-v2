"""Strict internal W3C traceparent handling for the realtime worker.

This module intentionally accepts only a trusted internal carrier. HTTP headers,
baggage, tracestate, tenant identity, session identity and payload data do not
belong to this boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re
from time import monotonic_ns


_TRACEPARENT = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")
_SPAN_ID = re.compile(r"^[0-9a-f]{16}$")
_UUID_V7 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_ZERO_TRACE_ID = "0" * 32
_ZERO_SPAN_ID = "0" * 16


class InternalTraceValidationError(ValueError):
    """Raised when a trusted internal carrier cannot be continued safely."""


@dataclass(frozen=True)
class InternalTraceparent:
    trace_id: str
    parent_span_id: str
    trace_flags: str


@dataclass(frozen=True)
class TrustedWorkerTelemetryContext:
    """Correlation data already validated by the event or service boundary."""

    tenant_id: str
    session_id: str | None
    correlation_id: str
    causation_id: str | None


@dataclass(frozen=True)
class WorkerSpan:
    """A worker span record compatible with the M0 telemetry schema."""

    context: TrustedWorkerTelemetryContext
    trace_id: str
    span_id: str
    parent_span_id: str
    trace_flags: str
    started_at: str
    started_monotonic_ns: int

    def internal_carrier(self) -> dict[str, str]:
        return {"traceparent": f"00-{self.trace_id}-{self.span_id}-{self.trace_flags}"}

    def record(self) -> dict[str, object]:
        """Return a payload-free, completed M0 span record for the local sink."""
        ended_at = _utc_timestamp()
        duration_ms = max(0, (monotonic_ns() - self.started_monotonic_ns) // 1_000_000)
        return {
            "schema_version": "1.0.0",
            "name": "worker.turn",
            "service_name": "realtime-worker",
            "tenant_id": self.context.tenant_id,
            "session_id": self.context.session_id,
            "trace_id": self.trace_id,
            "trace_flags": self.trace_flags,
            "span_id": self.span_id,
            "parent_span_id": self.parent_span_id,
            "correlation_id": self.context.correlation_id,
            "causation_id": self.context.causation_id,
            "started_at": self.started_at,
            "ended_at": ended_at,
            "duration_ms": duration_ms,
            "outcome": "success",
            "error_code": None,
            "attributes": {"component": "realtime_worker"},
        }


def parse_internal_traceparent(value: object) -> InternalTraceparent:
    """Parse the narrow M0 W3C profile, with no public-header fallback."""
    if not isinstance(value, str):
        raise InternalTraceValidationError("internal trace carrier is invalid")
    match = _TRACEPARENT.fullmatch(value)
    if match is None:
        raise InternalTraceValidationError("internal trace carrier is invalid")
    trace_id, parent_span_id, trace_flags = match.groups()
    if trace_id == _ZERO_TRACE_ID or parent_span_id == _ZERO_SPAN_ID:
        raise InternalTraceValidationError("internal trace carrier is invalid")
    return InternalTraceparent(trace_id=trace_id, parent_span_id=parent_span_id, trace_flags=trace_flags)


def parse_internal_carrier(value: object) -> InternalTraceparent:
    """Accept exactly the traceparent field emitted by the authenticated sender."""
    if not isinstance(value, dict) or set(value) != {"traceparent"}:
        raise InternalTraceValidationError("internal trace carrier is invalid")
    return parse_internal_traceparent(value["traceparent"])


def create_child_traceparent(parent: InternalTraceparent, span_id: object) -> str:
    """Create a downstream carrier without adding tenant, payload or baggage fields."""
    parent = _validate_internal_traceparent(parent)
    if not isinstance(span_id, str) or _SPAN_ID.fullmatch(span_id) is None or span_id == _ZERO_SPAN_ID:
        raise InternalTraceValidationError("internal trace carrier is invalid")
    return f"00-{parent.trace_id}-{span_id}-{parent.trace_flags}"


def create_trusted_worker_context(
    tenant_id: object,
    session_id: object,
    correlation_id: object,
    causation_id: object,
) -> TrustedWorkerTelemetryContext:
    """Validate trusted event correlation fields before recording a worker span."""
    return TrustedWorkerTelemetryContext(
        tenant_id=_parse_uuid_v7(tenant_id),
        session_id=None if session_id is None else _parse_uuid_v7(session_id),
        correlation_id=_parse_uuid_v7(correlation_id),
        causation_id=None if causation_id is None else _parse_uuid_v7(causation_id),
    )


def start_worker_span(
    context: TrustedWorkerTelemetryContext,
    parent: InternalTraceparent,
    span_id: object,
) -> WorkerSpan:
    """Create the worker child span and its narrow downstream carrier."""
    context = _validate_trusted_worker_context(context)
    parent = _validate_internal_traceparent(parent)
    if not isinstance(span_id, str) or _SPAN_ID.fullmatch(span_id) is None or span_id == _ZERO_SPAN_ID:
        raise InternalTraceValidationError("internal trace carrier is invalid")
    return WorkerSpan(
        context=context,
        trace_id=parent.trace_id,
        span_id=span_id,
        parent_span_id=parent.parent_span_id,
        trace_flags=parent.trace_flags,
        started_at=_utc_timestamp(),
        started_monotonic_ns=monotonic_ns(),
    )


def _parse_uuid_v7(value: object) -> str:
    if not isinstance(value, str) or _UUID_V7.fullmatch(value) is None:
        raise InternalTraceValidationError("internal trace carrier is invalid")
    return value


def _validate_internal_traceparent(value: object) -> InternalTraceparent:
    """Revalidate public dataclasses before using a possibly deserialized value."""
    if not isinstance(value, InternalTraceparent):
        raise InternalTraceValidationError("internal trace carrier is invalid")
    return parse_internal_traceparent(
        f"00-{value.trace_id}-{value.parent_span_id}-{value.trace_flags}",
    )


def _validate_trusted_worker_context(value: object) -> TrustedWorkerTelemetryContext:
    """Revalidate public context fields at the stateful worker boundary."""
    if not isinstance(value, TrustedWorkerTelemetryContext):
        raise InternalTraceValidationError("internal trace carrier is invalid")
    return create_trusted_worker_context(
        value.tenant_id,
        value.session_id,
        value.correlation_id,
        value.causation_id,
    )


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
