# ADR-018: Regional control plane with isolated realtime workers and staged promotion

**Status:** Accepted for M0-M2 reference  
**Date:** 2026-07-14

## Context

The SaaS control plane, durable workflows and realtime media have different latency, scaling and failure characteristics. Premature microservices would slow the MVP, while one undifferentiated process would make media failures and deployments unsafe.

## Decision

Start as a modular monorepo with separately deployable applications: web/control API, realtime worker, workflow worker and meeting-bot worker. The control plane may begin as a modular application, while realtime and external meeting workers run in isolated processes with independent scaling and health checks. PostgreSQL is the transactional source of truth; Redis is ephemeral coordination only; object storage holds approved media artifacts.

Use dev, staging and production environments with migrations, feature flags, canary promotion, rollback and provider kill switches. Region selection is explicit and tenant policy can restrict where data and media are processed. Infrastructure remains reproducible through code before production launch.

## Alternatives considered

A single process for every workload; microservice per component from day one; provider-managed state as the primary database.

## Consequences

The MVP remains implementable without locking deployment boundaries. Realtime failures can degrade independently from the control plane.

## Revisit trigger

Measured load, region requirements, failure domains or team ownership justify a split or a different runtime.
