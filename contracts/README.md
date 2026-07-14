# Contracts

This directory contains the **36 normative JSON Schemas** for Axtro Digital Human OS V2.

- Draft: JSON Schema 2020-12
- Every object is closed with `additionalProperties: false`.
- Every schema has one valid and one deliberately invalid example.
- Arbitrary provider payloads are carried as canonical JSON strings and must be validated against the referenced tool/provider schema before use.
- Breaking changes require a new schema version and an upcaster or migration plan.

Run:

```bash
python3 scripts/validate_contracts.py
```
