# Evaluation Framework

## Evaluation layers

### Deterministic
Schema, state transition, policy, tool scopes, citations, price and receipt checks.

### Simulation
Synthetic buyers, fixed transcripts, audio replay, provider fakes and failure injection.

### Model judges
Style, empathy, coherence and sales quality. Never the only gate for safety or factuality.

### Human review
Naturalness, uncanny behavior, trust, clarity and business usefulness.

## Suites

- `golden_conversation`;
- `turn_taking_replay`;
- `exact_entity_capture`;
- `tool_safety`;
- `rag_injection`;
- `tenant_isolation`;
- `handoff_quality`;
- `avatar_presence`;
- `regulated_claims`;
- `cost_regression`.

## Release gates

| Gate | M1 | M2 | M3 |
|---|---|---|---|
| contracts and state | required | required | required |
| tenancy | required | required | required |
| turn replay | n/a | required | required |
| naturalness human score | n/a | report | ≥4/5 target |
| factuality | fake only | limited | ≥98% golden claims |
| critical policy violations | zero | zero | zero |
| cost report | synthetic | provider measured | tenant measured |
| handoff | simulated | simulated | live internal |

## Experiment governance

Candidate compares against pinned control. Promotion requires minimum sample, guardrail metrics and rollback. Conversion lift never overrides critical safety regression.
