# Contracts

This directory contains the **69 normative JSON Schemas** for Axtro Digital Human OS V2.

- Draft: JSON Schema 2020-12
- Every object is closed with `additionalProperties: false`.
- Every schema has one valid and one deliberately invalid example.
- Arbitrary provider payloads are carried as canonical JSON strings and must be validated against the referenced tool/provider schema before use.
- Breaking changes require a new schema version and an upcaster or migration plan.
- `session_state_snapshot` is a restricted, rebuildable cache of the complete interaction aggregate. It is never an authority independent from the canonical timeline.
- `event_delivery_receipt` is internal operational evidence with canonical trace and correlation identity. It excludes payloads, claim tokens and raw errors by contract.
- Post-call workflow status and step receipts have conditional state semantics, so terminal, waiting, retry and checkpoint fields cannot be combined arbitrarily.
- `turn_outcome_recorded` is content-free canonical evidence for a fenced generation claim. Successful outcomes bind the persistence result and resulting turn index; failed outcomes carry only a closed reason code.
- `meeting_terminal_notification_command` is restricted worker input. Its provider payload becomes immutable before the first network effect.
- `meeting_terminal_notification_delivery_receipt` is content-free evidence. Provider acceptance is distinct from inbox delivery.
- The Portal text preview contracts keep browser commands closed, bind admission to purpose-scoped persistence, and model browser results as exhaustive outcomes.
- `provider_processing_profile` is a dated, server-owned declaration that must be verified before provider admission.
- The five data-governance contracts keep disposition commands specialized, separate redaction from irreversible deletion, model granular legal holds, and retain only content-free status, work-item and receipt evidence.
- `x-axtro-discriminator` opts a schema into generated discriminated-union types only when every declared discriminator value has one machine-provable conditional branch.

Run:

```bash
python3 scripts/validate_contracts.py
```
