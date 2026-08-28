# ADR-039: Bridge de ações de negócio do Portal (agendar reunião, registrar lead)

**Status:** Aceito (2026-08-24). Os dois pontos de decisão que bloqueavam o início da implementação (auto-confirmação sem operador humano; as 2 finalidades novas de consentimento) foram resolvidos por Fernando Silva — ver "Decisões do dono do produto" abaixo. Os itens restantes são gates de pré-lançamento (não bloqueiam o início do código).
**Data:** 2026-08-24
**Relacionados:** Art. 5, Art. 6, Art. 7, Art. 8, Art. 9, Art. 15 da Constituição; ADR-004, ADR-005, ADR-007, ADR-009, ADR-010, ADR-015, ADR-016, ADR-032, ADR-035, ADR-036, ADR-038

## Contexto

A closer de vídeo (Tavus, via Daily/WebRTC) hoje só tem três tools no prompt:
`next_slide`, `previous_slide`, `go_to_slide` (`apps/portal/src/lib/brain/metodo-silva.ts`).
`presentation-room.tsx` recebe todo `conversation.tool_call` do provider e
responde "recusado" sem exceção, inclusive para essas três tools, porque não
existe hoje nenhuma chamada de servidor nesse handler: a recusa é uma
constante local no navegador, não o resultado de uma decisão de política.
`ARCHITECTURE_CONSTITUTION.md` (Art. 7 e Art. 8) já descreve o funil que
qualquer ação de modelo precisa atravessar, e o ADR-038 já construiu esse
funil para um único domínio, a troca de cena (`SceneIntent`), atrás de
`PORTAL_RUNTIME_BRIDGE_ENABLED` (hoje `false` em produção).

Fernando decidiu abrir dois domínios de negócio novos para a mesma agente,
durante a própria chamada ao vivo: agendar uma reunião real no Google
Calendar do tenant e registrar um lead. Nenhum dos dois existe hoje. A busca
por tabela de leads no schema retorna vazio; o único código com "leads" no
nome (`apps/portal/src/app/api/leads/video-session/route.ts`) é a ponte da
Raissa institucional do control-tower, um produto diferente, sem relação com
este domínio. `packages/tool-adapters/calendar/src/index.ts` já modela a
forma certa do problema (propor horários é uma operação sem efeito; confirmar
um horário é uma escrita separada, explícita e idempotente), mas guarda tudo
em `Map` de processo: não sobrevive a um restart do Railway nem coordena
réplicas, exatamente o problema que o ADR-036 já resolveu para efeitos pagos
de provider. Confirmar uma reunião cria um evento real na agenda de um humano
real do tenant e, na prática, convida um prospect real por e-mail; registrar
um lead persiste PII de alguém que nunca usou o Portal. Os dois têm a mesma
classe de risco de duplicação e efeito ambíguo que uma cobrança, mesmo que
nenhum dos dois mova dinheiro.

Fernando já decidiu dois pontos que este ADR não revisita: o provider de
calendário é o Google Calendar, com OAuth por tenant (não uma chave única de
API tipo Cal.com); e o modelo deve poder agendar sozinho durante a chamada,
não só oferecer um fluxo manual para o operador acionar depois. Fernando
também pediu explicitamente para não tocar em `PORTAL_RUNTIME_BRIDGE_ENABLED`
nem em `PORTAL_PROVIDER_TERMINATION_ENABLED`.

## Decisão

### Um `BusinessActionIntent` tipado, nunca texto livre

O modelo continua sem autoridade própria (Art. 7). Ele emite uma tool call
Tavus tipada e o servidor, nunca o navegador, decide o que fazer com ela. Três
tools novas se somam às três já existentes: `propose_meeting_slots`,
`confirm_meeting_slot` e `register_lead`. Cada uma vira, no servidor, um
`BusinessActionIntent` fechado com `tenantId`, `agentId`, `sessionId` e
`presenterId` resolvidos do lado do servidor a partir da sessão já
autoritativa da chamada, nunca do corpo da tool call; `actionKind` fixo em um
dos três valores acima; um `commandFingerprint` (hash canônico de tenant,
sessão, `actionKind`, argumentos e o `tool_call_id` opaco que o Tavus manda);
e um `generationId` ecoado da sessão corrente, para que uma tool call tardia
de uma geração já superada (handoff, reconexão) seja rejeitada como estale,
o mesmo princípio de fence que o `SceneIntent` já aplica.

