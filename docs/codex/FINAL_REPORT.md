# Relatório final — Auditoria 360

**Data:** 2026-08-18  
**Escopo:** M5-03 e as correções de integridade, observabilidade e discovery encontradas na auditoria.  
**Decisão:** código local concluído e verificável; nenhuma promoção de provider, migration remota, alteração de segredo, deploy, commit ou push foi executado.

## Resultado

- A descoberta pública passou a usar o domínio canônico `https://closer.axtroai.com` de forma coerente em metadata, sitemap, robots e arquivos `llms`.
- Termos e privacidade agora são indexáveis com canonical e metadata próprios; copy de preços e privacidade não promete reunião externa ou retenção de transcript sem a finalidade/consentimento correspondente.
- Um E2E Playwright público sem credenciais tornou o output do App Router um gate de CI: desktop/mobile, metadata, JSON-LD, foco de teclado, overflow, sitemap, robots e `llms`.
- A bridge de runtime reforçou a separação entre correlação externa e IDs autoritativos, receipts exatos de provider e integridade tenant/kill switch via a migration local `0044`.
- O harness PostgreSQL agora prova recusas cross-tenant, disputa concorrente de Presenter e recibos negativos, em vez de só confirmar o caminho feliz.
- Telemetria redige recursivamente PII/segredos e impede que contexto não confiável sobrescreva os campos de evento e erro.

## Evidência executada

| Gate | Resultado |
| --- | --- |
| `pnpm test` | 1.063 testes Node + 26 Python, todos verdes. |
| `pnpm db:portal:test` | Verde com migrations Supabase-only 0001–0044; RLS, grants, receipts, readiness e concorrência cobertos. |
| `pnpm --filter @axtro/portal run e2e:public` | 3/3 verde sobre build de produção local; 1280×800, 390×844 e endpoints públicos. |
| Inspeção visual manual | 375, 768, 1024 e 1440 px sem overflow horizontal ou overlay bloqueando CTAs. |
| Validações de base | `pnpm lint`, `pnpm typecheck`, `pnpm contracts:check`, `python3 scripts/validate_all.py` (9/9) e build do portal verdes durante a auditoria. |
| Fechamento documental | `pnpm lint`, `python3 scripts/validate_all.py` (9/9) e `git diff --check` verdes após a documentação final. |

## Limites e próximos gates

1. **P0 realtime:** Tavus/Recall ainda não provam uma cadeia real de mídia com geração identificada, cancelamento e bloqueio de áudio tardio. Não promover canal realtime pago até uma tarefa arquitetural acrescentar adapter de mídia, canário e traces.
2. **Migration 0044/v44:** a migration é forward-only e não foi aplicada remotamente. Antes de subir este patch, aplicar 0044 em maintenance conforme o runbook e confirmar readiness v44; o app falha fechado enquanto o schema estiver em v43.
3. **Contrato v44:** modelar response/fixtures de runtime para consumidores externos antes de expor essa evolução como contrato público.
4. **Crawlers:** a política permite descoberta por OAI/Claude Search e bloqueia treinamento. `Google-Extended` e CCBot permanecem bloqueados por não separar finalidades de modo suficiente para a política adotada.

## Artefatos

- [Mapa factual do sistema](SYSTEM_MAP.md)
- [Auditoria priorizada](AUDIT_360.md)
- [Plano de execução e rollout](EXECUTION_PLAN.md)
- [Roadmap de inovação](INNOVATION_ROADMAP.md)
- [Runbook M5-02/v44](../operations/M5_02_RUNTIME_BRIDGE_ROLLOUT.md)

O próximo passo seguro é abrir a tarefa arquitetural de media boundary antes de qualquer promoção realtime e agendar uma janela humana separada para aplicar a migration 0044.
