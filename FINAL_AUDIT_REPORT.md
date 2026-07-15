# Auditoria final de M0 e M1

**Data:** 2026-07-15

**Veredito:** `M0 FOUNDATION COMPLETE | M1 WALKING SKELETON COMPLETE`

**Não iniciado:** M2 Human Presence Spike e M3 Sales Closer Alpha

**Escopo excluído:** produção, deploy, banco remoto, provider real, execução de
canal de áudio ou avatar e certificação de segurança e aprovação jurídica

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
- E2E determinístico e artefatos metadata-only em `artifacts/m1/`.

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
python3 scripts/validate_all.py
git diff --check
```

O gate final passou com 209 testes Node, 23 unittest Python, 23 testes pytest,
2 testes E2E, 47 schemas, 42 tabelas, 11 migrations e 9 validadores. PostgreSQL
e RLS foram exercitados somente em instâncias temporárias locais.

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
- o baseline de USD 0.02 cobre somente uma lookup nominal instrumentada;
- não existe provider definitivo, benchmark humano nem voz, avatar ou sala
  nativa integrados;
- segurança de produção, pen test, identidade real e políticas jurídicas seguem
  pendentes.

Esses limites são explícitos e não invalidam M0 ou M1, mas bloqueiam qualquer
alegação de prontidão para produção.

## Próxima sequência recomendada

Somente em uma sessão posterior e após preservar este baseline:

1. M2-01, channel adapter e transporte local substituível;
2. M2-02, Turn Coordinator com cancelamento, barge-in e late-output fencing;
3. M2-03 e M2-04 em paralelo controlado, caminhos modular e S2S fake-first;
4. M2-05 a M2-09, presença, avatar, cena, especialistas e sinais;
5. M2-10 e M2-11, degradação, telemetria realtime e custo;
6. M2-12, cenário obrigatório de dez minutos;
7. M2-13, decisão arquitetural e de providers baseada em evidência.

Esta ordem é recomendação, não início de M2.

## Decisão final

M0 e M1 estão concluídos e congelados como baseline local, fake-only e
multi-tenant. O resultado autoriza apenas considerar o início de M2 em trabalho
separado. Não autoriza produção, credenciais reais, migration remota, deploy ou
seleção definitiva de provider.
