# Auditoria e melhoria máxima do pacote

**Data:** 2026-07-14  
**Resultado:** pronto para o Codex iniciar M0-M2 com fakes, contratos e gates reproduzíveis.

## Material recebido

- V1: 62 arquivos no pacote original, preservados em `legacy/v1/`.
- Retorno do Fable 5: 3 arquivos, preservados em `legacy/fable-v2-partial/`.
- PDFs do Método Silva presentes nos ZIPs recebidos: 0.

O retorno do Fable havia criado uma boa Constituição, mas não tinha contratos V2, API executável, banco coerente, task graph completo, configuração nativa do Codex ou material suficiente para começar a implementação sem reinterpretar decisões.

## Problemas bloqueadores encontrados

1. Produto ainda acoplado a Sales Closer em vez de Digital Human OS.
2. Ausência de Perception Engine, Behavior Director, Scene Director e Specialist Fabric como subsistemas implementáveis.
3. Estado comercial usado como núcleo em vez de Role Pack.
4. Cinco schemas permissivos com 22 objetos internos abertos.
5. UUIDv7 declarado, mas SQL V1 usando UUIDv4.
6. Dimensão vetorial fixa em 1536 apesar da estratégia multi-provider.
7. Event bus tratado como substituto de durable workflows.
8. Falta de floor ownership atômico para handoff.
9. Custos sem meeting bot compute, warm pool, speculative calls, egress, storage e capacidade.
10. Handoff para agentes de código baseado em prosa, sem task graph e sem gates nativos.
11. Evidência externa dos oito PDFs não reproduzível nos arquivos recebidos.
12. Referências operacionais da V1 a arquivos ausentes.

## Correções realizadas

### Arquitetura e produto

- Digital Human OS como kernel genérico.
- Sales Closer como primeiro Role Pack.
- Realtime Interaction Kernel separado do Axtro Agent Control Plane.
- One Mouth Rule com Presenter único e handoff atômico.
- Cognitive Fabric com Fast, Deliberative, Specialist e Policy lanes.
- Perception por sinal, evidência, confiança, TTL e consentimento.
- Behavior e Scene Directors determinísticos.
- ActionIntent, PolicyDecision e ToolExecutionReceipt como fluxo obrigatório.
- Events e durable workflows separados.
- Adapters e capability registry para providers e canais.

### Contratos e dados

- 31 JSON Schemas Draft 2020-12 estritos.
- 31 exemplos válidos e 31 inválidos.
- OpenAPI 3.1 com 11 caminhos.
- AsyncAPI 3 com 5 operações.
- Seis migrations SQL de referência.
- 38 tabelas, UUIDv7 gerado pela aplicação e vetores provider-agnostic.
- RLS forçado, FKs com tenant e testes negativos como requisito.
- Timeline, consent, disclosure, receipts, audit e custos append-only.
- Deletion graph e retenção por finalidade.

### Implementação e governança

- Task graph com 52 tarefas M0-M3 e dependências acíclicas.
- Walking Skeleton e Human Presence Spike definidos como marcos executáveis.
- Oito subagentes Codex especializados em `.codex/agents/`.
- Quatro skills de repositório em `.agents/skills/`.
- Sandbox `workspace-write`, approvals `on-request` e rede desabilitada por padrão.
- `AGENTS.md` raiz e instruções específicas em diretórios críticos.
- `PROGRESS.md` com ledger de todas as tarefas.
- Prompt autônomo limitado por marcos, gates e evidências.

### Economia unitária

- Workbook V2 com 14 abas.
- Custos separados para Native Modular, Native S2S, Native Video, External Meeting e Telephony.
- Capacidade, planos, margens, sensibilidade e Actual vs Model.
- Preços são hipóteses editáveis e datadas, não cotações garantidas.
- Inputs públicos foram reconferidos em fontes oficiais; Realtime está rotulado como proxy e telefonia separa Voice API de SIP.

### Evidência e QA

- 62 arquivos V1 mapeados individualmente e hash-verificados.
- Retorno parcial do Fable preservado.
- Sete validadores agregados por `scripts/validate_all.py`.
- CI configurada para repetir os gates.
- Secret scan e validação específica do setup Codex.

## Números finais do pacote

| Item | Quantidade |
|---|---:|
| Arquivos V1 preservados | 62 |
| Schemas V2 | 31 |
| Exemplos de contrato | 62 |
| OpenAPI paths | 11 |
| AsyncAPI operations | 5 |
| Migrations de referência | 6 |
| Tabelas de referência | 38 |
| Tarefas M0-M3 | 52 |
| ADRs V2 | 18 |
| Subagentes Codex | 8 |
| Skills do repositório | 4 |
| Abas de unit economics | 14 |
| Gates automatizados | 7 |

## O que o Codex pode implementar agora

### M0, Foundation

Monorepo, codegen, domínio, reducers, configuração, migrations, RLS, auth, OpenTelemetry, provider ports, fakes, outbox, Action Runtime, cost ledger, security baseline e fixtures.

### M1, Walking Skeleton

Sessão completa por texto, Session Actor, estado, context composer, tool fake, PolicyDecision, Receipt, timeline, replay, outbox, workflow pós-call e reconciliação de custo.

### M2, Human Presence Spike

Voice adapter, turn detection, barge-in, late-output blocking, avatar adapter, Behavior Director, Scene Director, specialist result e métricas de latência, naturalidade, estabilidade e custo.

## O que continua externo

- Credenciais e contratos de providers.
- Bake-off real de voz, avatar e meeting bot.
- Oito PDFs do Método Silva e licença de uso.
- Voz ou imagem real autorizada.
- Parecer jurídico por região e vertical.
- Segurança e privacidade de produção.
- Aprovação para piloto com clientes reais.

## Declaração correta de prontidão

O pacote está pronto para implementação M0-M2. Ele não autoriza produção, não certifica segurança, não substitui parecer jurídico e não escolhe provider definitivo.
