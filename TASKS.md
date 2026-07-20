# TASKS — backlog executável (ordem de impacto)

Atualizado pela execução autônoma. Estado: `[ ]` pendente · `[~]` em curso · `[x]` feito.
Canônicos de contexto: `docs/PROJECT_AUDIT.md`, `PROGRESS.md`, `RISCOS_E_PENDENCIAS.md`.

## Agora (fluxos visíveis quebrados/incompletos)

- [x] **T1 · Ativação de agente no portal** — RPC `portal_set_agent_status` (admin; `draft→active` exige provider de texto configurado no ambiente e disclosure profile válido; `active→draft` sempre permitido), botão Ativar/Pausar na lista de agentes, texto desatualizado corrigido. Supabase-only 0014 aplicada no live. Testes das guardas.
- [x] **T2 · E-mail real no convite de equipe** — adapter Resend (`RESEND_API_KEY` server-only), envio no ato do convite (não bloqueante: falha de e-mail não desfaz o convite), template pt-BR com nome do workspace + papel + link de signup, mock automático sem chave (log estruturado). `.env.example` + NEEDS_CONNECTION (chave no Railway).
- [x] **T3 · Modo mock dos providers do portal** — `PORTAL_FAKE_PROVIDERS=1`: chat responde pelo fake determinístico (sem OpenRouter), vídeo/apresentação retornam sala simulada com deck (sem Tavus), embeddings fake para ingestão local. Permite testar TODOS os fluxos sem chave, alinhado ao fake-first do kernel.
- [ ] **T4 · E2E Playwright da UI logada** — login com usuário demo (env), dashboard renderiza métricas, criar fonte pendente, abrir sala de teste do agente, chat completo em modo mock, revogar/reativar fonte. Screenshots em falha. Script `pnpm portal:e2e` (local; CI opcional com browsers).
- [x] **T5 · CI do portal + health check** — job de build/typecheck do portal no workflow; rota `/api/health` pública (excluída do middleware de auth — bug real encontrado e corrigido) com checagem de env não-secreta; smoke test pós-deploy documentado.

## Depois (robustez)

- [x] **T6 · Rate limit por tenant nas RPCs caras** — 0015: 20 convites/dia e 30 ingestões/dia por tenant, testado ao vivo (RPCs seguem funcionando normalmente, guarda ativa).
- [x] **T7 · Telemetria** — adapter único `lib/telemetry.ts` (redação automática de chaves/tokens/e-mail, testado); todos os `console.*` de `lib/actions/` e `lib/*.ts` migrados. Escolha de vendor (Sentry/log drain) segue como decisão pendente em NEEDS_CONNECTION — o adapter é o único ponto de wiring quando decidir.
- [ ] **T8 · Rate card de custos** — preencher `unit_cost` real (OpenRouter $/token, Tavus $/conversa, embeddings) e mostrar R$ no painel Uso de IA. **Bloqueado**: depende de números reais do Fernando (decisão comercial, não engenharia) — ver NEEDS_CONNECTION.
- [x] **T9 · Notificação por e-mail em ativação de agente** — 0016 (`portal_list_admin_emails`) + `sendAgentActivatedEmail`, best-effort, testado no e2e (ativar/pausar Bruno dispara e reverte sem quebrar o fluxo).

## Integrações maiores (dependem de conta/chave — ver docs/NEEDS_CONNECTION.md)

- [ ] **T10 · Telefonia (Telnyx)** — adapter + webhook assinado + mock local; bloqueado por conta/da chave.
- [ ] **T11 · Meet/Zoom/Teams (Recall.ai)** — idem.
- [ ] **T12 · Billing (Stripe)** — planos/franquias dependem de decisão comercial (PENDENCIAS_EXTERNAS).
- [ ] **T13 · Migrar leituras do portal para RLS-por-claim** — dívida D-V2-058, exige sessão dedicada.

## Gates humanos (não são tarefas de engenharia)

- Bake-off credenciado de provider · piloto real M3-10 (20 calls) · DPIA/jurisdição para percepção emocional (ADR-035) · decisão de planos/preços.
