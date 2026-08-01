# Riscos e pendências

**Atualizado:** 2026-07-31 · **Branch:** `main`

## Notas de 2026-07-31 (SEO/AEO, rate card, reunião externa, produto aberto para contratação)

- **Cérebro/percepção emocional** (D-V2-073/074/075, ADR-035) e as ondas T1-T9 de 2026-07-19/20/24 seguem válidas — ver seções abaixo, agora todas riscadas.
- **Reunião externa (Recall.ai) construída, testada ao vivo e em produção** (R1-R4, D-V2-089/090/091/092/093): agente entra em Meet/Zoom/Teams real com palco de rosto próprio e áudio bidirecional; dois bugs reais de áudio corrigidos ao vivo (mic ausente, depois CPU insuficiente do bot + reprocessamento de áudio) — eleva a prioridade do DPIA/parecer jurídico da percepção emocional (nota de 2026-07-19 abaixo), já que agora ela roda dentro de reuniões de clientes de verdade, não só na sala hospedada.
- **Produto aberto para contratação** (D-V2-094/095/096): auto-provisão de vídeo na ativação (sem isso, cliente novo ficava sem vídeo), teto de 20 conversas de vídeo/dia por tenant (não havia NENHUM cap de custo de vídeo antes), exclusão real de agente/fonte (usuários criavam mas não removiam nada, limites de 20/50 entupiam), `/termos` e `/privacidade` v1 (produto público sem página legal alguma antes), e2e ampliado a 14 specs clique-a-clique, e CI passa a rodar essa suite em todo PR/push (job pulado até os 4 secrets de conta demo serem cadastrados no GitHub — ver `docs/NEEDS_CONNECTION.md`).
- **Gate "chaves reais de provider via Doppler"** (item 2 da tabela abaixo) considerar **RESOLVIDO**: OpenRouter, Tavus, ElevenLabs, Recall.ai e Resend estão todos conectados e testados ao vivo em produção.
- Pendências que permanecem inalteradas e bloqueantes: DPIA/parecer jurídico por jurisdição para percepção emocional (agora mais urgente, ver acima), decisão comercial de planos/preços (Stripe), bake-off credenciado de provider + piloto interno real M3-10, revisão jurídica formal de `/termos`/`/privacidade` — todas em `PENDENCIAS_EXTERNAS.md`.

## Notas de 2026-07-20 (execução autônoma — lacunas operacionais)

