# Checklist para o próximo agente (ou próxima sessão)

**Atualizado:** 2026-07-16 · **Branch de trabalho:** `feat/portal-operational-screens`

## Antes de qualquer coisa

1. Leia `AGENTS.md` (fonte normativa), `RISCOS_E_PENDENCIAS.md` e os últimos blocos de `PROGRESS.md` e `docs/operations/DECISIONS_LOG.md` (D-V2-055 a D-V2-059).
2. O projeto Supabase real é `digital-human-os` (`ovctadcrvnfpgxzplupp`, org Axtro AI). As credenciais do portal estão em `apps/portal/.env.local` (não versionado; modelo em `.env.example`).
3. Rode a pipeline completa antes de mudar qualquer coisa: `pnpm lint && pnpm typecheck && pnpm test && python3 scripts/validate_all.py` e, no portal, `pnpm --filter @axtro/portal run typecheck && pnpm --filter @axtro/portal run build`.

## Estado atual do portal (`apps/portal`)

- Next.js 16 + `@supabase/ssr`; auth real (signup/login/logout/confirmação) funcionando contra o Supabase.
- Telas: `/dashboard` (overview com métricas reais), `/agentes` e `/conhecimento` (listas read-only com empty states), `/configuracoes` (edição real do perfil do tenant, restrita a `tenant_admin`).
- Dados via RPCs `SECURITY DEFINER` (`portal_tenant_overview`, `portal_list_agents`, `portal_list_knowledge_sources`, `portal_update_tenant_profile`) — ver D-V2-058.
- Provisionamento self-serve idempotente dentro de `fetchTenantOverview` (D-V2-059 explica por quê).

## Trabalho natural de continuação (em ordem sugerida)

1. **Habilitar o Auth Hook** (gate humano, D-V2-057) e então testar login real com claims (`app_metadata.tenant_id`) — depois disso, considerar migrar leituras do portal para RLS-por-claim.
2. ~~Versionar os SQLs Supabase-only~~ — **feito 2026-07-16**: `database/supabase-only/0001..0006` + README com estado de aplicação.
3. ~~Convites/multiusuário por tenant~~ — **feito 2026-07-16** (D-V2-060): seção Equipe em Configurações, RPCs `portal_invite_member`/`portal_list_team`/`portal_revoke_invite`, provisionamento honra convite pendente. Sem envio de e-mail (modelo e-mail pré-aprovado); e-mail de convite de verdade depende de SMTP próprio.
4. ~~Recuperação de senha~~ — **feito 2026-07-16** (D-V2-061): `/recuperar-senha` + `/nova-senha`; trecho e-mail→link só é exercitável com SMTP próprio configurado.
5. **Configurar SMTP próprio** no Supabase (Auth > SMTP) — o builtin estourou rate limit durante os testes; bloqueia confirmação de signup e recuperação de senha em qualquer uso real.
6. ~~Telas de criação de agente/fonte~~ — **feito 2026-07-16** (D-V2-062): criação de agente `draft` e fonte `pending` no portal (admin-only, limites por tenant). **Ativação de agente e ingestão de conteúdo** continuam dependendo de provedores conectados — essa é a próxima fronteira real.
7. ~~Deploy~~ — **feito 2026-07-16, autorizado explicitamente pelo Fernando**: portal NO AR em https://portal-production-b43e.up.railway.app (Railway, projeto `axtro-digital-human-os`, login real testado em produção). Runbook e armadilhas de build em `docs/operations/DEPLOY_PORTAL.md`. Pós-deploy pendente no dashboard do Supabase: Site URL/redirect, SMTP próprio, Auth Hook.

## Regras que esta fase respeita (não regredir)

- Nenhuma chave real de provider no código, `.env` versionado ou logs; secret scan (`python3 scripts/secret_scan.py`) precisa passar.
- Repo é público: `LICENSE` proprietária, nada de dados reais de cliente em commits.
- `database/migrations/` continua sendo o contrato portátil — nada que referencie `auth.users` entra lá.
- Toda decisão não óbvia vai para `docs/operations/DECISIONS_LOG.md` com ID `D-V2-NNN` sequencial.
