# EXECUTION_LOG: execução autônoma

Registro por ciclo do loop (auditar → priorizar → implementar → testar → mergear).
Detalhe técnico por decisão: `docs/operations/DECISIONS_LOG.md`.

## Ciclo de integração · 2026-10-10/11: Codex, Priscila e ponte de tools

Branch `integration/codex-2026-10`, 22 commits de código desde `96fd61e` mais os de documentação, sem PR e sem nada aplicado
em hospedado. Cada decisão em `docs/operations/DECISIONS_LOG.md` (D-V2-193 a D-V2-197); a
estrutural no ADR-050.

- **Método:** implementar, testar, revisar com agente independente, corrigir, repetir. Duas
  revisões de código da ponte acharam 5 e 4 problemas (todos corrigidos), e um red team da
  sentinela achou 13 falas de risco que chegavam ao áudio.
- **Achados que mudaram o desenho:** o teto de entrada de 20 mil (fixado no banco) estourava com
  as 4 tools e a base cheia; uma tool malformada depois de resposta paga travava o tenant
  inteiro; o rótulo de resultado de tool podia ser falado pela pessoa.
- **Validação no fechamento:** 2.237 testes Node e 80 Python, `validate_all` 9/9, build,
  Playwright local 17/17 e público 14/14. DeepEval 4.2.8, Ragas 0.4.3 e Pipecat 1.12.0 foram
  conferidos contra as bibliotecas reais em ambientes isolados, sem chamada paga.
- **Não verificado ao vivo:** formato das tool calls da Tavus, envio ao Langfuse, laboratório de
  voz contra Tavus e Daily, e qualidade da Priscila com um modelo real.

## Ciclo 3 · 2026-07-19/20: "produto operável de ponta a ponta"

- **Auditoria:** `docs/PROJECT_AUDIT.md` criado; backlog priorizado em `TASKS.md`.
- **T1 Ativação de agente:** RPC `portal_set_agent_status` (0014, aplicada no live e testada:
  active/draft/inválido), guarda de provider no server action, `AgentStatusToggle` na lista.
- **T2 E-mail de convite:** `lib/email.ts` (Resend, timeout 10s, log sem PII), envio
  não-bloqueante no `inviteMember`, feedback distinto na UI, chave local via Doppler.
- **T3 Modo demonstração:** `PORTAL_FAKE_PROVIDERS=1`: chat determinístico formato Silva,
  embeddings fake xorshift normalizados (busca continua funcional), apresentação simulada
  com navegação manual do deck.
- **T4 E2E Playwright:** 6 specs serial (landing, redirect, login, ativação com reversão,
  chat mock, deck simulado); webServer próprio na porta 3100 com fake providers.
- **T5 CI/health/docs:** job `build-portal` no workflow; `GET /api/health`; documentação
  final completa (este conjunto de arquivos). Bug real encontrado e corrigido: a rota
  nasceu protegida pelo middleware de auth (redirecionava pra `/login`, quebrando o
  smoke test). Excluída do matcher do `proxy.ts`, verificado com curl e e2e.
- **Validação:** lint, typecheck (workspace + portal), 418 testes Node + 26 Python, build
  do portal, 9 validadores, secret scan e 6/6 specs Playwright (Chrome real), todos verdes.
- **T6 Rate limiting:** 0015 aplicada no live: 20 convites/dia e 30 ingestões/dia por
  tenant (`create or replace` preservando 100% do comportamento anterior das duas RPCs).
  Testado ao vivo: convite normal continua funcionando, dado de teste limpo.
- **T9 Notificação de ativação:** 0016 (`portal_list_admin_emails`, admin-only) +
  `sendAgentActivatedEmail` no fluxo de ativação, best-effort (nunca desfaz a ativação).
  README de `database/supabase-only/` corrigido: faltava a entrada de 0014 do ciclo
  anterior. Validado com o e2e completo (6/6, incluindo o teste que ativa/pausa Bruno).

## Ciclo 3c · 2026-07-22: Deploy manual + varredura final de docs

- **Achado**: Railway não tinha auto-deploy configurado. O deploy ativo era de 2026-07-19,
  anterior a todos os PRs #16-#20. Autorização explícita do Fernando obtida ("pode rodar
  deploy"); `railway up --service portal` disparado a partir da `main` (`379e24e`).
- **Confirmado em produção**: `GET /api/health` → `ok:true`, com `email_provider` no payload
  (campo que só existe no build novo). O Cérebro Método Silva, percepção emocional,
  ativação de agente, rate limiting e telemetria estão todos ao vivo agora.
- **Bloqueio operacional durante a sessão**: o classificador de permissões de ações (Bash/
  Monitor) ficou intermitentemente indisponível por um período longo: leituras (`git log`,
  `Read`) continuaram funcionando; escritas (`git commit`, `git push`, `railway up`) foram
  bloqueadas e reenfileiradas até o classificador normalizar. Nenhuma ação foi contornada.
- **Varredura de docs enquanto aguardava**: encontrados e corrigidos 4 problemas reais:
  `README.md` ainda descrevia M0-M1 (sem menção ao portal/produto); `CHECKLIST_PROXIMO_AGENTE.md`
  listava Auth Hook/SMTP/deploy como pendentes (resolvidos há ciclos, risco de um agente
  futuro repetir trabalho ou parar em falso bloqueio); `RISCOS_E_PENDENCIAS.md` com 3 itens
  desta própria sessão (T1/T2/T6/T9) ainda marcados como pendentes; `docs/adr/README.md`
  nunca listou o ADR-035 da sessão anterior.
- **Pendente**: `RESEND_API_KEY` não está nas variáveis do serviço Railway. E-mail de
  convite funciona (best-effort) mas cai em modo mock em produção até a chave ser setada.

## Ciclo 3b · 2026-07-20: Rate limiting, notificação e telemetria (continuação)

- **T6/T9** (já detalhados acima): mergeados no PR #19.
- **T7 Telemetria:** adapter único `apps/portal/src/lib/telemetry.ts` (`logEvent`/`logError`)
  com redação automática de chaves/tokens/senhas e de e-mails embutidos em texto livre.
  Migrados os 17 pontos de `console.error`/`console.info` espalhados em
  `lib/actions/*.ts` e `lib/email.ts`, sem cobrir com Sentry ainda (decisão de vendor
  fica pendente em NEEDS_CONNECTION), mas todo log passa por um único ponto redigido e
  testado (`tests/portal/telemetry.test.mjs`, 4 testes). Colisão de nome resolvida com
  alias `trackError` onde variáveis locais já se chamavam `logError`.

## Ciclo 2 · 2026-07-19: Cérebro Método Silva + percepção emocional

- PR #16 (cérebro, RAG, personas, apresentação) e PR #17 (emenda ADR-035), mergeados
  com autorização explícita do Fernando. Evidências em PROGRESS.md.

## Ciclo 1 · 2026-07-16/18: Fase de produto

- PRs #1-#15 (sessões anteriores): portal completo com auth, RAG, vídeo, custos e deploy.
