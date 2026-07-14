# Escopo de implementação M0-M3

## M0. Foundation

Objetivo: criar um repositório executável, contract-first e seguro.

Inclui:
- monorepo pnpm + uv;
- lint, typecheck, testes e CI;
- geração de tipos TS e Python a partir de schemas;
- API modular com health, auth fake de dev e tenancy;
- schema de banco de referência e migrations iniciais;
- provider registries e fakes;
- tracing e correlation IDs;
- feature flags e config validation.

Não inclui integração paga real.

## M1. Walking Skeleton

Objetivo: provar uma sessão ponta a ponta sem áudio real.

Fluxo:
1. criar tenant, agente e role pack seed;
2. criar sessão;
3. iniciar Session Actor;
4. processar turnos textuais simulados;
5. atualizar InteractionSessionState;
6. gerar ActionIntent de leitura;
7. obter PolicyDecision e receipt fake;
8. emitir eventos por outbox;
9. concluir sessão;
10. executar workflow pós-call fake;
11. visualizar timeline e métricas no console.

Exit criteria:
- teste E2E determinístico;
- zero vazamento cross-tenant;
- replay de timeline reproduz o estado final;
- correlação completa por trace e session.

## M2. Human Presence Spike

Objetivo: provar presença natural numa call nativa de dez minutos.

Inclui:
- sala LiveKit ou fake transport intercambiável;
- pipeline modular real ou fake de STT, LLM e TTS;
- alternativa S2S atrás de flag;
- Turn Coordinator com barge-in, cancellation e false interruption recovery;
- avatar provider atrás de adapter;
- Behavior Director com estados listening, thinking, speaking e recovering;
- Scene Director alternando avatar e apresentação aprovada;
- um especialista interno assíncrono;
- tool read-only;
- telemetria de latência e custo;
- degradação para voz quando avatar falha.

Exit criteria de laboratório:
- 10 minutos sem deadlock;
- interrupção p95 ≤250 ms em harness local ou limite claramente medido;
- EOT para primeiro áudio medido por etapa;
- avatar falha e voz continua;
- especialista lento não bloqueia o turno;
- zero ação de escrita.

## M3. Sales Closer Alpha

Objetivo: executar calls internas de venda no tenant zero.

Inclui:
- Sales Closer Role Pack;
- framework de discovery configurável;
- RAG com conteúdo autorizado;
- agenda, CRM-lite e proposta em dry-run;
- handoff humano quente;
- resumo e follow-up em sandbox;
- scorecards e golden conversations;
- painel de oportunidade e call review.

Exit criteria:
- mínimo de 20 calls internas;
- precisão factual ≥98% nas afirmações verificáveis do golden set;
- zero violação crítica de policy;
- naturalidade média ≥4/5 por avaliadores humanos;
- handoff com contexto completo em ≤10 s;
- custo real por canal registrado.

## Fora do M0-M3

- Outbound massivo e discador preditivo.
- Ações financeiras irreversíveis autônomas.
- Diagnóstico, aconselhamento regulado ou underwriting automático.
- Identificação biométrica silenciosa.
- Automação arbitrária de navegador.
- Marketplace público de clones humanos.
- Treinamento de modelo próprio de avatar.
- SLA enterprise, SSO, SCIM e data residency dedicada.
