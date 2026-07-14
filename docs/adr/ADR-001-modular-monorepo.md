# ADR-001: Modular monorepo for the control plane

**Status:** Accepted  
**Date:** 2026-07-14

## Context

The first implementation needs shared contracts, coordinated refactors and a small team of coding agents. Premature service boundaries would multiply deployment and consistency work.

## Decision

Use a pnpm and uv monorepo. Keep the API and control-plane modules in one deployable application initially. Run realtime worker, meeting bot and Axtro daemon as separate processes because their runtime and scaling profiles differ.

## Alternatives considered

Independent microservices from day one; a single undifferentiated application.

## Consequences

Clear package boundaries and ownership are mandatory. Split a module into a service only after measured scaling, isolation or deployment pressure.

## Revisit trigger

A module repeatedly requires independent scaling or failure isolation and the contract is stable.
