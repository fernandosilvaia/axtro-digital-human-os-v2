# ADR-009: Tenant isolation with forced RLS and composite references

**Status:** Accepted  
**Date:** 2026-07-14

## Context

The SaaS will host company knowledge, contacts, recordings and sales data. Application filters alone are insufficient.

## Decision

Every tenant-owned table carries tenant_id, forced RLS and composite foreign keys. Authentication maps identity to allowed tenant before transaction-local context is set. Global catalogs are explicitly separate and privileged.

## Alternatives considered

Database per tenant immediately; application-only filtering.

## Consequences

Strong shared-database isolation with disciplined tests and pool context handling.

## Revisit trigger

Enterprise residency or contractual isolation can add dedicated deployments without weakening the shared model.
