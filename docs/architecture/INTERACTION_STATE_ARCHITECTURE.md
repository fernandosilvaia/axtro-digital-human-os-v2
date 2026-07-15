# Interaction State Architecture

## Agregados

### InteractionSessionState
Identidade, lifecycle, presenter, channel, versions, consent, health, degradation e referências para subestados.

### ConversationState
Turnos, resumo incremental, tópicos, entidades confirmadas, perguntas abertas, idioma e repair state.

### RoleState
Estado genérico de objetivo, milestones, missing fields, next best action e role pack version.

### SalesState
Extensão do Sales Closer Pack. Não é obrigatório para outros papéis.

### InteractionQualityState
Dimensões independentes, nunca um trust score opaco:
- clarity;
- explicit_interest;
- engagement;
- resistance;
- urgency;
- next_step_readiness;
- relationship_continuity;
- system_confidence.

Cada dimensão possui valor normalizado, confidence, evidence refs, rationale curta e `updated_at`.

## Event sourcing pragmático

Timeline é append-only e snapshots são caches reconstruíveis. Não precisamos aplicar event sourcing a toda a plataforma, apenas ao aggregate de sessão onde replay e auditoria têm valor alto.

Em M1, `@axtro/events` mantém o writer tenant-scoped e bounded. A identidade
canônica usa `event_id` mais fingerprint do envelope, além da versão única por
sessão. Redelivery idêntico é idempotente; conflito de identidade, gap,
duplicata ou inversão falha antes de mutar a timeline.

O contrato `session_state_snapshot` cobre o aggregate completo, não apenas o
lifecycle. O repository só o materializa a partir do replay da própria timeline
e retém o snapshot como cache substituível. `@axtro/session-runtime` verifica o
replay desde zero contra uma leitura separada de snapshot mais tail e só então
publica o estado no Actor. O Actor continua sem porta de escrita para timeline,
snapshot ou outbox.

## Reducers

Reducers são funções puras:

```text
new_state = reduce(old_state, domain_event)
```

Mutações propostas por LLM são convertidas em comandos e validadas antes de gerar evento.

## Versão e compatibilidade

- `schema_version` em estado e eventos.
- Upcasters leem versões antigas.
- Writers só emitem versão atual.
- Mudança breaking exige migration de snapshots ou rebuild por timeline.

## Evidência

Campos inferidos nunca substituem fatos confirmados. Use classificação:
- `explicit_user_statement`;
- `tool_verified`;
- `knowledge_source`;
- `derived_hypothesis`;
- `operator_input`.

## TTL

Sugestões, hipóteses e specialist results expiram. Fatos confirmados não expiram automaticamente, mas podem ser marcados stale por source version.
