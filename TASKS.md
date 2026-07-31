# TASKS — backlog executável (ordem de impacto)

Atualizado pela execução autônoma. Estado: `[ ]` pendente · `[~]` em curso · `[x]` feito.
Canônicos de contexto: `docs/PROJECT_AUDIT.md`, `PROGRESS.md`, `RISCOS_E_PENDENCIAS.md`.

## Agora (fluxos visíveis quebrados/incompletos)

- [x] **T1 · Ativação de agente no portal** — RPC `portal_set_agent_status` (admin; `draft→active` exige provider de texto configurado no ambiente e disclosure profile válido; `active→draft` sempre permitido), botão Ativar/Pausar na lista de agentes, texto desatualizado corrigido. Supabase-only 0014 aplicada no live. Testes das guardas.
- [x] **T2 · E-mail real no convite de equipe** — adapter Resend (`RESEND_API_KEY` server-only), envio no ato do convite (não bloqueante: falha de e-mail não desfaz o convite), template pt-BR com nome do workspace + papel + link de signup, mock automático sem chave (log estruturado). `.env.example` + NEEDS_CONNECTION (chave no Railway).
- [x] **T3 · Modo mock dos providers do portal** — `PORTAL_FAKE_PROVIDERS=1`: chat responde pelo fake determinístico (sem OpenRouter), vídeo/apresentação retornam sala simulada com deck (sem Tavus), embeddings fake para ingestão local. Permite testar TODOS os fluxos sem chave, alinhado ao fake-first do kernel.
- [x] **T4 · E2E Playwright da UI logada** — 6 specs (landing, redirect, login, ativação com reversão, chat mock, deck simulado); webServer próprio com fake providers. 6/6 verdes com Chrome do sistema.
- [x] **T5 · CI do portal + health check** — job de build/typecheck do portal no workflow; rota `/api/health` pública (excluída do middleware de auth — bug real encontrado e corrigido) com checagem de env não-secreta; smoke test pós-deploy documentado.

## Depois (robustez)

- [x] **T6 · Rate limit por tenant nas RPCs caras** — 0015: 20 convites/dia e 30 ingestões/dia por tenant, testado ao vivo (RPCs seguem funcionando normalmente, guarda ativa).
- [x] **T7 · Telemetria** — adapter único `lib/telemetry.ts` (redação automática de chaves/tokens/e-mail, testado); todos os `console.*` de `lib/actions/` e `lib/*.ts` migrados. Escolha de vendor (Sentry/log drain) segue como decisão pendente em NEEDS_CONNECTION — o adapter é o único ponto de wiring quando decidir.
- [x] **T8 · Rate card de custos** — 0017: preços PÚBLICOS de tabela (OpenRouter Haiku 4.5 e text-embedding-3-small, piso Tavus por conversa). `source='estimated'` sempre (honestidade, Art. 16); painel com custo hoje/7d em US$. Testado ao vivo (US$0,0035 exato para 1000in/500out).
- [x] **T9 · Notificação por e-mail em ativação de agente** — 0016 (`portal_list_admin_emails`) + `sendAgentActivatedEmail`, best-effort, testado no e2e (ativar/pausar Bruno dispara e reverte sem quebrar o fluxo).

## Onda de produção (2026-07-31)

- [x] **P1 · Auto-provisão de persona de vídeo na ativação** — validada ao vivo (Marina, persona p243348ebb20).
- [x] **P2 · Teto de vídeo (20/dia/tenant) + seção Plano e contratação** — falha fechada; sem preço público inventado.
- [x] **P3 · E2e clique-a-clique 11 specs + pipeline + deploy** — 11/11 verdes.
- [x] **R1-R4 · Reunião externa (Recall.ai)** — chave validada, UI, webhook, palco de rosto, áudio 2 sentidos, teste ao vivo com a Raissa.

## Integrações maiores (dependem de conta/chave — ver docs/NEEDS_CONNECTION.md)

- [ ] **T10 · Telefonia (Telnyx)** — **decisão autônoma: NÃO construir adapter especulativo agora.** Telefonia é M3b/Trilha B no ROADMAP (Meeting Edge/Channel Adapters do kernel), sem requisito de produto ativo, sem sandbox real para validar contrato — código não testável contra API real vira scaffolding morto, o oposto do que o kernel fake-first exige (fakes com contrato provado, não chutado). Permanece bloqueado por conta; quando houver requisito + sandbox, entra pela arquitetura de Channel Adapter existente, não como atalho no portal.
- [x] **T11 · Meet/Zoom/Teams (Recall.ai)** — **superado**: a decisão de não construir caiu quando o Fernando reclassificou reunião externa como capacidade central e a conta/chave apareceram (D-V2-089/090); construído, testado ao vivo e em produção (ver "Onda de produção" acima e R1-R4).
- [ ] **T12 · Billing (Stripe)** — planos/franquias dependem de decisão comercial explícita (preços, franquias, ciclo) antes de qualquer linha de código — não é lacuna de engenharia, é falta de decisão de produto. Permanece em PENDENCIAS_EXTERNAS.
- [ ] **T13 · Migrar leituras do portal para RLS-por-claim** — **decisão autônoma revista: NÃO fazer sem staging.** O bloqueador original (Auth Hook inativo) está resolvido desde D-V2-063, mas isso só remove um impeditivo técnico — não cria uma rede de segurança para a migração em si. As tabelas do portal vivem só no projeto Supabase hospedado (D-V2-055/056), fora de `database/migrations/` e do harness local `pnpm db:rls`; não há como provar ausência de vazamento cross-tenant em novas policies RLS sem testar contra o projeto real, que hoje serve a conta demo em produção. Trocar o funil auditável de RPCs `SECURITY DEFINER` (Art. 9 exige testes negativos de vazamento) por RLS direta, sem esse teste, é o tipo de risco que "autonomia total" não deveria assumir sozinha. Permanece dívida técnica documentada (D-V2-058); revisitar quando existir projeto Supabase de staging.

## Gates humanos (não são tarefas de engenharia)

- Bake-off credenciado de provider · piloto real M3-10 (20 calls) · DPIA/jurisdição para percepção emocional (ADR-035) · decisão de planos/preços.
