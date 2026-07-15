# Auditoria final de M0, M1 e M2

**Data:** 2026-07-15

**Veredito:** `M0 FOUNDATION COMPLETE | M1 WALKING SKELETON COMPLETE | M2 HUMAN PRESENCE SPIKE COMPLETE (fake-first)`

**Não iniciado:** M3 Sales Closer Alpha

**Escopo excluído:** produção, deploy, banco remoto, provider real, execução de
canal de áudio ou avatar real e certificação de segurança e aprovação jurídica.
M2 é um spike de evidência fake-first — ver `artifacts/m2/DECISION.md` para o
gate de decisão completo (nenhum provider real foi promovido ou executado).

## Resposta executiva

A Foundation e o Walking Skeleton foram implementados em tarefas pequenas,
ordenadas pelo task graph e separadas por commits convencionais. A baseline usa
somente fakes determinísticos, preserva isolamento multi-tenant, One Mouth Rule,
ações receipt-backed e o Axtro Agent fora do caminho crítico.

O cenário completo de M1 cria e ativa uma sessão, executa três turnos textuais do
participante com três respostas de um único Presenter, realiza uma consulta de
catálogo governada, conclui a sessão, entrega a timeline por outbox, recupera um
crash pós-efeito, executa o workflow pós-call, verifica replay e renderiza o
console operacional tenant-safe.

M2 compõe onze novos pacotes fake-first (transporte de sala, Turn Coordinator,
caminho modular e roteador S2S, Behavior Director, Avatar Session, Scene
Director, Specialist Fabric, Perception Bus, Degradation Controller e Realtime
Telemetry) num cenário determinístico de dez minutos simulados que exercita os
onze itens obrigatórios de `docs/operations/HUMAN_PRESENCE_SPIKE.md`: barge-in
sem late output, captura exata de número/e-mail, especialista atrasado sem
bloqueio, apresentação de slide, injeção de falha de avatar com degradação
elegante para voz e retorno a voice-only. Nenhum provider real, credencial ou
rede externa foi tocado.

## Implementação auditada

- 28 workspaces pnpm e workspace Python com gates canônicos;
- 47 JSON Schemas com tipos TypeScript e Python gerados deterministicamente;
- domínio com UUIDv7, tenant e trace explícitos, reducers puros e hash canônico;
- configuração fake-only, handles opacos, redaction e egress default deny;
- 42 tabelas normativas, 11 migrations forward-only e RLS forçada;
- autenticação de desenvolvimento fail-closed e purpose limitation;
- telemetria tenant-safe sem payload restrito;
- nove provider ports e fakes locais determinísticos;
- outbox transacional, relay bounded e timeline autoritativa;
- Action Runtime por `ActionIntent`, `PolicyDecision` e
  `ToolExecutionReceipt`;
- Cost Ledger decimal e baseline nominal de USD 0.02 por sessão fake;
- lifecycle, Session Actor, Turn Driver textual e Context Composer bounded;
- workflow pós-call checkpointed sem follow-up externo;
- console SSR interno, read-only e tenant-safe;
- E2E determinístico e artefatos metadata-only em `artifacts/m1/`;
- `RoomTransport` normalizado sobre `ChannelPort`, substituível sem tocar SDK concreto (M2-01);
- Turn Coordinator com máquina de estados pura, quatro perfis e geração cercada (M2-02);
- caminho modular STT/LLM/TTS com timing por componente e roteador S2S com fallback (M2-03/M2-04);
- Behavior Director determinístico por seed com scheduler de naturalidade limitado (M2-05);
- Avatar Session com resultado sempre tipado, nunca exceção, e descarte de frame tardio (M2-06);
- Scene Director com allowlist fechada de manifestos e fencing por geração (M2-07);
- Specialist Fabric com bulkhead, deadline racing e One Mouth por omissão de API (M2-08);
- Perception Bus com vocabulário fechado de sinal/hipótese e TTL por consentimento (M2-09);
- Degradation Controller executando as 10 linhas da matriz de capacidade como dados tipados (M2-10);
- Realtime Telemetry com p50/p95 por span contra `LATENCY_BUDGETS.md` e reconciliação de custo (M2-11);
- cenário obrigatório de dez minutos determinístico e artefatos metadata-only em `artifacts/m2/` (M2-12/M2-13).

## Provas reproduzíveis

Execute na raiz:

```bash
pnpm install --frozen-lockfile
UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv sync --locked --all-groups
pnpm lint
pnpm contracts:check
pnpm typecheck
pnpm test
UV_CACHE_DIR=/private/tmp/axtro-uv-cache uv run pytest
pnpm build
pnpm db:test
pnpm db:rls
pnpm m1:e2e
pnpm m2:e2e
python3 scripts/validate_all.py
git diff --check
```

