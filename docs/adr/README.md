# Architecture Decision Records

Accepted decisions for V2. The Constitution has precedence. A change to an accepted decision requires a new superseding ADR rather than silent editing.

| ADR | Decision | Status |
|---|---|---|
| `ADR-001-modular-monorepo.md` | Modular monorepo for the control plane | Accepted |
| `ADR-002-dual-mode-realtime.md` | Dual-mode realtime conversation path | Accepted |
| `ADR-003-livekit-native-room.md` | LiveKit-compatible native room boundary | Accepted with benchmark gate |
| `ADR-004-one-mouth-floor.md` | One Mouth Rule and atomic presenter floor | Accepted |
| `ADR-005-session-state-timeline.md` | Structured session state with append-only timeline | Accepted |
| `ADR-006-perception-evidence.md` | Evidence-based multimodal perception | Accepted |
| `ADR-007-behavior-scene-directors.md` | Deterministic behavior and scene directors | Accepted |
| `ADR-008-axtro-control-plane.md` | Axtro Agent outside the critical media path | Accepted |
| `ADR-009-multitenancy-rls.md` | Tenant isolation with forced RLS and composite references | Accepted |
| `ADR-010-action-runtime-receipts.md` | Governed action runtime and receipts | Accepted |
| `ADR-011-events-workflows.md` | Transactional outbox separated from durable workflows | Accepted |
| `ADR-012-provider-bakeoff.md` | Provider adapters and evidence-based bake-off | Accepted |
| `ADR-013-uuid-vector.md` | Application UUIDv7 and provider-agnostic vector dimensions | Accepted |
| `ADR-014-codex-execution.md` | Codex-first implementation with repository-native gates | Accepted |
| `ADR-015-consent-disclosure.md` | Purpose-specific consent and persistent AI disclosure | Accepted |
| `ADR-016-data-retention-deletion.md` | Purpose-bound retention and verifiable deletion | Accepted |
| `ADR-017-observability-otel.md` | OpenTelemetry-correlated observability | Accepted |
| `ADR-018-deployment-topology.md` | Regional deployment topology and staged promotion | Accepted for M0-M2 |
| `ADR-019-relational-tenancy-and-floor-integrity.md` | Forward-only repair of composite session references and optional session deletion | Accepted |
| `ADR-020-application-ingress-and-egress-baseline.md` | Fail-closed application ingress and adapter egress baseline | Accepted for M0-M1 |
| `ADR-021-cost-ledger-reconciliation.md` | Deterministic append-only cost attribution and reconciliation | Accepted |
| `ADR-022-session-lifecycle-command-boundary.md` | Framework-neutral lifecycle commands, atomic event batches and HTTP idempotency | Accepted |
| `ADR-023-session-actor-mailbox-projection.md` | Session Actor mailbox as a canonical-event projection | Accepted |
| `ADR-024-textual-turn-driver.md` | Canonical textual turn driver with fenced Presenter responses | Accepted |
| `ADR-025-bounded-context-composer.md` | Bounded context composition with provenance and TTL | Accepted |
| `ADR-026-receipt-backed-catalog-lookup.md` | Receipt-backed catalog lookup outside the Fast Lane | Accepted |
| `ADR-027-authoritative-session-timeline-replay.md` | Authoritative session timeline and replay verification | Accepted |
| `ADR-028-bounded-outbox-relay-and-idempotent-timeline-consumer.md` | Bounded outbox relay and idempotent timeline consumer | Accepted |
| `ADR-029-checkpointed-post-call-workflow-fake.md` | Checkpointed post-call workflow fake | Accepted |
| `ADR-030-framework-neutral-operations-console.md` | Framework-neutral read-only operations console | Accepted |
| `ADR-031-knowledge-and-rag-retrieval.md` | Tenant-scoped knowledge retrieval as a pure port over an in-memory store | Accepted |
| `ADR-032-user-session-tenant-mapping.md` | Human user sessions map to tenant context via a signed JWT claim, never a header | Accepted |
- [ADR-033](ADR-033-openrouter-text-generation.md) — OpenRouter como primeiro provider real (port de texto do control-plane)
- [ADR-034](ADR-034-tavus-personas-per-agent-video.md) — Persona Tavus por agente (voz BR, percepção, interrupção) + config de vídeo tenant-scoped
- [ADR-035](ADR-035-percepcao-emocional-profunda.md) — Percepção emocional profunda como capacidade central (emenda o Art. 4 da Constituição)
- [ADR-036](ADR-036-durable-provider-effect-reservations.md) — Reservas duráveis, barreira de resultado desconhecido e outbox de cobrança para efeitos pagos
- [ADR-037](ADR-037-cost-event-conversation-unit.md) — CostEvent 2.1.0 para a unidade comercial fechada `conversation`
- [ADR-038](ADR-038-portal-channel-runtime-bridge.md) — Bridge durável dos canais Portal para sessão, consentimento, floor, cenas e receipts
- [ADR-039](ADR-039-portal-business-action-bridge.md) — Bridge de ações de negócio do Portal (agendar reunião via Google Calendar, registrar lead) sob o funil do Art. 7, independente do flag do ADR-038
- [ADR-040](ADR-040-closer-checkout-stripe-connect.md): checkout do cliente final do tenant via Stripe Connect Standard (cobrança direta), quarta ação do `BusinessActionIntent` do ADR-039, catálogo fechado por tenant e reserva durável no padrão do ADR-036. Autonomia da geração do link ainda depende de decisão do dono do produto.
