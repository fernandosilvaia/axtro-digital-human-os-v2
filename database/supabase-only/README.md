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