O gate final passou com 305 testes Node, 23 unittest Python, 23 testes pytest,
9 testes E2E (2 de M1, 7 de M2), 47 schemas, 42 tabelas, 11 migrations e 9
validadores. PostgreSQL e RLS foram exercitados somente em instâncias
temporárias locais. `db:test`/`db:rls` exigiram `LC_ALL=C LANG=C` neste
ambiente para contornar um bug conhecido do PostgreSQL 17 (Homebrew) no macOS
("postmaster became multithreaded during startup"), sem qualquer mudança no
código do repositório.

## Garantias arquiteturais

- A One Mouth Rule é validada no reducer, cercada no Turn Driver e comprovada
  pelos seis eventos reais do golden.
- Nenhum texto de modelo executa ferramenta. O comando estruturado deriva a
  cadeia governada no servidor e somente receipt de sucesso confirma efeito.
- Lifecycle, timeline, Session Actor, outbox, custo e projeção operacional
  exigem scope de sessão mais `essential_processing`.
- A timeline append-only é autoridade; snapshot é cache reconstruível e replay
  de zero converge com snapshot mais tail.
- Axtro Agent, workflows deliberativos e qualquer integração externa ficam fora
  do caminho crítico dos turnos.
- M0 contém somente contratos, ports e fakes locais para mídia, avatar, meeting
  e telephony. M1 não integra nem executa canal realtime, provider real, rede,
  credencial, produção ou deploy.
- M2 integra esses contratos num cenário realtime completo, ainda 100%
  fake-first: `RoomTransport` nunca importa um SDK concreto, o Avatar Session
  nunca deixa uma falha de provider bloquear o áudio, o Scene Director nunca
  aceita URL arbitrária ou script fornecido pelo modelo, a Specialist Fabric
  não tem nenhum método de publicação (One Mouth por omissão de API), e o
  Perception Bus não consegue construir um sinal de mentira, diagnóstico,
  atributo protegido, risco/solvência, biometria ou emoção-como-fato — esses
  tipos simplesmente não existem no vocabulário fechado.

## Auditoria de segurança e tenancy

Revisões read-only independentes confirmaram ausência de P0, Critical e High.
A matriz cobre tenant estrangeiro em API, console, catálogo, relay, timeline,
workflow, banco, cache e objetos. O finding Medium de finalidade insuficiente
foi corrigido em todos os guards compartilhados e recebeu testes negativos por
bounded context.

Secret scan e dependency scan passaram. Artefatos não contêm payload,
transcript, argumentos, resultado bruto, token, segredo, PII ou referência local
de máquina.

## Riscos e débitos aceitos

- stores, actors, relay, workflow e projeções são process-local;
- o console não possui servidor HTTP ou browser auth;
- alertas M1 são condições bloqueantes locais, sem transporte operacional;
- o baseline de USD 0.02 (M1) e a reconciliação fake de M2 cobrem somente
  fixtures instrumentadas, não custo de produção;
- **nenhum provider real foi executado em M0, M1 ou M2.** `artifacts/m2/DECISION.md`
  marca `blocked` os 10 candidates de `CURRENT_PROVIDER_MATRIX.md` (mais Hedra,
  excluído) por ausência de bake-off credenciado — não por falha de qualidade;
- pacotes M2 usam validação "spike-tier" (D-V2-043) mais leve que o padrão
  M0/M1 nos limites internos entre pacotes M2; e vocabulários de telemetria e
  degradação próprios em vez de estender os enums fechados de M0
  (D-V2-046, D-V2-047) — ambos candidatos a revisão se alguma capability M2
  for promovida em M3;
- a revisão humana de naturalidade PT-BR e a medição de qualidade de vídeo real
  não foram feitas (`artifacts/m2/evidence.json.naturalness_review` e
  `.video_quality` registram isso explicitamente);
- segurança de produção, pen test, identidade real e políticas jurídicas seguem
  pendentes.

Esses limites são explícitos e não invalidam M0, M1 ou M2, mas bloqueiam
qualquer alegação de prontidão para produção ou de provider definitivo.

## Próxima sequência recomendada

Somente em uma sessão posterior e após preservar este baseline:

1. Bake-off credenciado de provider com gate humano, por
   `docs/operations/PROVIDER_BENCHMARK_PROTOCOL.md`, antes de qualquer demo
   com cliente real (pré-requisito não coberto por M0-M2);
2. M3-01, Sales Closer Role Pack, sobre os contratos M2 já estáveis;
3. Reavaliação de D-V2-043, D-V2-046 e D-V2-047 antes de aceitar dado real de
   cliente nos pacotes M2 promovidos.

Esta ordem é recomendação, não início de M3.

## Decisão final

M0 Foundation, M1 Walking Skeleton e M2 Human Presence Spike estão concluídos
e congelados como baseline local, fake-only e multi-tenant. `artifacts/m2/DECISION.md`
registra `continue`/`tune` para toda a arquitetura M2 e `blocked` para todo
candidate de provider real. O resultado autoriza apenas considerar o início de
M3 em trabalho separado, com o bake-off de provider como item de escopo
próprio e gate humano. Não autoriza produção, credenciais reais, migration
remota, deploy ou seleção definitiva de provider.
