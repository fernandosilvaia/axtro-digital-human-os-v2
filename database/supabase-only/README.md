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
| `0021_meeting_bot_sessions.sql` | sim (2026-07-30, via MCP `apply_migration`, autorizado explicitamente pelo Fernando) — tabela + 3 funções confirmadas via `execute_sql`, RLS forçada |
| `0022_agent_video_config_rpc.sql` | sim (2026-07-31, via Management API `database/query`) — RPC testada ao vivo provisionando a persona da Marina |
| `0023_cleanup_rpcs.sql` | sim (2026-07-31, via Management API `database/query`) — exclusão de rascunho de agente e de fonte revogada, testada no e2e |
| `0019_agent_brain_service_role_rpcs.sql` | sim (2026-07-27, via MCP `apply_migration`, autorizado explicitamente pelo Fernando). Confirmado via `execute_sql`: tabela + 5 funções presentes, RLS forçada. Advisor de segurança revisado — só os mesmos WARNs `authenticated_security_definer_function_executable` já aceitos para toda RPC `portal_*` deste projeto; nenhum problema novo. Ainda falta `SUPABASE_SERVICE_ROLE_KEY` no ambiente do portal (nunca configurada — Project Settings > API do Supabase) para o endpoint funcionar de ponta a ponta |

## Regras

- Aplicar via SQL editor do dashboard ou `apply_migration`/`execute_sql` (MCP).
- Nunca aplicar no harness local — os arquivos assumem o schema das migrations
  portáveis (`app.uuid_v7`, `public.tenants`, ...) mais a camada de auth do
  Supabase.
- Toda alteração aqui deve ser reaplicada no projeto hospedado no mesmo PR e
  anotada na tabela acima.
- Advisor do Supabase: os WARNs `authenticated_security_definer_function_executable`
  nas funções `portal_*`/`provision_self_serve_tenant` são intencionais — essas
  RPCs são a API do portal; cada uma valida `auth.uid()` e resolve o tenant
  exclusivamente via `user_tenant_memberships`.
