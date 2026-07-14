# API Design

## Style

REST Control Plane with OpenAPI 3.1. Realtime media uses WebRTC/SIP/provider protocols. Domain events use AsyncAPI 3.0.

## Conventions

- prefix `/v1`;
- UUIDv7 identifiers;
- `Idempotency-Key` for mutating requests;
- `X-Tenant-Id` accepted only for service identities and validated against claims;
- opaque pagination cursor;
- RFC 9457 style problem details;
- ETag or version precondition for configuration updates;
- request and trace IDs in response headers.

## Core resources

- tenants and service identities;
- agents and deployments;
- role packs and skill packs;
- sessions and timeline;
- consents and disclosures;
- action intents, approvals and receipts;
- handoffs;
- provider capabilities;
- evaluation runs and promotions.

## Realtime control

Session token endpoint returns short-lived channel token and pinned deployment metadata. Provider secrets never go to browser.

## Webhooks

- signed with rotation-aware keys;
- timestamp and replay window;
- idempotent delivery IDs;
- retries with exponential backoff;
- tenant-scoped endpoint configuration;
- no sensitive payload unless explicitly enabled.

## Contract source

`contracts/openapi/axtro-api.yaml` is source for generated clients. Prose cannot override it silently.
