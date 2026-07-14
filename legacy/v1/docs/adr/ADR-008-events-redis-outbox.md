# ADR-008 — Eventos: outbox transacional + Redis Streams no MVP; NATS JetStream na F3
**Status:** Aceito · 2026-07-13
**Contexto:** Precisamos de eventos confiáveis (pós-call jobs, Axtro Agent, webhooks) sem montar Kafka para 1 pessoa. Consistência com o banco é crítica (não perder `session.ended`).
**Decisão:** Padrão outbox: eventos gravados na mesma transação Postgres (`events_outbox`), relay publica em Redis Streams (Upstash) com consumer groups + DLQ simples; envelope normativo (`event_envelope.schema.json`). Migração planejada para NATS JetStream na F3 (retenção, replay e fan-out melhores) mantendo envelope e nomes.
**Alternativas rejeitadas:** Kafka/Redpanda (ops desproporcional); publicar direto sem outbox (dual-write, perda de evento); Supabase Realtime como barramento (não é fila com ack).
**Consequências:** + confiabilidade transacional com stack mínima; troca futura barata (envelope estável). − Redis Streams tem limites de retenção/replay (aceitos no MVP e documentados).
