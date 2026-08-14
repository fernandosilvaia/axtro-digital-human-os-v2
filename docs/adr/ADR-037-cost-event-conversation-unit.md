# ADR-037: Version the CostEvent conversation unit

**Status:** Accepted  
**Date:** 2026-08-13  
**Supersedes:** only the `CostEvent` wire-version statement in ADR-021  
**Related:** ADR-021, ADR-036

## Context

The portal has billed and capped a video interaction as one commercial
conversation since D-V2-101. The database admitted this value, but the public
closed `CostEvent.unit_type` enum did not. Adding `conversation` while retaining
`schema_version: 2.0.0` would make an old closed-schema consumer reject a value
that claimed to belong to the unchanged contract.

## Decision

`CostEvent` advances independently to schema version `2.1.0` and adds the
closed unit value `conversation`. All other contracts remain at their existing
versions. Generated TypeScript/Python types, examples and the costing writer
must emit 2.1.0 together. The validator accepts an explicit semantic v2 version
per schema instead of forcing every unrelated contract to 2.0.0.

This is an additive enum revision for upgraded consumers, but it is not wire
compatible with a strict 2.0.0 consumer. Producers must not label a
`conversation` event as 2.0.0. Historical 2.0.0 records remain immutable and
readable by storage/query paths; a consumer that exchanges the JSON contract
must advertise/upgrade to CostEvent 2.1.0 before receiving the new unit.

## Consequences

The commercial unit is represented honestly and generated clients can reject
unknown future units without accepting silent drift. Contract versions may now
evolve per schema, while the repository remains inside the v2 API family.