Os argumentos aceitos por tool são fechados e validados, nunca repassados
como texto:

`propose_meeting_slots` aceita só `durationMinutes` (allowlist fechada, por
exemplo 15/30/45/60) e, opcionalmente, `contactName`/`contactEmail` para
correlação. Fuso horário e janela de busca (quantos dias à frente, horário
comercial) são resolvidos pelo servidor a partir da conexão de calendário do
tenant, nunca informados pelo modelo: um prospect ou um prompt adversarial no
transcript não pode fazer o servidor buscar disponibilidade em outro fuso ou
numa janela absurda.

`confirm_meeting_slot` aceita `proposalId` e `slotIndex`, isto é, o modelo só
pode confirmar um horário que o próprio servidor já ofereceu numa resposta
anterior de `propose_meeting_slots` na mesma sessão; ele nunca informa
`start`/`end` livres. Isso fecha por construção o risco de o modelo (ou um
transcript manipulado, dado que o Art. 15 trata todo dado externo como não
confiável) inventar um horário. `contactEmail` é obrigatório neste passo, se
ainda não foi capturado antes, e passa por validação de formato antes de
qualquer chamada ao Google.

`register_lead` aceita `contactName`, ao menos um de `contactEmail` ou
`contactPhone`, e `qualificationSummary` (texto livre limitado, por exemplo
2000 caracteres). `source` é fixado pelo servidor em `video_call`, nunca
enviado pelo modelo. O texto de `qualificationSummary` é dado armazenado, não
instrução: se um dia voltar para dentro de um prompt (por exemplo, um resumo
de handoff), volta rotulado como dado não confiável, igual a qualquer outro
conteúdo externo sob o Art. 15.

As duas ações não têm dependência estrutural uma da outra. `register_lead` e
`schedule_meeting` podem acontecer em qualquer ordem na mesma sessão; o
receipt de confirmação de reunião guarda uma referência opcional (nullable)
para um lead já registrado na mesma sessão, só para correlação, nunca uma FK
obrigatória.

### `PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED`, um flag novo e independente

`PORTAL_RUNTIME_BRIDGE_ENABLED` e `PORTAL_PROVIDER_TERMINATION_ENABLED` não
mudam de comportamento, não são lidos por nenhum código novo deste domínio e
não precisam estar `true` para este domínio funcionar. Um módulo novo,
`apps/portal/src/lib/runtime/portal-business-action-bridge.ts`, some próprio
`processEnabled` sobre `PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED`, com o mesmo
padrão fail-closed por padrão que todo flag deste repositório já segue: sem a
variável de ambiente valendo exatamente `"true"`, toda admissão de ação de
negócio retorna rejeitada com o código `bridge_disabled`, sem tentar nenhuma
leitura ou escrita.

A independência é estrutural, não só de nome de variável: o novo módulo não
importa nem chama `admitPortalChannel`, `consumePortalChannelGrant`,
`assertPortalChannelActive` nem qualquer outra função de
`portal-channel-runtime-bridge.ts`, porque todas elas checam
`PORTAL_RUNTIME_BRIDGE_ENABLED` internamente; chamá-las recriaria a
dependência que Fernando pediu para evitar. O que o novo módulo reaproveita é
o *dado* já durável que o canal, quando admitido, deixa gravado nas tabelas
genéricas `public.sessions`, `public.session_participants`,
`public.disclosure_records` e `public.consent_evidence`, e isso é lido por
uma RPC de leitura própria, nunca pela RPC do bridge de canal.

Na prática isso significa que, hoje, com `PORTAL_RUNTIME_BRIDGE_ENABLED=false`
em produção, uma chamada de vídeo autenticada do Portal ainda não admite
canal nenhum (`startVideoConversation`/`startPresentationConversation` já
retornam `bridge_disabled` antes de chegar à Tavus), então também não existe
sessão viva para uma ação de negócio agir em cima. Isso não é uma dependência
de código entre os dois flags, é uma consequência factual de que sem sessão
não há em que ação de negócio se apoiar. No dia em que o time de canal ligar
`PORTAL_RUNTIME_BRIDGE_ENABLED` para um tenant aprovado (rollout do ADR-038),
as ações de negócio deste ADR continuam precisando do próprio flag,
independentemente, ligado à parte.

