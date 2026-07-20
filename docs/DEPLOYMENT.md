# DEPLOYMENT

**Runbook canônico:** `docs/operations/DEPLOY_PORTAL.md` (Railway, armadilhas de build).
Este arquivo é o resumo operacional.

## Produção

- **Plataforma:** Railway, projeto `axtro-digital-human-os` → https://portal-production-b43e.up.railway.app
- **Trigger:** auto-deploy de todo push na `main` (merge de PR = deploy).
- **Build:** Railpack com provider node forçado (`railpack.json`); `pnpm --filter @axtro/portal run build`.
- **Health:** `GET /api/health` — flags booleanas de configuração, sem segredos.

## Variáveis de ambiente (Railway → Variables)

| Variável | Obrigatória | Fonte |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | sim | projeto `digital-human-os` |
| `OPENROUTER_API_KEY` (+`OPENROUTER_MODEL`) | sim (chat/RAG) | Doppler `axtro-human-digital-os` |
| `TAVUS_API_KEY` / `TAVUS_REPLICA_ID` | sim (vídeo) | Doppler |
| `RESEND_API_KEY` | recomendada (e-mail de convite) | Doppler — **pendente em produção** |
| `PORTAL_PUBLIC_URL` | opcional | URL pública |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | opcional (acesso demo 1-clique) | Doppler |
| `PORTAL_FAKE_PROVIDERS` | nunca em produção | — |

## Banco (Supabase `ovctadcrvnfpgxzplupp`)

- Migrations portáveis: `database/migrations/` (aplicadas).
- Supabase-only: `database/supabase-only/0001..0014` — estado de aplicação no README da pasta. Nova migration = aplicar no live no mesmo PR (Management API `database/query` com token do CLI, procedimento D-V2-063).
- Rollback: migrations supabase-only são aditivas (`create or replace` / inserts idempotentes); reverter = aplicar o inverso documentado no próprio arquivo.

## Smoke pós-deploy

1. `curl /api/health` → `ok:true` e checks esperados.
2. Login demo → dashboard carrega métricas.
3. `/agentes` → botão Testar abre chat; resposta chega.
