# Auditoria 360 — 2026-08-18

## Método e limite

A auditoria leu Constituição, handoff, task graph M5-03, contratos, migrations, runtime bridge, superfícies públicas, CI e testes. Foram executadas validações de código, PostgreSQL local e browser em desktop/mobile. Não foram consultados nem modificados ambientes remotos, credenciais, billing ou providers reais.

Status: **correções locais implementadas e validadas; promoção externa bloqueada conscientemente.**

## Descobertas

| ID | Área / título | Evidência e causa raiz | Impacto usuário e negócio | Severidade / probabilidade / esforço / risco da correção | Solução, status e teste necessário |
| --- | --- | --- | --- | --- | --- |
| AXTRO-360-01 | Runtime: UUID externo incompatível | A UI gerava UUIDv4 para `commandId`, mas a bridge exigia UUIDv7, embora fosse só correlação. | Sessões de vídeo poderiam falhar fechadas ao ativar o bridge. | P1 / alta / S / baixo | Aceitar UUID RFC só para correlação; IDs persistidos continuam UUIDv7. **Resolvido.** Teste v4/v7, UUID inválido e build portal. |
| AXTRO-360-02 | Banco: receipt não era exato | A função v43 validava tenant/agente/provider da reservation, mas não `provider_ref`/URL exatos. | Receipt poderia referir outro recurso do mesmo provider; evidência de efeito seria enganosa. | P1 / média / M / baixo | Migration 0044 exige ref/URL exatos antes do insert. **Resolvido localmente; aplicação humana pendente.** Harness negativo e replay único. |
| AXTRO-360-03 | Tenancy: provas incompletas de One Mouth | Happy path SQL não materializava corrida entre Presenters nem actor/agente cross-tenant. | Regressão em lock/RLS poderia passar sem ser detectada. | P1 / média / M / baixo | Harness usa conexões concorrentes, exige um `issued` e um `one_mouth_conflict`, e prova 42501 cross-tenant. **Resolvido.** `pnpm db:portal:test`. |
| AXTRO-360-04 | Observabilidade: PII aninhada | Redação era rasa; objetos/arrays/erros hostis podiam transportar PII ou segredo. | Vazamento em logs e diagnóstico pouco confiável. | P1 / média / M / médio | Redação recursiva limitada, resistente a ciclos/getters/proxies; campos reservados não são sobrescritos. **Resolvido.** Testes de PII, segredo, ciclos e colisão. |
| AXTRO-360-05 | SEO/AEO: canonical e legal inconsistentes | Legal no sitemap herdava `noindex`; fallback e `llms*` usavam host Railway bruto. | Indexação, compartilhamento e descoberta por IA incoerentes. | P2 / alta / S / baixo | Canonical único, metadata legal explícita e AEO coerente. **Resolvido.** Teste de metadata e E2E público. |
| AXTRO-360-06 | Produto/legal: promessa não disponível | Preços prometiam reunião externa incluída; privacidade prometia retenção integral sem finalidade consentida. | Expectativa comercial enganosa e risco de privacidade. | P1 / média / S / baixo | Copy separa sala Axtro/slides de reunião externa em rollout e condiciona persistência à finalidade. **Resolvido.** Teste de superfície e revisão arquitetural. |
| AXTRO-360-07 | Descoberta IA: política ausente | Não havia política explícita de busca versus treinamento. | Conteúdo público podia ser coletado além da intenção operacional. | P2 / média / S / reversível | `robots.txt` permite OAI/Claude Search e bloqueia crawlers de treino; limitação Google/Common Crawl documentada. **Resolvido como política reversível.** Teste HTTP. |
| AXTRO-360-08 | QA: E2E público ausente | SEO era análise de fonte e Playwright autenticado lia `.env.local`. | Regressões de output App Router poderiam chegar ao deploy. | P2 / alta / M / baixo | Gate Playwright público sem credencial cobre output, JSON-LD, teclado e viewports. **Resolvido.** `e2e:public` e job CI. |
| AXTRO-360-09 | Realtime: media boundary incompleta | Tavus/Recall não têm prova end-to-end de input → geração → áudio, cancelamento e fence de saída tardia real. | Barge-in/transferência podem não impedir fala tardia do provider. | P0 / média / L / alto | Não corrigir superficialmente. Tarefa arquitetural com adapter de mídia e canário com traces. **Aberto: bloqueia promoção realtime.** |
| AXTRO-360-10 | Contratos: response runtime v44 | Capability e response runtime evoluem no rollout, mas contratos gerados não modelam integralmente a resposta durável. | Clientes/operadores podem depender de shape implícito. | P2 / média / M / médio | Modelar response/fixtures em tarefa contract-first. **Aberto.** |

Legenda: S = pequeno, M = médio, L = grande. Probabilidade mede recorrência sem a correção.

## UX e visual

A landing mantém identidade escura, contraste alto e CTA claro. Inspeção visual em 390 px e 1280 px não encontrou overflow horizontal; a navegação reorganiza-se no mobile sem esconder CTAs de entrada. A página de preços continua legível e agora não promete disponibilidade inexistente. Não foi feito redesign porque não havia evidência de que alterar a linguagem visual resolveria problema mais prioritário que verdade de copy, descoberta e segurança.

## Riscos residuais e dependências humanas

- **0044/v44:** aplicar somente em maintenance, após 0040–0043, conforme `docs/operations/M5_02_RUNTIME_BRIDGE_ROLLOUT.md`; nenhum banco remoto foi tocado.
- **Realtime P0:** não habilitar canal pago em produção até haver prova de mídia controlada com cancelamento/late-output real.
- **Crawlers:** `Google-Extended` não separa treinamento de grounding; a escolha conservadora preserva Google Search normal, mas sacrifica esse grounding. `CCBot` também não separa finalidades.
- **Contrato runtime:** tratar v44 como mudança contract-first antes de expor nova resposta a consumidores externos.
