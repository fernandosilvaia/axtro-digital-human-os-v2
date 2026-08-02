# Baseline de auditoria — 2026-08-02

> Estado REAL medido antes de qualquer alteração da rodada de hardening
> autônomo (prompt mestre, sessão 2026-08-02). Nenhum número abaixo é
> estimativa: todos vêm de execução local ou chamada HTTP real.

## Gates de engenharia (executados nesta máquina)

| Gate | Comando | Resultado |
|---|---|---|
| Testes Node | `pnpm test` | **515/515 verdes** |
| Testes Python | (mesma suíte) | **26/26 verdes** |
| Typecheck | `pnpm typecheck` (tsc --build --force) | limpo |
| Lint | `pnpm lint` | limpo (boundaries + whitespace) |
| Validadores canônicos | `python3 scripts/validate_all.py` | **9/9 verdes** (47 schemas, 42 tabelas, secret scan, dependency scan sem high/critical) |
| Build de produção do portal | `npx next build` | ✓ 18/18 páginas, sem erro |
| E2E Playwright | `apps/portal/e2e/portal.spec.ts` | 17 testes no spec; roda em CI a cada PR/push (D-V2-096, destravado em D-V2-098) — não re-executado localmente nesta baseline |

## Produção (medida por HTTP real em 2026-08-02)

| Verificação | Resultado |
|---|---|
| `https://closer.axtroai.com/api/health` | `ok: true`; supabase_url ✓, language_provider ✓, video_provider ✓, email_provider ✓, fake_providers off |
| Landing `https://closer.axtroai.com/` | HTTP 200 |
| Domínio custom | closer.axtroai.com verificado, certificado válido (Railway) |

## Estado do repositório

- Branch `main`, working tree limpo (único churn: `next-env.d.ts`, artefato de build revertido).
- HEAD `77157d3` — as ondas D-V2-091..099 (auto-provisão de vídeo, teto de custo, exclusão de agente/fonte, páginas legais, e2e em CI, domínio próprio, HMAC no webhook Recall) já estavam mergeadas antes desta rodada.

## Migrations aplicadas no Supabase real

0001–0021 supabase-only aplicadas (ver `database/supabase-only/README.md`), incluindo `agent_brain_config` (0018/0019), `presentation_kind` (0020) e `meeting_bot_sessions` (0021).

## Limitações conhecidas na largada (honestas, herdadas)

- RAG real não ligado no caminho do cérebro customizado (`/api/brain` retorna conhecimento vazio — gap declarado D-V2-083).
- Custo de vídeo é registrado como PISO por conversa, não duração real (D-V2-078).
- Nenhuma persona Tavus real aponta pro cérebro customizado (`layers.llm.base_url`) — decisão humana pendente.
- Bake-off formal de providers segue pendente (D-V2-048).
