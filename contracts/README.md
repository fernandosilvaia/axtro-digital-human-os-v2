# Contracts

This directory contains the **47 normative JSON Schemas** for Axtro Digital Human OS V2.

- Draft: JSON Schema 2020-12
- Every object is closed with `additionalProperties: false`.
- Every schema has one valid and one deliberately invalid example.
- Arbitrary provider payloads are carried as canonical JSON strings and must be validated against the referenced tool/provider schema before use.
- Breaking changes require a new schema version and an upcaster or migration plan.
- `session_state_snapshot` is a restricted, rebuildable cache of the complete interaction aggregate. It is never an authority independent from the canonical timeline.
- `event_delivery_receipt` is internal operational evidence with canonical trace and correlation identity. It excludes payloads, claim tokens and raw errors by contract.
- Post-call workflow status and step receipts have conditional state semantics, so terminal, waiting, retry and checkpoint fields cannot be combined arbitrarily.

Run:

```bash
python3 scripts/validate_contracts.py
```
