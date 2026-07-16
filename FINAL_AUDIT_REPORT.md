# Auditoria final de M0, M1, M2 e M3

**Data:** 2026-07-15

**Veredito:** `M0 FOUNDATION COMPLETE | M1 WALKING SKELETON COMPLETE | M2 HUMAN PRESENCE SPIKE COMPLETE (fake-first) | M3 SALES CLOSER ALPHA COMPLETE (fake-first/dry-run; piloto real e bake-off pendentes de gate humano)`

**Não iniciado:** nenhum marco do MVP task graph

**Escopo excluído:** produção, deploy, banco remoto, provider real, execução de
canal de áudio ou avatar real, credenciais reais, piloto interno real com
chamadas de verdade, e certificação de segurança e aprovação jurídica. M2 é um
spike de evidência fake-first (`artifacts/m2/DECISION.md`). M3 implementa
M3-01 a M3-09 fake-first/dry-run por completo; M3-10 entrega apenas a
ferramenta de gate, sem piloto real (`artifacts/m3/README.md`).

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

M3 constrói o Sales Closer Alpha sobre essa base: um Role Pack instalável por
tenant, ingestão de conhecimento autorizada com RAG tenant-scoped (ADR-031),
adaptadores de ferramenta somente leitura ou dry-run (CRM-lite, calendário,
proposta), handoff humano quente que reaproveita o CAS de `presenter.changed`
de M1-02, um workflow de follow-up em sandbox, um harness de avaliação com
seis dimensões e gate crítico independente da média, expansão do console
operacional para revisão de oportunidade, e a ferramenta de gate de piloto
interno. Toda a implementação de M3-01 a M3-09 é fake-first ou dry-run,
exatamente como o próprio critério de aceite de cada tarefa exige; M3-10 entrega
a ferramenta pronta mas não fabrica um piloto real — isso fica formalmente
pendente de gate humano.

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
- cenário obrigatório de dez minutos determinístico e artefatos metadata-only em `artifacts/m2/` (M2-12/M2-13);
- Sales Closer Role Pack instalável/removível por tenant, com evento `sales.uninstalled` fechando o ciclo de vida no domínio (M3-01);
- Knowledge Engine e ingestion-worker: retrieval fail-closed por tenant/role/produto/locale/validade, citação obrigatória, conteúdo sempre `trusted: false` (M3-02, ADR-031);
- CRM-lite somente leitura com PII gated por purpose e auditoria por tenant (M3-03);
- Calendário em dry-run por padrão, com confirmação explícita e idempotência (M3-04);
- Geração de proposta precificada só por receipt ou catálogo válido, sem capacidade de envio (M3-05);
- Handoff humano quente com proposta única por sessão e troca de piso delegada ao CAS já testado do domínio (M3-06);
- Workflow de follow-up em sandbox, aditivo sobre o motor de M1-08, vinculado a evidência de sessão (M3-07);
- Harness de avaliação com 6 dimensões e gate crítico independente da média (M3-08);
- Expansão do console de operações para citações RAG, achados do avaliador e handoffs, com redação estrutural de PII (M3-09);
- Ferramenta de gate de piloto interno, testada com dados sintéticos rotulados, sem fabricar piloto real (M3-10).

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

O gate final passou com 389 testes Node, 23 unittest Python, 23 testes pytest,
9 testes E2E (2 de M1, 7 de M2), 47 schemas, 42 tabelas, 11 migrations e 9
validadores. PostgreSQL e RLS foram exercitados somente em instâncias
temporárias locais. `db:test`/`db:rls` exigiram `LC_ALL=C LANG=C` neste
ambiente para contornar um bug conhecido do PostgreSQL 17 (Homebrew) no macOS
("postmaster became multithreaded during startup"), sem qualquer mudança no
código do repositório.

## Garantias arquiteturais

- A One Mouth Rule é validada no reducer, cercada no Turn Driver e comprovada
  pelos seis eventos reais do golden; M3-06 reaproveita esse mesmo CAS para
  handoff humano em vez de reimplementar a garantia.
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
- M3 estende esses contratos com o mesmo rigor: o CRM-lite e o Proposal
  adapter não têm nenhum método de escrita/envio no seu próprio tipo (mesma
  disciplina "One Mouth por omissão de API" de M2-08); todo preço de proposta
  vem de um receipt já emitido ou de um catálogo dentro da validade, nunca de
  texto de modelo; toda citação recuperada pelo Knowledge Engine chega ao
  console sempre marcada `trusted: false`; e a ferramenta de gate de piloto
  nunca produz, ela mesma, uma aprovação de beta com cliente.