- Ativação de agente, e-mail de convite, rate limiting e telemetria — todos fechados nesta sessão (PRs #18-#20; ver itens correspondentes abaixo, agora riscados).
- **Achado real**: o Railway não tem auto-deploy configurado para este projeto — o deploy anterior foi disparado manualmente via `railway up` numa sessão prévia. Deploy manual do estado atual (PRs #16-#20) autorizado pelo Fernando e **confirmado em produção 2026-07-22**: `/api/health` responde `ok:true` com os campos do build novo (`email_provider` presente). Falta setar `RESEND_API_KEY` nas variáveis do serviço Railway para o e-mail de convite sair do modo mock em produção — ver `docs/NEEDS_CONNECTION.md`.

## Notas de 2026-07-19 (Cérebro Método Silva)

- Créditos conversacionais do Tavus voltaram a funcionar: conversa real criada e encerrada no e2e (D-V2-074). O esgotamento de D-V2-067 não se reproduziu — monitorar o consumo pelas conversas do painel Uso de IA.
- Validação de UI logada (chat e sala de apresentação no navegador) pendente de um teste humano: a sessão autônoma validou o pipeline por API (mesmos RPCs, mesmo modelo, mesmos prompts) e viu a Rafaela ao vivo na sala Daily, mas não digitou credenciais no formulário de login por política. Falta o Fernando abrir `/agentes/<id>/testar` logado e rodar uma apresentação completa com microfone.
- O Caso Modelo ContaLeve (empresa fictícia) ficou fora do RAG de propósito — se algum dia for ingerido, precisa de classificação/rotulagem que impeça a agente de citar os preços fictícios como fatos da conta.
- `apps/portal/tmp/` guarda os scripts operacionais da sessão (ingestão, setup de personas, e2e) — são gitignored e re-executáveis; a chave ElevenLabs nunca foi gravada em disco (só env var via Doppler).
- **Percepção emocional profunda ativa (ADR-035, D-V2-075)**: por decisão do Fernando, as agentes leem emoção, micro-expressões e linguagem corporal como capacidade central. Isso ELEVA a urgência da validação jurídica por jurisdição já listada em PENDENCIAS_EXTERNAS (DPIA; EU AI Act restringe reconhecimento de emoção em contextos de trabalho/educação; LGPD trata dado comportamental/biométrico como sensível). Antes de vender para mercados regulados ou clientes europeus, esse parecer é bloqueante.

## Pendências com gate humano (não são bugs)

| # | Pendência | Onde está documentado | Quem destrava |
|---|---|---|---|
| 1 | ~~Habilitar o Custom Access Token Hook~~ — **RESOLVIDO 2026-07-16** via Management API (D-V2-063): hook ativo, JWT testado carregando `tenant_id`/`actor_id`/`tenant_role` | D-V2-063, ADR-032 | — |
| 2 | Chaves reais de provider (voz, avatar, LLM, telefonia) via Doppler — só no fim da fase, após auditoria, por instrução explícita | PROGRESS.md "Próxima ação" | Fernando |
| 3 | ~~Deploy/hosting real~~ — **RESOLVIDO 2026-07-16** (autorizado): https://portal-production-b43e.up.railway.app | docs/operations/DEPLOY_PORTAL.md | — |
| 4 | ~~SMTP próprio~~ — **RESOLVIDO 2026-07-16**: Resend configurado via Management API (smtp.resend.com:465, domínio axtroai.com verificado, 30 e-mails/h); envio real de confirmação testado e visto no Resend | D-V2-063 | — |
| 5 | Bake-off credenciado de provider + piloto interno real de M3-10 | D-V2-048/049/054 | Fernando |

## Riscos aceitos / dívidas técnicas

| # | Item | Racional | Mitigação futura |
|---|---|---|---|
| 1 | RPCs `SECURITY DEFINER` como camada de dados do portal, em vez de RLS por claim de JWT | D-V2-058 — funciona hoje sem o hook habilitado e sem `service_role` | Quando o hook estiver ativo, migrar leituras para RLS-por-claim mantendo as RPCs de escrita |
| 2 | As funções e tabelas do portal (`user_tenant_memberships`, `portal_*`, hook) vivem só no projeto Supabase, fora de `database/migrations/` | D-V2-055/056 — referenciam `auth.users`, inexistente no harness local | ~~Criar `database/supabase-only/`~~ feito 2026-07-16 — SQLs versionados em `database/supabase-only/0001..0007` |
| 3 | `user_tenant_memberships` permite um único tenant por usuário (PK em `user_id`) | Suficiente para self-serve atual; convites (D-V2-060) respeitam essa restrição — convidar e-mail que já tem workspace é rejeitado | Multi-tenant por usuário / mover usuário entre tenants exigem nova modelagem (revisit trigger no ADR-032) |
| 3b | ~~Convites não enviam e-mail~~ — **RESOLVIDO 2026-07-20**: `sendInviteEmail` via Resend no ato do convite (best-effort, mock sem chave) | T2, PR #18 | — |
| 4 | ~~Sem rate limiting próprio nas RPCs do portal~~ — **RESOLVIDO 2026-07-20**: 20 convites/dia e 30 ingestões/dia por tenant | T6, PR #19 | — |
| 5 | ~~Ativação de agente indisponível no portal~~ — **RESOLVIDO 2026-07-20**: `portal_set_agent_status` com guarda de provider + notificação por e-mail aos admins | T1/T9, PRs #18-19 — ingestão de conteúdo já era real desde D-V2-070 | — |
| 6 | `robots: noindex` no portal inteiro | Portal é app logado; não há landing page pública neste repo | SEO/AEO pertencem à landing (projeto `axtroai`), não ao portal |

## Como monitorar

- Advisors de segurança/performance do Supabase: `get_advisors` (MCP) ou dashboard → Reports.
- Logs de auth e Postgres: dashboard → Logs (não há log drain configurado).
- Logs do portal passam por um adapter único com redação automática de PII (`apps/portal/src/lib/telemetry.ts`, T7) — vendor de APM real (Sentry ou log drain dedicado) segue como decisão pendente em `docs/NEEDS_CONNECTION.md`.