### Sessão, disclosure e consentimento: reúso de dado durável, funil próprio

O ADR-038 já resolve, para qualquer canal admitido, disclosure de identidade
de IA (Art. 6) e consentimento de `essential_processing` (Art. 5) antes de a
sessão existir. Este domínio reaproveita exatamente essa evidência: a nova
RPC de admissão de ação de negócio lê `sessions.disclosure_status` e
`sessions.consent_status` da sessão referenciada e recusa com
`denied_disclosure`/`denied_essential_consent` se qualquer um dos dois não
estiver em `delivered`/`granted`. Ela também confere que o `presenterId` do
intent bate com `sessions.active_presenter_id` corrente, o mesmo controle de
One Mouth Rule (Art. 2) que o bridge de canal já aplica para cena.

Agendar uma reunião real e registrar um lead vão além do que
`essential_processing` cobre. `essential_processing` autoriza rodar a
conversa; persistir PII de contato para follow-up e escrever um evento real
na agenda de um humano, com convite por e-mail para um terceiro, são
finalidades adicionais e distintas, no sentido que o Art. 5 já prevê ("no
mínimo" implica que a lista de finalidades pode crescer). Este ADR declara
duas finalidades novas: `lead_data_capture`, exigida para `register_lead`, e
`meeting_scheduling`, exigida para `confirm_meeting_slot` (não para
`propose_meeting_slots`, que não tem efeito externo nem grava PII além da
sessão). As duas são capturadas com o mesmo mecanismo que já existe hoje em
`presentation-room.tsx`: dois checkboxes novos no mesmo `fieldset` de
consentimento pré-chamada, ao lado de gravação, transcrição e análises,
escritos como `consent_evidence` antes de a chamada começar. A escrita em si
não passa pela RPC do bridge de canal (`portal_admit_runtime_channel_service`,
que só aceita o conjunto fechado `recording`/`persistent_transcription`/
`behavioral_analysis`/`visual_analysis`/`scene_presentation`); usa a RPC nova
deste domínio, gravando na mesma tabela genérica `public.consent_evidence`
que já é tenant-scoped e RLS forçada. Ausência de consentimento não impede a
chamada essencial: sem `lead_data_capture`, `register_lead` fica
indisponível; sem `meeting_scheduling`, `confirm_meeting_slot` fica
indisponível, mas `propose_meeting_slots` continua funcionando (Art. 5,
"ausência de consentimento adicional não impede a conversa essencial").

### Credencial do Google Calendar por tenant, um tipo de segredo novo neste repositório

Isto é infraestrutura nova, não uma extensão de algo que já existe:
`packages/security/src/secret-handles.ts` define o contrato de
`SecretBroker`, mas só tem uma implementação fake determinística sem backend
real, e todo provider hoje (Tavus, Recall, OpenRouter, Stripe) usa uma chave
de plataforma única em variável de ambiente, nunca uma credencial por
tenant. OAuth do Google Calendar é o primeiro segredo por tenant deste
produto, e é da classe mais sensível: um refresh token de longa duração que
dá acesso à agenda real de um humano real. O Art. 15 proíbe segredo em banco
em texto puro.

A decisão é usar o Supabase Vault (`pgsodium`, já disponível na plataforma
Supabase, sem exigir um serviço de KMS novo para operar e pagar): o refresh
token entra em `vault.create_secret` no mesmo momento em que o callback OAuth
é processado; a tabela nova `portal_business_action_calendar_connections`
guarda só o `vault_secret_id` (referência opaca), nunca o valor. O access
token de curto prazo (cerca de uma hora) nunca é persistido; é derivado do
refresh token, dentro do processo do servidor, no momento exato da chamada à
API do Google, e não sai do escopo dessa chamada, nem para log, nem para o
modelo, o mesmo princípio que `SecretLease` já formaliza para segredo de
provider. Revogação é uma ação explícita do `tenant_admin` em Configurações:
chama o endpoint de revogação do Google, apaga o segredo do Vault e marca a
linha `revoked`. Reautenticação forçada (`reauth_required`) é detectada por
um worker periódico que reusa o padrão já existente de `worker_heartbeats`
para verificar a validade do refresh token em intervalo fixo; um
`invalid_grant` do Google vira `reauth_required` na linha, e toda tentativa
de `confirm_meeting_slot` para aquele tenant passa a recusar com um motivo
declarado ("a agenda desta conta precisa ser reconectada"), nunca falha
silenciosa (Art. 14).

Isto é uma decisão de custódia de credencial de acesso a um sistema de
terceiro, a mesma classe de risco que Fernando já marca como ALTO
(banco/auth/pagamento/deploy). Está marcada em destaque aqui de propósito:
exige gate humano antes de qualquer tenant real conectar uma conta Google de
verdade, e a revisão de segurança específica do fluxo OAuth (escopos pedidos,
tela de consentimento do Google, verificação do app) é trabalho à parte deste
ADR, não coberto por ele.

### Registrar lead: efeito interno, sem barreira de "unknown"

`register_lead` não chama nenhum provider externo, é uma escrita direta no
Supabase. Diferente de uma reserva de efeito pago (ADR-036), uma transação
Postgres não deixa um estado ambíguo do tipo "não sei se aconteceu": ou
commitou ou não. Aplicar a máquina de estados inteira do ADR-036 aqui seria
construir para um problema que este efeito não tem (Art. 17, simplicidade
deliberada). A idempotência de `register_lead` é a mesma technique que já
protege `portal_runtime_channel_bindings`: uma chave única
`(tenant_id, idempotency_key)`, derivada do `commandFingerprint` do intent, e
um `insert ... on conflict do nothing` seguido de leitura, de modo que uma
segunda tool call idêntica (retry de rede do lado do Tavus, ou o modelo
chamando a tool duas vezes) devolve o mesmo `leadId`, nunca cria um segundo
lead.

### Agendar reunião: reserva durável no padrão do ADR-036, com uma vantagem real do Google Calendar

`confirm_meeting_slot` chama a API do Google, e uma chamada de rede pode
falhar de forma ambígua (timeout depois do Google já ter criado o evento).
Isto tem exatamente a mesma classe de risco que uma reserva de efeito pago:
merece a mesma disciplina reserved → provider_in_flight → committed/unknown →
completed que o ADR-036 já formalizou para Tavus e Recall, reaproveitando o
mesmo vocabulário de estado para quem já opera aquele sistema reconhecer o
padrão. A diferença é que o Google Calendar dá uma ferramenta de recuperação
que Tavus e OpenRouter não davam: `Events.insert` aceita um `id` gerado pelo
próprio chamador, e uma segunda tentativa com o mesmo `id` falha com conflito
em vez de criar um evento duplicado; e `Events.get(calendarId, eventId)`
permite perguntar ao Google, depois do fato, se aquele evento existe. Isto é
uma capacidade de API amplamente documentada do Google Calendar, mas ainda
não verificada contra a conta real do primeiro tenant deste produto, então
conta como hipótese de integração a validar (Art. 16), não fato confirmado.
O desenho da reserva já assume essa vantagem: o `google_event_id` é gerado
pelo servidor e gravado na linha ainda em `reserved`, antes de qualquer
chamada ao Google, para que a reconciliação de uma linha `unknown` tente
primeiro um `Events.get` automático e bounded, e só caia para reconciliação
manual de dois operadores (o padrão dual-approval que o ADR-038 já construiu
para o M5-02) se o lookup automático também falhar ou for inconclusivo. Isto
é estritamente melhor que o caminho manual-only que o Tavus exigiu.

A reserva não tenta reaproveitar a tabela `provider_effect_reservations`
existente: os buckets de cap, as colunas de billing e o conjunto de
providers daquela tabela são todos específicos de Tavus/Recall/OpenRouter, e
forçar agendamento de calendário para dentro dela seria o tipo de modelagem
por JSONB/polimorfismo que o Art. 17 já proíbe. A tabela nova,
`portal_business_action_calendar_reservations`, é estruturalmente paralela,
não compartilhada; o que é reaproveitado é o *worker* de varredura periódica
que o ADR-036 já roda (o mesmo sweep de dez minutos que transiciona uma linha
presa em `provider_in_flight` para `unknown`), estendido para também varrer
esta tabela nova no mesmo ciclo, em vez de subir um segundo processo.

### Aprovação automática vs. confirmação humana: decidido

Esta era a decisão de maior risco não óbvio do documento inteiro. Fernando
decidiu explicitamente (2026-08-24): quer a IA agindo sem um operador humano
na confirmação — "a IA agente sem humano na operação". A confirmação que
gate a criação do evento real não é um passo de um funcionário do tenant; é
a própria resposta afirmativa do participante na chamada, capturada no
transcript e ecoada de volta como a tool call tipada `confirm_meeting_slot`
(nunca texto livre virando ação). O mecanismo abaixo (`auto_confirm_scheduling`,
por tenant, padrão `false`) é exatamente o que implementa essa decisão sem
abrir mão do fence de idempotência, consentimento de finalidade específica e
kill switch: o "padrão `false`" é sobre o rollout ficar dark até o tenant
piloto ser aprovado (mesma disciplina de toda flag nova deste repositório),
não sobre exigir um humano no loop quando ligado.

`propose_meeting_slots` nunca precisa de aprovação: não tem efeito externo,
é equivalente a uma leitura de disponibilidade. A recomendação é que ela
fique sempre disponível assim que as condições de admissão (flag, sessão,
disclosure, consentimento essencial) estiverem satisfeitas.

`confirm_meeting_slot` cria um efeito real e notifica um terceiro real. Exigir
um operador humano aprovando cada agendamento em tempo real contradiz o que
Fernando já decidiu (o modelo agenda sozinho); a maioria das chamadas não tem
ninguém olhando ao vivo. Mas confiar cegamente na tool call do modelo, sem
nenhum controle além do funil de admissão, deixa a decisão de "esta pessoa
disse sim de verdade" inteiramente dentro do julgamento do modelo durante
uma conversa ao vivo, exatamente a superfície que injeção de prompt via
transcript (Art. 15) tentaria explorar.

A recomendação é um interruptor de configuração por agente,
`auto_confirm_scheduling`, controlado pelo `tenant_admin` do tenant, com
padrão `false` (igual a todo flag novo deste repositório). Com o interruptor
desligado, o intent de confirmação ainda é admitido e recebe um receipt
(`denied_policy`, motivo `auto_confirm_disabled`), e o texto devolvido ao
modelo é desenhado para render a doutrina de handoff que o `metodo-silva.ts`
já usa hoje ("vou conectar você com o time para confirmar o horário"), nunca
uma falha muda. Com o interruptor ligado, a tool call tipada do modelo
(`confirm_meeting_slot`, só podendo referenciar um horário já oferecido) é
tratada como o limite de decisão governado, o mesmo princípio de confiança
que já vale para `SceneIntent`: o modelo não tem autoridade sobre texto
livre, mas tem autoridade sobre uma decisão tipada e fechada, protegida por
fence de idempotência, consentimento de finalidade específica e kill switch.
Ligar `auto_confirm_scheduling` para um tenant é, na prática, uma decisão de
confiança do mesmo peso que ligar `PORTAL_RUNTIME_BRIDGE_ENABLED` para um
tenant aprovado no rollout do ADR-038: por tenant, deliberada, não um
default de produção.

### Receipt e kill switches próprios

Toda tentativa de `BusinessActionIntent`, aceita ou recusada, grava uma linha
em `portal_business_action_receipts` (o `tool_execution_receipt` do Art. 7
para este domínio): `tenantId`, `sessionId`, `agentId`, `presenterId`,
`grantId`, `actionKind`, `policyDecision`, `outcome`
(`succeeded`/`rejected`/`failed`/`unknown`), uma referência opcional ao
resultado (`leadId` ou `reservationId`) e um `effectHash` quando aplicável. O
Presenter só anuncia sucesso depois de um receipt `succeeded`, nunca antes
(Art. 7, última frase). A tabela é append-only, RLS forçada, sem policy para
`authenticated`/`anon`, só `service_role`, o mesmo padrão de toda tabela do
ADR-038.

`portal_business_action_kill_switches` e `..._kill_switch_events` são novas,
com a mesma forma (`tenant_id`, `agent_id` opcional, `action_kind` opcional,
`enabled`, motivo, autor) e a mesma semântica (ausência de linha significa
não bloqueado; uma linha com `enabled=false` bloqueia o escopo dela) do par
equivalente do ADR-038, mas são instâncias próprias, sem relação de dado ou
de código com `portal_runtime_kill_switches`. Isso dá à operação um jeito de
desligar só `register_lead` ou só `confirm_meeting_slot` para um tenant
específico, sem tocar em nada do canal de vídeo.

### Fronteira navegador → servidor: diferente da cena, de propósito

O `SceneIntent` de hoje é recusado inteiramente no navegador, sem nenhuma
chamada de rede: o comentário no topo de `presentation-room.tsx` já deixa
isso explícito. Uma ação de negócio não pode seguir o mesmo caminho, porque
a decisão de aceitar ou recusar depende de estado durável no servidor
(consentimento, calendário conectado, kill switch, interruptor de
auto-confirmação) que o navegador não tem e não deve ter. O handler de
`conversation.tool_call` para as três tools novas precisa, portanto, chamar
uma Server Action nova (por exemplo `executeBusinessActionIntent`), aguardar
o resultado e só então responder `conversation.tool_result` ao Tavus com uma
frase curta em linguagem natural (nunca com o `receipt` bruto, nunca com
identificador interno). O texto devolvido ao modelo é só a superfície
conversacional; o que governa qualquer coisa real é o receipt gravado no
banco, nunca a string que o modelo lê de volta (Art. 3). Isto é uma peça de
implementação fora do escopo deste ADR (fica para o ticket que liga o flag),
mas o contrato de fronteira já fica fixado aqui: raciocínio de política
nunca roda no navegador para nenhum `BusinessActionIntent`.

Uma chamada real ao Google (freebusy para `propose`, `insert` para
`confirm`) não é instantânea, e uma tool call Tavus tende a pausar a fala do
avatar até o `tool_result` voltar. Isto é um problema de UX a resolver no
texto do prompt de vídeo (`metodo-silva.ts`, edição futura, fora deste ADR),
não uma decisão de arquitetura: a doutrina de conduta já dá o padrão certo
("deixa eu já checar sua agenda aqui" em vez de silêncio), o mesmo recurso
que um closer humano usa para preencher um instante de busca.

## Migração 0051: tabelas e RPCs (nível de design, sem SQL completo)

A última migration de `database/supabase-only/` era `0048_tavus_stage_settlement_timestamp.sql`
quando este design foi escrito, tornando `0049` o próximo número livre. Antes desta
migration mergear, porém, uma sessão concorrente aplicou em produção suas próprias
`0049_portal_text_preview_admission.sql` e `0050_meeting_terminal_notification_claim.sql`
(feature não relacionada) — o número livre real na hora do merge passou a ser `0051`
(D-V2-145 em `docs/operations/DECISIONS_LOG.md` registra a renumeração).

Tabelas novas, todas com `tenant_id app.uuid_v7 not null`, RLS forçada, sem
policy para `authenticated`/`anon`/`service_role` direto (só RPC
`SECURITY DEFINER`), no mesmo padrão de toda tabela do ADR-038:

- `portal_business_action_kill_switches` e `portal_business_action_kill_switch_events`
- `portal_business_action_agent_settings` (hoje só a coluna `auto_confirm_scheduling boolean not null default false`, mais autor e timestamp da última alteração)
- `portal_business_action_grants` (a admissão do `BusinessActionIntent`: sessão, presenter, `action_kind`, `command_fingerprint`, `generation`, estado `issued`/`blocked`/`expired`, expiração mais longa que o grant de canal, por exemplo 60 minutos, para sobreviver a uma conversa de vendas inteira)
- `portal_business_action_receipts` (o `tool_execution_receipt` deste domínio, um por grant)
- `portal_business_action_leads` (a linha durável do lead: `contact_name`, `contact_email`, `contact_phone`, `qualification_summary`, `source` fixo, `idempotency_key` único por tenant)
- `portal_business_action_proposals` e `portal_business_action_proposal_slots` (a versão durável do `Map` de `calendar/index.ts`; slots como linhas tipadas, `start_at timestamptz`/`end_at timestamptz`/`timezone text`, nunca um array em JSONB, por causa do Art. 17)
- `portal_business_action_calendar_reservations` (a reserva durável no padrão ADR-036: `state` em `reserved`/`provider_in_flight`/`committed`/`unknown`/`cleanup_pending`/`completed`/`released`; `google_event_id` gerado pelo servidor antes do dispatch; colunas de reconciliação espelhando `provider_effect_reservations`)
- `portal_business_action_calendar_connections` (uma linha por tenant: `google_account_email`, `calendar_id`, `default_timezone`, `vault_secret_id`, `status` em `connected`/`revoked`/`reauth_required`, autor e timestamps de conexão/revogação)

RPCs novas, todas `service_role`-only, revogadas de `public`/`anon`/`authenticated`:

- `portal_set_business_action_kill_switch_service`
- `portal_business_action_status_service` (leitura de flag/kill switch, análoga a `portal_runtime_channel_status_service`)
- `portal_set_business_action_agent_settings_service` (grava `auto_confirm_scheduling`, exige `tenant_admin`)
- `portal_admit_business_action_service` (a admissão central: lê sessão/disclosure/consentimento, confere presenter e geração, confere kill switch, grava o grant)
- `portal_register_business_lead_service` (executa `register_lead`, idempotente, grava receipt)
- `portal_propose_business_meeting_slots_service` (persiste a proposta e os slots computados pela aplicação a partir do freebusy do Google, grava receipt)
- `portal_reserve_business_meeting_slot_service` (passo 1 de `confirm_meeting_slot`: valida a proposta e o slot ofertado, cria a reserva em `reserved`, gera o `google_event_id`)
- `portal_dispatch_business_meeting_reservation_service` (fence `reserved` → `provider_in_flight`, chamado imediatamente antes da chamada ao Google)
- `portal_commit_business_meeting_reservation_service` (`provider_in_flight` → `committed`, grava receipt `succeeded`)
- `portal_release_business_meeting_reservation_service` (libera só falha comprovada pré-dispatch, por exemplo proposta expirada ou conflito, nunca depois da chamada ao Google)
- `portal_mark_business_meeting_reservation_unknown_service` (marca `unknown` após falha ambígua pós-dispatch)
- `portal_reconcile_business_meeting_reservation_service` (tenta o lookup automático `Events.get`; se inconclusivo, exige o mesmo dual-approval de dois operadores que o ADR-038 já formalizou)
- `portal_connect_google_calendar_service`, `portal_disconnect_google_calendar_service`, `portal_google_calendar_connection_context_service` (esta última só de leitura, para a aplicação buscar `vault_secret_id`/`calendar_id` antes de chamar o Google, nunca exposta fora de `service_role`)

`portal_schema_capabilities_service()` existente ganha chaves novas
(`businessActionGrants`, `businessActionReceipts`, `businessActionLeads`,
`businessActionCalendarReservations`, `businessActionCalendarConnections`,
`businessActionKillSwitches`), sem remover nenhuma chave atual; a versão do
probe sobe para 49. Nenhuma RPC ou tabela existente é estreitada por esta
migration.

## Alternativas consideradas

1. Reaproveitar `portal_runtime_channel_bindings`/`portal_admit_runtime_channel_service`
   como o grant de admissão também para ações de negócio. Rejeitado: acopla
   este domínio a `PORTAL_RUNTIME_BRIDGE_ENABLED`, exatamente o que Fernando
   pediu para evitar, e mistura a semântica de "abrir canal de mídia" com a
   de "autorizar uma ação de negócio dentro de uma sessão já aberta".
2. Reaproveitar `provider_effect_reservations` para a reserva do Google
   Calendar. Rejeitado: as colunas de billing/cap bucket daquela tabela são
   específicas de Tavus/Recall/OpenRouter; forçar o domínio de calendário lá
   dentro seria modelagem por overload, contra o Art. 17.
3. Deixar `qualificationSummary` e o e-mail do contato entrarem direto numa
   mensagem `system` para reaproveitamento futuro por outro agente/sessão.
   Rejeitado pelo Art. 15: dado de conversa vira dado armazenado, nunca
   instrução; se algum dia voltar a um prompt, entra rotulado como dado não
   confiável, igual a qualquer transcript.
4. Exigir aprovação humana síncrona (um operador clicando "aprovar") para
   toda confirmação de reunião, sem interruptor por agente. Rejeitado:
   contradiz a decisão já tomada por Fernando de que o modelo agenda sozinho,
   e a maioria das chamadas não tem operador olhando ao vivo; o interruptor
   `auto_confirm_scheduling` por agente dá o mesmo controle sem essa
   contradição.
5. Guardar o refresh token do Google diretamente numa coluna cifrada com uma
   chave própria da aplicação, sem Supabase Vault. Rejeitado por agora: exige
   construir e operar gestão de chave própria que a plataforma já oferece
   pronta; revisitar se o produto sair do Supabase.

## Consequências

O Portal ganha o primeiro segredo por tenant deste repositório (OAuth do
Google Calendar), o que abre a porta para outros providers por tenant no
futuro sem repetir o desenho. Duas finalidades de consentimento novas
(`lead_data_capture`, `meeting_scheduling`) se somam à lista mínima do
Art. 5. A agente ganha duas tools novas cujo texto de doutrina ainda precisa
ser escrito em `metodo-silva.ts` (quando e como oferecer agendar, como reagir
a `auto_confirm_disabled`), fora do escopo deste ADR. O worker de
reconciliação do ADR-036 ganha uma segunda tabela para varrer, sem virar um
processo novo. A operação ganha dois pares de kill switch independentes dos
já existentes, e um interruptor por agente que Fernando controla sem precisar
de deploy. Nenhuma tabela ou RPC existente é estreitada; nenhuma promessa de
efeito real é feita ao modelo antes de um receipt confirmado.

## Rollout e rollback

Esta migration mexe em banco (tabelas novas, RLS, RPCs `service_role`) e
introduz custódia de credencial de OAuth (classe auth), duas das quatro
categorias que Fernando classifica como risco ALTO; a aplicação em produção
exige gate humano antes e depois, como qualquer mudança dessa classe. Deploy
segue o mesmo padrão expand-only já usado desde o ADR-036/038: aplicar 0051
antes de subir o artefato de aplicação que a usa; nenhuma tabela ou RPC
anterior é removida ou estreitada, então o rollback de aplicação para antes
de 0051 continua seguro (o código antigo simplesmente ignora as tabelas
novas). `PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED` começa `false` em todo
ambiente, inclusive produção, até uma validação de schema/capacidades e um
canário de tenant aprovado, o mesmo discipline de rollout que o ADR-038 já
descreve para `PORTAL_RUNTIME_BRIDGE_ENABLED`. Nenhum tenant deve conectar
uma conta Google real antes da revisão de segurança do fluxo OAuth citada
acima. Rollback do flag é imediato (voltar para `false` bloqueia toda
admissão nova sem afetar nenhuma reserva/lead já commitado); rollback de uma
reserva de calendário individual nunca é automático, segue a mesma regra do
ADR-036, só um lookup que prove ausência de efeito ou uma compensação
confirmada libera a reserva.

## Decisões do dono do produto

**Resolvidas antes do início do código (2026-08-24):**
- **Auto-confirmação sem operador humano**: decidido — ver "Aprovação
  automática vs. confirmação humana: decidido" acima. A confirmação vem da
  própria resposta do participante na chamada, nunca de um funcionário do
  tenant; `auto_confirm_scheduling` fica disponível desde a onda 1, com
  rollout dark (`false`) por tenant até aprovação.
- **Provider de calendário**: Google Calendar (não Cal.com), o que já está
  refletido em todo este documento — implica OAuth por tenant, não uma chave
  de API única.
- **As 2 finalidades novas de consentimento** (`lead_data_capture`,
  `meeting_scheduling`): aprovadas, reaproveitando a tela de checkbox
  pré-chamada existente.

**Gates de pré-lançamento, não bloqueiam o início da implementação:**
- Revisão de segurança dedicada do fluxo OAuth do Google (escopos, tela de
  consentimento, custódia via Supabase Vault) antes de qualquer tenant
  conectar uma conta real.
- Política de retenção explícita de PII do lead/prospect (pessoa que nunca
  usou o Portal, não é dono de conta) — provisoriamente alinhada ao mesmo
  prazo já usado para dado de contato em `ADR-016`, a confirmar antes do
  primeiro tenant piloto real.
- Confirmação de uma frase sobre o convite automático por e-mail ao prospect
  no `confirm_meeting_slot` (`sendUpdates` do Google) — assumido como
  comportamento padrão porque é o objetivo do produto; revisitar se algum
  tenant piloto pedir o contrário.
- Aplicação da migration 0051 em produção segue o mesmo gate humano de toda
  migration deste porte (autorização explícita antes e depois, nunca
  automática).

## Revisit trigger

Revisitar quando um segundo provider de calendário por tenant for necessário
(o desenho já isola `provider_id` na tabela de reserva para isso), quando o
Action Runtime genérico descrito em `docs/architecture/ACTION_AND_TOOL_RUNTIME.md`
ganhar um contrato de produção capaz de substituir este bridge específico de
domínio, ou quando a doutrina de auto-confirmação precisar de um degrau
intermediário entre "desligado" e "o modelo decide sozinho", por exemplo um
teto diário de confirmações automáticas por tenant.