## Auditoria de segurança e tenancy

Revisões read-only independentes confirmaram ausência de P0, Critical e High.
A matriz cobre tenant estrangeiro em API, console, catálogo, relay, timeline,
workflow, banco, cache, objetos e — a partir de M3 — retrieval de
conhecimento (cross-tenant retrieval prova zero chunks) e revisão de
oportunidade no console (render cross-tenant rejeitado antes de qualquer
HTML). O finding Medium de finalidade insuficiente foi corrigido em todos os
guards compartilhados e recebeu testes negativos por bounded context.

Secret scan e dependency scan passaram. Artefatos não contêm payload,
transcript, argumentos, resultado bruto, token, segredo, PII ou referência local
de máquina. `artifacts/m3/evidence.json` é explicitamente rotulado como dado
sintético (`FAKE_SYNTHETIC_DATA_NOT_A_REAL_INTERNAL_PILOT`), nunca apresentado
como piloto real.

## Riscos e débitos aceitos

- stores, actors, relay, workflow e projeções são process-local;
- o console não possui servidor HTTP ou browser auth;
- alertas M1 são condições bloqueantes locais, sem transporte operacional;
- o baseline de USD 0.02 (M1) e as reconciliações fake de M2/M3 cobrem somente
  fixtures instrumentadas, não custo de produção;
- **nenhum provider real foi executado em M0, M1, M2 ou M3.** `artifacts/m2/DECISION.md`
  marca `blocked` os 10 candidates de `CURRENT_PROVIDER_MATRIX.md` (mais Hedra,
  excluído) por ausência de bake-off credenciado — não por falha de qualidade;
- pacotes M2 usam validação "spike-tier" (D-V2-043) mais leve que o padrão
  M0/M1 nos limites internos entre pacotes M2; e vocabulários de telemetria e
  degradação próprios em vez de estender os enums fechados de M0
  (D-V2-046, D-V2-047) — ambos candidatos a revisão se alguma capability M2
  for promovida;
- a revisão humana de naturalidade PT-BR e a medição de qualidade de vídeo real
  não foram feitas (`artifacts/m2/evidence.json.naturalness_review` e
  `.video_quality` registram isso explicitamente);
- **M3-10 permanece formalmente aberto**: a ferramenta de gate do piloto está
  pronta e testada, mas nenhuma das 20+ chamadas internas reais exigidas pelo
  critério de aceite foi conduzida, e a aprovação de beta com cliente exige
  decisão humana separada por definição (`artifacts/m3/README.md`, D-V2-054);
- o Knowledge Engine (M3-02) e a ferramenta de avaliação (M3-08) espelham
  tabelas (`knowledge_governance`, `evaluation_runs`) que já existiam desde M0
  mas nunca haviam sido consultadas por código de aplicação — o adapter real
  PostgreSQL+pgvector continua não escolhido (ADR-031);
- segurança de produção, pen test, identidade real e políticas jurídicas seguem
  pendentes.

Esses limites são explícitos e não invalidam M0, M1, M2 ou M3, mas bloqueiam
qualquer alegação de prontidão para produção, provider definitivo ou beta com
cliente.

## Próxima sequência recomendada

Somente em uma sessão posterior e após preservar este baseline:

1. Bake-off credenciado de provider com gate humano, por
   `docs/operations/PROVIDER_BENCHMARK_PROTOCOL.md`, antes de qualquer demo
   com cliente real;
2. Piloto interno real com tenant-zero: 20+ chamadas conduzidas por um humano,
   alimentadas em `generatePilotGateReport` (M3-10) já pronto para isso;
3. Decisão humana separada de aprovação de beta com cliente, condicionada aos
   dois itens acima;
4. Reavaliação de D-V2-043, D-V2-046 e D-V2-047 antes de aceitar dado real de
   cliente nos pacotes M2 promovidos;
5. M4 (ou o próximo marco do task graph), somente após o piloto real e o
   bake-off estarem concluídos.

Esta ordem é recomendação, não início de nenhum trabalho futuro.

## Decisão final

M0 Foundation, M1 Walking Skeleton, M2 Human Presence Spike e M3 Sales Closer
Alpha (M3-01 a M3-09 completos fake-first/dry-run; M3-10 com ferramenta
pronta e piloto real pendente) estão concluídos e congelados como baseline
local, fake-only e multi-tenant. Nenhum provider real é promovido, nenhuma
credencial real é usada, e nenhuma aprovação de beta com cliente é declarada.
Uma sessão futura com gate humano deve conduzir o bake-off de provider e o
piloto interno real antes de qualquer decisão de lançamento.
