# SQLs Supabase-only (projeto hospedado `digital-human-os`)

Estes arquivos versionam objetos que existem **somente no projeto Supabase
hospedado** (`ovctadcrvnfpgxzplupp`, org Axtro AI) e ficam deliberadamente fora
de `database/migrations/`:

- Referenciam `auth.users`, `auth.uid()` e as roles `authenticated`/`anon`/
  `supabase_auth_admin`, que não existem no harness PostgreSQL local do
  monorepo (`scripts/database.mjs`).
- Incluí-los no contrato portátil quebraria o fingerprint exato de
  `CATALOG_ASSERTION_SQL` em `packages/database/src/migrations.ts`.

Racional completo: D-V2-055, D-V2-056 e D-V2-058 em
`docs/operations/DECISIONS_LOG.md`, e ADR-032.

## Estado

| Arquivo | Aplicado no projeto hospedado |
|---|---|
| `0001_catalog_read_policies.sql` | sim (2026-07-16) |
| `0002_user_tenant_memberships.sql` | sim (2026-07-16) |
| `0003_custom_access_token_hook.sql` | sim (2026-07-16) — a FUNÇÃO está publicada; o hook em si ainda precisa ser habilitado no dashboard (`Authentication > Hooks`), gate humano (D-V2-057) |
| `0004_provision_self_serve_tenant.sql` | sim (2026-07-16, atualizado com convites) |
| `0005_portal_rpcs.sql` | sim (2026-07-16) |
| `0006_tenant_invites.sql` | sim (2026-07-16) |
| `0007_portal_create_rpcs.sql` | sim (2026-07-16) |
| `0008_portal_ai_usage.sql` | sim (2026-07-16) |
| `0009_agent_video_config.sql` | sim (2026-07-16) |
| `0010_knowledge_ingestion_rag.sql` | sim (2026-07-17) |
| `0011_knowledge_revocation_video_costs.sql` | sim (2026-07-18) |
| `0012_portal_usage_summary.sql` | sim (2026-07-18) |
| `0013_rafaela_video_persona.sql` | sim (2026-07-19, via Management API `database/query`) |
| `0014_agent_activation.sql` | sim (2026-07-19, via Management API `database/query`) |
| `0015_rate_limits.sql` | sim (2026-07-20, via Management API `database/query`) |
| `0016_admin_emails_for_notifications.sql` | sim (2026-07-20, via Management API `database/query`) |
| `0017_rate_card.sql` | sim (2026-07-24, via Management API `database/query`) |
| `0018_agent_brain_config.sql` | sim (2026-07-27, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) |
| `0020_agent_video_config_presentation_kind.sql` | sim (2026-07-29, via MCP `apply_migration`) — corrigiu o acoplamento frágil antes do rename Aurora → Raissa (D-V2-086) |
| `0024_hardening_audit_fixes.sql` | sim (2026-08-02, via MCP `apply_migration`) — 'platform' fora do self-service, status terminal pegajoso, log de vídeo service (D-V2-100) |
| `0025_fix_cost_events_conversation_unit_type.sql` | sim (2026-08-03, via Management API `database/query`) — constraint verificada no banco vivo (inclui `'conversation'`). Fecha o achado crítico: log de custo de vídeo falhava silenciosamente desde 0011 e o teto diário nunca esteve ativo. Aplicada sob a autorização de execução autônoma do Fernando ("continue... até finalizar"), mesmo precedente das 0022-0024: correção de defeito confirmado em produção, aditiva, sem tocar em pagamento |
| `0026_tenant_subscriptions.sql` | sim (2026-08-03, via Management API `database/query`) — tabela `tenant_subscriptions` (RLS forçada, zero policies) + `portal_billing_status` + `portal_upsert_tenant_subscription_service`, tudo verificado no banco vivo. Aplicada junto da 0025 porque o código já na `main` (D-V2-101) fez `checkVideoCap` depender de `portal_billing_status` fail-closed — sem ela o deploy quebraria TODO fluxo de vídeo. Schema é inerte para dinheiro: nenhuma cobrança acontece sem as chaves Stripe, que seguem como **gate humano** (ver docs/NEEDS_CONNECTION.md) |
| `0027_knowledge_digest_and_cost_fidelity.sql` | sim (2026-08-05, via Management API `database/query`) — digest round-robin por fonte (antes: só o começo da fonte mais antiga), `portal_log_ai_usage` com `p_reported_cost_usd` (custo faturado real do OpenRouter → source `provider_reported`; DROP da assinatura antiga pra não criar overload ambíguo — o primeiro apply falhou exatamente nisso e a transação reverteu inteira), cost_event do bot Recall na gravação da sessão. Verificado no banco vivo: 1 função de cada (sem overload), assinatura nova confirmada |
| `0028_remove_member_and_meeting_notifications.sql` | sim (2026-08-06, via Management API `database/query`) — `portal_remove_member` (guarda contra remover o último admin e auto-remoção), `portal_list_admin_emails_service` (variante service-role de 0016, pro webhook do Recall notificar admins sem sessão de usuário), `portal_list_team` ganha `user_id` em cada membro (identificador estável pro botão de remover). Verificado no banco vivo: 1 função de cada, assinatura de portal_remove_member confirmada |
| `0029_conversation_transcripts.sql` | sim (2026-08-10, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — tabela + 5 RPCs de histórico de conversa (chat/vídeo/reunião externa, D-V2-106). Inclui as correções da revisão adversarial do mesmo dia (índice único global parcial, guarda de ambiguidade, `app.validate_transcript_turns`). Confirmado via `execute_sql`: tabela + índice + as duas RPCs de escrita chamando o validador |
| `0030_fix_row_count_boolean_type.sql` | sim (2026-08-10, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — corrige `portal_upsert_tenant_subscription_service` (0026): `GET DIAGNOSTICS` numa variável `boolean` quebrava com row_count >= 2 (confirmado ao vivo); inofensivo até aqui (upsert por tenant_id único sempre afeta 0 ou 1 linha) mas corrigido antes do primeiro webhook real da Stripe. Confirmado via `execute_sql` |
| `0031_cost_alert_dispatches.sql` | sim (2026-08-11, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — tabela `tenant_cost_alerts` + RPC `portal_claim_cost_alert_service` (dedup de envio, D-V2-107) + `portal_billing_status` ganha `tenant_id` no retorno (campo aditivo). Confirmado via `execute_sql`; advisor de segurança revisado, sem achado novo |
| `0032_search_knowledge_service.sql` | sim (2026-08-11, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — `portal_search_knowledge_service`, variante service-role de `portal_search_knowledge` (0010), fecha o gap de RAG no caminho de vídeo declarado desde D-V2-083 (D-V2-108). Confirmado via `execute_sql`: exposta só a `service_role`, não aparece no advisor `authenticated_security_definer_function_executable` |
| `0033_fix_reported_cost_reconciliation.sql` | sim (2026-08-11, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — corrige `portal_log_ai_usage` (branch `provider_reported`, 0027, já aplicada): `amount_usd`/`unit_cost_usd` eram arredondados independentemente, violando `cost_events_amount_reconciliation_check` em ~90% das chamadas reais (achado P0 da auditoria 2026-08-11). Confirmado via `execute_sql`: o padrão antigo não existe mais no corpo da função; advisor de segurança revisado, nenhum achado novo |
| `0034_conversation_transcript_deletion_and_purge.sql` | sim (2026-08-12, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — fecha achado P1 (onda 5): `conversation_transcripts` (0029) não tinha RPC de exclusão nem mecanismo de retenção/expurgo, apesar de `/privacidade` prometer exclusão sob pedido. Adiciona `portal_delete_conversation_transcript` (autenticada, tenant_admin), `portal_delete_conversation_transcript_service` (service-role, pro Fernando cumprir pedido por e-mail) e `portal_purge_old_conversation_transcripts_service` (service-role, parametrizada por dias, piso de segurança 30 dias — sem cron automático, período real é decisão de produto/jurídico pendente). Confirmado via `execute_sql`: as 3 RPCs existem; advisor de segurança revisado — as duas service-role NÃO aparecem em `authenticated_security_definer_function_executable`, confirmando que não estão expostas a `authenticated` |
| `0035_fix_ingest_knowledge_concurrency.sql` | sim (2026-08-12, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — fecha achado P1 (onda 5): `portal_ingest_knowledge` tinha o mesmo padrão check-then-act sem lock do achado já conhecido em `provision_self_serve_tenant` — duas re-ingestões concorrentes podiam criar 2 `knowledge_versions` "ativas" pra mesma fonte, quebrando o invariante "busca nunca mistura versões" e cobrando embeddings em dobro. `SELECT ... FOR UPDATE` na leitura do status da fonte, mesmo padrão já usado em `tenant_invites` (0004). Confirmado via `execute_sql`: `pg_get_functiondef` contém `FOR UPDATE` |
| `0036_knowledge_source_name_uniqueness.sql` | sim (2026-08-12, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — fecha achado P2 (onda 5): `portal_create_knowledge_source` não tinha nenhum UNIQUE constraint (diferente de `portal_create_agent`, protegido por `UNIQUE(tenant_id, name)`) — duplo-clique criava 2 fontes distintas com o mesmo nome. Verificado ao vivo antes de aplicar: zero duplicatas em produção; `UNIQUE(tenant_id, display_name)` + exception handler, mesmo padrão de `portal_create_agent` (0007). Confirmado via `execute_sql`: constraint presente em `pg_constraint` |
| `0037_fix_agent_status_concurrency.sql` | sim (2026-08-12, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — fecha achado P3 (auto-revisão da própria onda D-V2-114): `portal_set_agent_status` (0014) tinha o mesmo padrão check-then-act sem lock — duas ativações genuinamente concorrentes do mesmo agente podiam as duas retornar `changed:true`, reenviando o e-mail "Agente ativado" mesmo com o fix de `changed` em `resources.ts` já aplicado. Mesmo fix de `FOR UPDATE` de 0035. Confirmado via `execute_sql`: `pg_get_functiondef` contém `FOR UPDATE` |
| `0039_revoke_default_grants_rls_no_policy_tables.sql` | sim (2026-08-12, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — fecha achado P2 (onda 7, D-V2-116): 6 tabelas com RLS habilitada e zero policies (agent_brain_config, agent_video_config, conversation_transcripts, meeting_bot_sessions, tenant_cost_alerts, tenant_subscriptions) nunca revogaram o GRANT ALL padrão do Supabase pra anon/authenticated (confirmado ao vivo via `information_schema.role_table_grants` + `pg_default_acl`) — só `tenant_invites`/`user_tenant_memberships` fizeram isso desde o início. Seguro antes e depois (RLS+zero policy já nega tudo), é defesa-em-profundidade contra uma policy futura mal escrita valer imediatamente pra INSERT/UPDATE/DELETE também. Mesmo padrão de `revoke all on table ... from authenticated, anon, public` já usado em 0002/0006. Confirmado via `execute_sql`: zero linhas em `information_schema.role_table_grants` pra `anon`/`authenticated` nas 6 tabelas; advisor de segurança revisado — mesmo baseline de WARN/INFO já conhecidos, nenhum achado novo; RPCs SECURITY DEFINER dessas tabelas confirmadas funcionando (rodam como dono da função, não dependem do grant do caller) |
| `0038_checkbudget_service_aggregation.sql` | sim (2026-08-12, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — fecha achado P1 (onda 6, D-V2-115): `checkBudget` (rota `/api/brain/[agentId]/chat/completions`, chamada em TODO turno de vídeo) fazia scan sem índice de `cost_events` + soma em JS a cada requisição. Adiciona índice `cost_events_tenant_unit_type_occurred_at_idx (tenant_id, unit_type, occurred_at)` + RPC `portal_ai_tokens_today_service` (agregação SQL, service-role). Confirmado via `execute_sql`: índice presente em `pg_indexes`, RPC retorna `bigint` corretamente pra tenants reais; advisor de segurança revisado — a RPC NÃO aparece em `authenticated_security_definer_function_executable`, confirmando que não está exposta a `authenticated`, só a `service_role` |
| `0040_production_integrity_hardening.sql` | sim (2026-08-18, aplicação humana autorizada) — fase expand de M5-01: reservations duráveis de Tavus/Recall e IA, unknown barrier, estimates conservadores datados, activation com receipt durável e snapshot de billing no instante da entrega, outbox Stripe, reconciler leased, capability hash Tavus, dedup Recall, ownership service de transcript e capability v40. |
| `0041_provider_transcript_contract.sql` | sim (2026-08-18, aplicação humana autorizada) — fase contract de M5-01: bloqueia preclaim autenticado de refs de provider e eleva a capability intermediária para v41. |
| `0042_cost_event_schema_and_legacy_writer_contract.sql` | sim (2026-08-18, aplicação humana autorizada) — fase final do ledger M5-01: alinha `cost_events.schema_version` ao contrato `2.1.0`, revoga os três writers diretos legados e eleva a capability exigida para v42. |
| `0043_portal_runtime_bridge_contract.sql` | sim (2026-08-18, aplicação humana autorizada) — cria a admissão durável de canais, grants separados por consumidor Tavus/Recall/cena, recibos, kill switches auditados e reconciliação por dois operadores. `portal_schema_capabilities_service()` confirmou v43 antes deste reparo; a bridge segue desligada até o canário aprovado. |
| `0044_runtime_bridge_integrity_repair.sql` | sim (2026-08-18, aplicação humana autorizada) — reparo forward-only da bridge: o receipt deve reproduzir exatamente `provider_ref` e `provider_url` da reservation já committed, e o audit event de kill switch recebe FK composta `(tenant_id,kill_switch_id)`. `PORTAL_RUNTIME_BRIDGE_ENABLED` segue desligada até o canário aprovado. |
| `0045_drop_ambiguous_meeting_status_overload.sql` | sim (2026-08-18, aplicação humana autorizada) — corrige um bug real encontrado ao vivo em produção (investigação do P0 de media boundary): `portal_update_meeting_bot_session_status_service` existia em 2 overloads (2 args de 0021/0024, 4 args com defaults de 0040) — nunca deveria coexistir, e a chamada RPC de status não-terminal (sem `p_delivery_id`/`p_claim_token`) vinha ambígua desde que 0040 foi aplicada hoje: `ERROR 42725: function ... is not unique`, reproduzido diretamente contra produção. Todo webhook de status não-terminal do Recall (joining/in_call/waiting_room) estava falhando e caindo em retry, e a câmera Sentinel (Tavus relayado pro Recall) nunca anexava porque dependia do mesmo RPC. Removeu só o overload de 2 args — o de 4 args já é um superset comportamental exato pra chamada sem evidência de entrega. `portal_schema_capabilities_service()` confirmou v45 e `meetingBotStatusUpdateUnambiguous:true` logo depois. |
| `0046_provider_effect_termination_fence.sql` | sim (2026-08-18, aplicação humana autorizada) — cria lease/receipt durável para término autorizado por `tenant_admin`, mantendo referência do provider só no servidor. Aceitação Tavus revoga atomicamente a stage capability vinculada antes de concluir a reservation; a capability não pode ser recriada nem resolver URL depois do término. `portal_schema_capabilities_service()` confirmou v46 e `providerEffectTerminationFence:true` após a aplicação. |
| `0047_service_role_app_schema_usage.sql` | sim (2026-08-18, aplicação humana autorizada) — corrige a ACL que impedia o PostgREST de resolver parâmetros `app.uuid_v7` em RPCs `service_role`. Concede somente `USAGE` no schema `app` e no tipo `app.uuid_v7` à `service_role`; não concede tabela, função, nem privilégio novo a `anon`/`authenticated`. A capability confirmou v47/`serviceRoleAppSchemaUsage:true` e a probe PostgREST tipada, inerte, retornou 200. |
| `0048_tavus_stage_settlement_timestamp.sql` | sim (2026-08-18, aplicação humana autorizada) — reparo forward-only da corrida entre criação e mutação Tavus: settle, resolve e revoke capturam o relógio de parede depois de seus locks e mantêm `updated_at` monotônico no limite original `expires_at <= updated_at + 45 minutes`. Não alonga a capability, não enfraquece a constraint e preserva RLS/grants; `portal_schema_capabilities_service()` confirmou v48/`tavusStageExpiryConcurrencyFence:true`. |
| `0051_business_action_admission_and_leads.sql` | **não aplicada ainda** (implementação local, ADR-039 onda 1a, gate humano pendente, mesma disciplina de toda migration deste porte). Kill switches e configuração `auto_confirm_scheduling` por agente próprios do domínio (sem relação de código com `portal_runtime_*`), admissão do `BusinessActionIntent` (`portal_business_action_grants`, leitura read-only de `sessions.disclosure_status`/`consent_status`/`consent_evidence` já existentes, nunca escrita), `register_lead` idempotente por `(tenant_id, idempotency_key)` derivada do `command_fingerprint` do grant, e recibo (`portal_business_action_receipts`, um por grant). `propose_meeting_slots`/`confirm_meeting_slot`, as tabelas de proposta/reserva/conexão de calendário e toda RPC do Google Calendar listada em ADR-039 "Migração 0051" (renumerada: produção alcançou v50 por uma migration concorrente não relacionada antes desta ser mergeada) são onda 1b (0052) e deliberadamente ausentes. `PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED` (novo, independente de `PORTAL_RUNTIME_BRIDGE_ENABLED`) começa `false` em todo ambiente. Provado por `scripts/supabase-portal-integration.mjs` (`assertBusinessActionAdmissionAndLeads`) contra Postgres local; nunca aplicada ao projeto hospedado. |
| `0052_business_action_calendar_scheduling.sql` | **não aplicada ainda** (implementação local, ADR-039 onda 1b, gate humano pendente). Numeração com ressalva real: ADR-040 (Stripe Connect, ainda não implementada) também reserva 0052 — se a migration da ADR-040 mergear primeiro, esta precisa renumerar para 0053 (mesmo padrão de D-V2-145/146). Adiciona `portal_business_action_proposals`/`portal_business_action_proposal_slots` (versão durável do `Map` de `packages/tool-adapters/calendar/src/index.ts`, slots como linhas tipadas, nunca JSONB), `portal_business_action_calendar_reservations` (reserva durável `reserved → provider_in_flight → committed/unknown → completed/released`, estruturalmente paralela a `provider_effect_reservations` da 0040, nunca compartilhada; `google_event_id` gerado pelo servidor antes de qualquer chamada ao Google), `portal_business_action_calendar_connections` (custódia OAuth por tenant via Supabase Vault, só `vault_secret_id` opaco gravado, nunca o refresh token) e `portal_business_action_meeting_reconcile_approvals` (dual-approval de dois `tenant_admin` distintos para resolver uma reserva `unknown`, mesmo mecanismo de `portal_runtime_operator_approvals`/0043, mas também permite finalizar em `committed`, não só `released` — decisão de design documentada no corpo da migration). Widen aditivo de três CHECK constraints da 0051 (`action_kind` de `register_lead` para incluir `propose_meeting_slots`/`confirm_meeting_slot`, exatamente como o header da 0051 já anunciava) e republica `portal_admit_business_action_service`/`portal_business_action_status_service` com o allowlist maior mais o gate de consentimento `meeting_scheduling`. `portal_schema_capabilities_service()` sobe para v52. Provado por `scripts/supabase-portal-integration.mjs` (`assertBusinessActionCalendarScheduling`) contra Postgres local (inclui um stub mínimo do schema `vault` só para o harness, nunca usado em produção real); nunca aplicada ao projeto hospedado. |
| `0053_business_action_calendar_credential_read.sql` | **não aplicada ainda** (implementação local, ADR-039 onda 1b-iii, gate humano pendente). Fecha a lacuna que a 0052 deixou deliberada: nenhuma RPC lia de volta o refresh token OAuth decifrado do Google Calendar, então a aplicação nunca conseguia de fato chamar a API do Google (freebusy, inserir evento) depois de conectar. Adiciona só `portal_google_calendar_decrypted_refresh_token_service(p_tenant_id)`, `service_role`-only, primeira RPC deste repositório a expor um segredo decifrado: confirma `status='connected'` em `portal_business_action_calendar_connections` (nunca devolve o segredo de uma conexão `revoked`/`reauth_required`), lê `vault.decrypted_secrets` filtrando por `vault_secret_id` e devolve `{outcome:'found', refreshToken}` ou, para qualquer caso sem conexão ativa (nunca existiu, revogada, ou raça de desconexão concorrente), o mesmo `{outcome:'not_connected'}` declarado, sem exceção, sem log. Nenhuma tabela nova, nenhuma outra RPC deste domínio muda. `portal_schema_capabilities_service()` sobe para v53 com a chave nova `businessActionCalendarCredentialRead`. Provado por `scripts/supabase-portal-integration.mjs` (`assertBusinessActionCalendarCredentialRead`) contra Postgres local, incluindo um stub novo de `vault.decrypted_secrets` (coluna `decrypted_secret`, forma documentada publicamente pelo próprio Supabase Vault, nunca confirmada localmente antes desta migration, ver o comentário no início do arquivo da migration); nunca aplicada ao projeto hospedado. |
| `0054_business_action_live_call_context.sql` | **não aplicada ainda** (implementação local, ADR-041, gate humano pendente). Numeração confirmada: `0053` (onda 1b-iii, `portal_google_calendar_decrypted_refresh_token_service`) mergeou primeiro, então esta migration manteve o número `0054` sem precisar renumerar (mesmo padrão de D-V2-145/146/149). Uma única RPC nova, `portal_business_action_call_context_service(p_tenant_id,p_agent_id,p_idempotency_key)` — leitura pura, `STABLE`, `SECURITY DEFINER`, `service_role`-only, nenhuma tabela nova. Resolve `sessionId`/`presenterId`/`generation` de uma chamada já viva a partir da mesma reserva (`provider_effect_reservations`, por `idempotency_key`) que `startVideoConversation`/`stopVideoConversation` já usam, passando por `portal_runtime_provider_channel_receipts` e `portal_runtime_channel_bindings` (0043), sem nunca chamar `portal_admit_runtime_channel_service` de novo — é exatamente a peça que ADR-041 desenha para não recriar a dependência de `PORTAL_RUNTIME_BRIDGE_ENABLED` que ADR-039 evita. `presenterId` é lido fresco de `sessions.active_presenter_id`, nunca do `presenter_id` estático gravado no binding na admissão (o presenter pode ter mudado por handoff). Mesma disciplina anti-oráculo de `portal_get_sentinel_attach_service` (0043): idempotency_key desconhecida, `agentId` que não bate e sessão/binding ausentes colapsam todos no mesmo outcome `not_found`; sessão em status terminal (`completed`/`failed`, confirmado contra o CHECK de `public.sessions` em `database/migrations/0003_interaction_and_actions.sql`) devolve `session_terminal`. `portal_schema_capabilities_service()` sobe para v54. Provado por `scripts/supabase-portal-integration.mjs` (`assertBusinessActionLiveCallContext`) contra Postgres local: outcome `found` com presenter lido fresco (inclusive depois de um handoff simulado que nunca toca a coluna do binding), `agentId` incompatível, `idempotency_key` desconhecida, isolamento cross-tenant, sessão terminal nos dois valores (`completed` e `failed`), e que a RPC nunca é executável por `authenticated`/`anon`; nunca aplicada ao projeto hospedado. |
| `0055_business_action_email_length_bound.sql` | **não aplicada ainda** (implementação local, achado da revisão adversarial ADR-041, gate humano pendente). Fecha a única lacuna de TAMANHO no funil de tool-call de negócio: `contact_email`/`google_account_email` tinham só checagem de formato (regex), sem `char_length`, diferente de todos os outros campos de texto do mesmo domínio. Adiciona `char_length(...) <= 320` (RFC 5321 sec. 4.5.3.1.3, mesmo bound já usado pela camada de aplicação em `apps/portal/src/lib/google-calendar/id-token.ts`) a quatro CHECK constraints (`portal_business_action_leads_email_chk` da 0051, `portal_business_action_proposals_email_chk`, `portal_business_action_calendar_connections_email_chk` e `portal_business_action_calendar_reservations_email_chk` da 0052, padrão widen aditivo, nunca edita as migrations originais) e republica quatro RPCs `service_role`-only com a mesma checagem adicionada ao corpo: `portal_register_business_lead_service`, `portal_propose_business_meeting_slots_service`, `portal_reserve_business_meeting_slot_service` e `portal_connect_google_calendar_service` (esta última não estava na lista original do achado, mas tinha a mesma lacuna). Não altera comportamento além do bound de tamanho, nenhuma tabela nova, nenhuma coluna nova. `portal_schema_capabilities_service()` foi deliberadamente mantida em v52, sem chave nova. Provado por `scripts/supabase-portal-integration.mjs` (extensão de `assertBusinessActionAdmissionAndLeads`/`assertBusinessActionCalendarScheduling`) contra Postgres local, cobrindo um e-mail de 320 caracteres (não regride) e um de 321 (rejeitado pela RPC e, no caso de `portal_business_action_leads`, também pela CHECK constraint via INSERT direto); nunca aplicada ao projeto hospedado. |
| `0021_meeting_bot_sessions.sql` | sim (2026-07-30, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — tabela + 3 funções confirmadas via `execute_sql`, RLS forçada |
| `0022_agent_video_config_rpc.sql` | sim (2026-07-31, via Management API `database/query`) — RPC testada ao vivo provisionando a persona da Marina |
| `0023_cleanup_rpcs.sql` | sim (2026-07-31, via Management API `database/query`) — exclusão de rascunho de agente e de fonte revogada, testada no e2e |
| `0019_agent_brain_service_role_rpcs.sql` | sim (2026-07-27, via MCP `apply_migration`, autorizado explicitamente pelo Fernando). Confirmado via `execute_sql`: tabela + 5 funções presentes, RLS forçada. Advisor de segurança revisado — só os mesmos WARNs `authenticated_security_definer_function_executable` já aceitos para toda RPC `portal_*` deste projeto; nenhum problema novo. Ainda falta `SUPABASE_SERVICE_ROLE_KEY` no ambiente do portal (nunca configurada — Project Settings > API do Supabase) para o endpoint funcionar de ponta a ponta |

## Regras

- Aplicar via SQL editor do dashboard ou `apply_migration`/`execute_sql` (MCP).
- O harness `pnpm db:portal:test` aplica as migrations portáveis 0001-0011,
  cria stubs mínimos e sem privilégio excessivo para `auth.users`,
  `auth.uid()` e roles Supabase, e então executa toda a cadeia Supabase-only
  em PostgreSQL 17 efêmero/local. Isso é teste de compatibilidade, grants,
  RLS, concorrência e rollback; nunca substitui o apply remoto autorizado.
- O harness prova separadamente a compatibilidade expand de v40 (turn de
  transcript com extra-key legado ainda aceito), o contrato estrito de v41,
  o contrato final v42 do ledger, a bridge v43 e o reparo de integridade v44;
  também verifica que linhas M5 e históricas
  recebem `schema_version='2.1.0'` e que os três writers diretos revogados não
  podem escrever sob `anon`, `authenticated` ou `service_role`.
  também injeta uma falha no meio da 0040 e prova rollback transacional, executa
  concorrência real de cap/reserva e registro idempotente de transcript, fence
  set-once do callback Tavus, claim Recall, ordinal de overage no instante de
  activation, rollback cost+provider-ref, exclusão de fonte sem reter seu ID no
  recibo de IA e leases de billing/reconciliação. Nenhum lease libera um efeito
  externo ambíguo.
- A 0044 mantém todas as grants e revokes de v43, mas exige a identidade exata
  do recurso de provider antes de gravar um receipt e impede, por FK composta,
  que evidência de kill switch atravesse tenants. O harness prova actor/agente
  cross-tenant, conflito One Mouth, referência/URL incompatível sem receipt e
  rejeição da FK; a migration local nunca constitui aplicação hospedada.
- A 0045 remove o overload de 2 args de `portal_update_meeting_bot_session_status_service`
  que ficava ambíguo com o de 4 args (com defaults) introduzido em 0040 — o
  harness chama a RPC exatamente como o webhook do Recall chama (sem
  `p_delivery_id`/`p_claim_token`) e prova que resolve sem erro `42725`.
- A 0046 introduz recibos/leases duráveis de término de efeito: só
  `tenant_admin` autenticado e vinculado ao mesmo `actor_id` pode solicitar a
  operação; a RPC só devolve a referência do provider ao servidor depois de
  uma lease vencedora. O recibo aceito confirma apenas a aceitação pelo
  provider, não silêncio físico de mídia tardia.
- A 0047 é um reparo mínimo de visibilidade de schema/tipo para RPCs
  `service_role` via PostgREST. O harness reproduz a falha da chamada tipada
  antes do grant e prova a resposta inerte depois dele; ele também confirma
  que nenhum grant de tabela/função em `app` muda para `anon` ou
  `authenticated`.
- A 0048 torna os três writers de stage capability (settle, resolve e revoke)
  seguros contra uma transação que começou antes da criação concorrente. O
  harness força a ordenação de settle, exige a constraint de expiração intacta
  e confirma que nenhuma URL de stage permanece resolúvel.
- A 0051 (ADR-039 onda 1a, renumerada de 0049 porque produção já estava em v50 quando esta migration foi preparada para merge) é estruturalmente independente da bridge de canal
  (0043/0044): nenhuma tabela ou função referencia `portal_runtime_*`, e a
  admissão do `BusinessActionIntent` só lê `sessions.disclosure_status`/
  `consent_status`/`consent_evidence` já existentes, nunca escreve disclosure
  ou consentimento essencial (isso continua sendo responsabilidade exclusiva
  de `portal_admit_runtime_channel_service`). O harness prova: kill switch
  bloqueando `register_lead` só no tenant alvo; rejeição graciosa (sem
  persistir grant) por disclosure/consentimento essencial/`lead_data_capture`
  ausente e por presenter mismatch; replay idempotente da admissão; e
  idempotência de `register_lead` por `(tenant_id, idempotency_key)`: duas
  chamadas contra o mesmo grant devolvem o mesmo lead, nunca criam um
  segundo. `propose_meeting_slots`/`confirm_meeting_slot` e todo o domínio de
  calendário (proposta, reserva, conexão OAuth) ficam para uma migration
  própria da onda 1b.
- A 0052 (ADR-039 onda 1b) nunca chama o Google de verdade: `propose_meeting_slots_service`
  persiste só o que a aplicação já calculou, `reserve_business_meeting_slot_service`
  gera o `google_event_id` no servidor antes de qualquer chamada, e commit/
  release/reconcile só gravam o que a aplicação (fora desta migration) já
  obteve do provider. Um índice único parcial em `(tenant_id,slot_id) where
  state<>'released'` fecha a corrida de duas confirmações concorrentes pelo
  mesmo horário no próprio banco, nunca só num `exists`-check da aplicação.
  `portal_reconcile_business_meeting_reservation_service` é a única RPC que
  também escreve receipt no caminho `unknown`, e só quando dois `tenant_admin`
  distintos concordam na mesma evidência/resultado — o mesmo operador
  aprovando duas vezes nunca avança a contagem. O harness prova todo o ciclo:
  conexão (connect/reconnect com rotação de segredo no Vault/disconnect),
  proposta idempotente, reserva com conflito de slot, fence
  `reserved → provider_in_flight → committed`, release só pré-dispatch,
  `mark_unknown`, e reconciliação dual-operador terminando tanto em
  `committed` quanto em `released` (dois operadores concordando, nunca o
  mesmo operador duas vezes), além de isolamento cross-tenant e de o segredo
  bruto nunca aparecer em nenhuma leitura da tabela de conexões.
- A 0053 (ADR-039 onda 1b-iii) é a primeira migration deste repositório a
  expor um segredo decifrado por uma RPC. `portal_google_calendar_decrypted_refresh_token_service`
  é `service_role`-only, nunca loga nada e nunca deixa a mensagem de erro
  distinguir "tenant sem conexão" de "conexão revogada/reauth_required" de
  "raça de desconexão concorrente": todo caso sem credencial ativa devolve o
  mesmo `{outcome:'not_connected'}`, sem exceção. O harness prova as quatro
  coisas que importam: tenant nunca conectado, tenant com conexão `revoked`
  (nunca vaza o segredo de uma conexão morta), o roundtrip write/read exato
  contra o valor gravado por `portal_connect_google_calendar_service` no
  mesmo teste, e que `authenticated`/`anon` seguem sem EXECUTE nessa RPC. O
  stub local de `vault.decrypted_secrets` (coluna `decrypted_secret`) segue a
  forma pública documentada pelo Supabase Vault, nunca confirmada contra o
  projeto hospedado antes desta migration.
- A 0054 (ADR-041) é leitura pura: nenhuma tabela nova, nenhuma escrita, uma
  única RPC (`portal_business_action_call_context_service`) que junta
  `provider_effect_reservations` (0040) → `portal_runtime_provider_channel_receipts`
  → `portal_runtime_channel_bindings` (0043) → `sessions` por
  `(tenant_id,idempotency_key)`, nunca chamando `portal_admit_runtime_channel_service`
  de novo. O harness prova que o presenter devolvido reflete um handoff
  simulado (`sessions.active_presenter_id` mudou depois da admissão) mesmo
  com o `presenter_id` do binding intocado, que `agentId` incompatível e
  `idempotency_key` desconhecida colapsam no mesmo `not_found`, isolamento
  cross-tenant, os dois valores terminais de `sessions.status`
  (`completed`/`failed`) devolvendo `session_terminal`, e que a RPC nunca é
  executável por `authenticated`/`anon`.
- Os RPCs M5-01 de provider, webhook, billing e reconciliação são somente
  `service_role`. As tabelas de controle/recibo também revogam DML direto da
  própria `service_role`; o acesso é exclusivamente pelas RPCs SECURITY DEFINER.
  As mutações de AI reservation são igualmente service-only e recebem tenant
  explícito depois da autorização no servidor.
- A 0041 revoga os dois writers autenticados legados capazes de preclaim de
  referência de provider: transcript de vídeo/reunião e sessão de bot Recall.
  As respectivas capabilities precisam estar `true` antes de liberar tráfego.
- A 0042 preserva a fronteira final do ledger: `portal_log_ai_usage`,
  `portal_log_video_usage` e `portal_log_video_usage_service` permanecem
  revogados para todas as roles expostas. Efeitos novos devem passar somente
  pelos writers M5 reservation-backed, que recebem a versão `2.1.0` pelo
  default imutável de `cost_events`.
- `provider_effect_reservations.related_ref` aceita somente referência opaca e
  limitada; URLs de reunião permanecem no registro operacional tenant-scoped e
  nunca são copiadas para o recibo financeiro durável. O outbox reutiliza o
  `cost_event_id` UUIDv7 criado pela aplicação como sua identidade 1:1.
- Checkout de assinatura usa `billing_checkout_intents`: uma única tentativa
  aberta por tenant, idempotency key estável e sessão Stripe vinculada antes do
  redirect. A 0041 revoga o writer last-write-wins legado; evento de uma
  assinatura superseded nunca substitui outra assinatura ativa.
- `portal_usage_summary` preserva os campos históricos durante o cutover e
  acrescenta totais tenant-scoped de hoje/7d que somam `amount_usd` de todo o
  ledger (inclusive Tavus e Recall), com precisão explicitamente mista.
- A reserva Tavus usa o maior overage CVI publicado encontrado em
  2026-08-13, USD 0,37/minuto, arredondando cada minuto iniciado. A página
  pública possui valores conflitantes; a tarifa real da conta deve ser
  reconciliada com dashboard/invoice e nunca tratada como custo medido.
- Toda alteração aqui deve ser reaplicada no projeto hospedado no mesmo PR e
  anotada na tabela acima.
- Advisor do Supabase: os WARNs `authenticated_security_definer_function_executable`
  nas funções `portal_*`/`provision_self_serve_tenant` são intencionais — essas
  RPCs são a API do portal; cada uma valida `auth.uid()` e resolve o tenant
  exclusivamente via `user_tenant_memberships`.
