# ADR-040: Checkout do cliente final do tenant via Stripe Connect (o closer fecha e cobra)

**Status:** Aceito (2026-08-28). O ponto de decisão que bloqueava o início do
código, se `request_checkout` podia ser tão autônomo quanto
`confirm_meeting_slot` ou exigia aprovação humana do tenant antes de o link
sair, foi resolvido por Fernando Silva: aprovação humana obrigatória. Ver
"Decisões do dono do produto" e a seção "Aprovação humana do tenant: máquina
de estados, prazos e entrega" abaixo. Os itens restantes são gates de
pré-lançamento, não bloqueiam o início do código.
**Data:** 2026-08-25
**Revisão:** 2026-08-28. Fernando decidiu o oposto da recomendação original
deste ADR (autonomia protegida por camadas): `request_checkout` exige
aprovação humana do `tenant_admin` antes de o link ser gerado. Isso não é só
marcar uma decisão como resolvida, é uma mudança real de máquina de estados
e de fluxo, porque a versão anterior deste documento assumia o link saindo
em tempo real, dentro da própria chamada de vídeo. As seções "Fluxo de
confirmação", a nova "Aprovação humana do tenant", "Idempotência e fence",
"Receipt e auditoria", "Migração 0052", "Alternativas consideradas",
"Consequências", "Rollout e rollback" e "Decisões do dono do produto" foram
todas revisadas para refletir isso; o mecanismo Stripe Connect Standard, o
catálogo fechado, a idempotência no padrão ADR-036 e o split de plataforma
não mudaram.
**Relacionados:** Art. 3, 5, 6, 7, 8, 9, 15, 17 da Constituição; ADR-004, ADR-005, ADR-007, ADR-009, ADR-010, ADR-015, ADR-016, ADR-021, ADR-032, ADR-036, ADR-038, ADR-039

## Contexto

O Portal hoje só sabe cobrar em uma direção: a Axtro cobrando o próprio
tenant pela assinatura do Digital Human OS. `apps/portal/src/lib/actions/billing.ts`
cria e gerencia essa assinatura (planos `piloto`/`crescimento`/`escala` de
`apps/portal/src/lib/billing/plans.ts`, migrations 0025 a 0042), com o
dinheiro sempre indo para a conta Stripe da própria Axtro
(`STRIPE_SECRET_KEY`, uma chave de plataforma única). Não existe hoje
nenhuma capacidade de o tenant cobrar o cliente final dele, o prospect que
está numa chamada de vídeo com o closer.

Dois pedaços de código já tocam nesse espaço e nenhum dos dois serve para o
que Fernando pede agora. `apps/portal/src/lib/actions/proposal.ts`
(`sendClosingProposal`) é o fluxo "fechamento ao vivo" de D-V2-123: um admin
revisa empresa, e-mail e plano depois de uma call e dispara um e-mail de
proposta. O plano vendido ali é sempre um dos três planos do próprio Digital
Human OS (`PLAN_CATALOG`, confirmado em `plans.ts`), ou seja, esse fluxo é a
Axtro vendendo a própria assinatura da Axtro para um prospect, usando o
próprio closer como demonstração e canal de vendas. Não é o tenant vendendo
o produto ou serviço dele. Em produção esse checkout está bloqueado, com o
comentário do próprio arquivo explicando por quê: "ADR-036 exige intent
persistida, fence e reconciliação também para uma assinatura iniciada por
prospect. Esse fluxo ainda não possui a entidade service-owned; não criar a
sessão é mais seguro do que cobrar duas vezes após timeout/retry do Server
Action." `packages/provider-stripe/src/index.ts` já tem um método
`createProspectCheckoutSession` desenhado para esse mesmo caso (sem
`tenantId`, sem assinatura durável do tenant, só uma sessão avulsa para
"uma empresa que ainda não é cliente"), mas uma busca no monorepo confirma
que esse método não é chamado por nenhum código de aplicação hoje: é capacidade
morta, à espera de `proposal.ts` resolver sua própria pendência de intent
durável, um problema estruturalmente diferente do que este ADR resolve.

O segundo pedaço é `packages/tool-adapters/proposal/src/index.ts`. O
comentário no topo do arquivo já declara o escopo: "M3-05: generate a
proposal preview from confirmed inputs and an approved template, never
send it (...) this package has no send capability at all." O pacote modela
bem um princípio que este ADR reaproveita (preço vem sempre de um catálogo
aprovado ou de um receipt anterior, nunca de texto do modelo), mas é
estruturalmente uma prévia sem efeito (`isDryRun: true`), sem tenant Stripe
Connect, sem reserva durável e sem envio.

O que falta, portanto, não é uma variação de nenhum dos dois: é um domínio
novo. Fernando quer que o closer, durante a própria chamada de vídeo, feche
e cobre de verdade um produto ou serviço que pertence ao TENANT, com o
dinheiro indo para a conta Stripe do tenant, não da Axtro. Isso significa
autorizar um provider a mover dinheiro de um cartão de um terceiro real (o
prospect, que nunca criou conta no Portal) para uma conta de um segundo
terceiro real (o tenant). É a primeira vez que o produto processa dinheiro
que não é nem da Axtro nem do próprio tenant assinante: dois dos quatro
domínios de risco ALTO que Fernando já classifica (banco e pagamento) se
sobrepõem aqui ao mesmo tempo, e a superfície de fraude, estorno e reclamação
é categoricamente maior do que qualquer efeito já desenhado neste
repositório.

O ADR-039, aceito um dia antes deste, já resolveu o mesmo formato de
problema para dois domínios sem dinheiro (agendar reunião, registrar lead):
o modelo emite uma tool call tipada, o servidor decide, uma reserva durável
no padrão do ADR-036 protege qualquer chamada de rede ambígua a um provider
externo. Este ADR aplica a mesma disciplina a um terceiro domínio, cobrança,
decidindo explicitamente onde reaproveitar a maquinaria do ADR-039 e onde
divergir por causa da classe de risco mais alta.

## Decisão

### `request_checkout`, a quarta ação sob o mesmo `BusinessActionIntent`

A cobrança se torna uma quarta tool, `request_checkout`, somada às três já
desenhadas pelo ADR-039 (`propose_meeting_slots`, `confirm_meeting_slot`,
`register_lead`). Ela usa o mesmo envelope de servidor: `tenantId`,
`agentId`, `sessionId` e `presenterId` resolvidos da sessão autoritativa
(nunca do corpo da tool call), `actionKind` fixo em `request_checkout`, o
mesmo `commandFingerprint` (hash de tenant, sessão, `actionKind`, argumentos
e o `tool_call_id` opaco do Tavus) e o mesmo `generationId` ecoado da sessão
corrente para rejeitar uma tool call estale de uma geração já superada. A
admissão passa pela mesma RPC central do ADR-039
(`portal_admit_business_action_service`), que já confere disclosure,
consentimento essencial, presenter e geração, sem duplicar essa lógica.

A decisão de reaproveitar em vez de construir um segundo bridge (ex.:
`PaymentActionIntent` independente) é deliberada, não um atalho. O problema
de admissão (esta sessão está com disclosure entregue, consentimento
essencial concedido, o presenter certo segurando o floor, a geração certa) é
idêntico nos quatro domínios: só muda o que acontece depois da admissão.
Construir um segundo funil de admissão para cobrança duplicaria código que já
existe, dobraria a superfície de auditoria sem ganhar segurança nenhuma (Art.
17, simplicidade deliberada) e obrigaria Fernando a raciocinar sobre dois
flags de fail-closed independentes para o mesmo tipo de decisão (sessão
elegível para uma ação de negócio ou não). O risco mais alto de cobrança não
mora na admissão, mora na execução (catálogo fechado, conta Stripe do
tenant, reserva durável, webhook assinado, e agora aprovação humana antes de
qualquer chamada à Stripe) e no controle de rollout, que recebe uma camada
extra descrita abaixo, especificamente por causa dessa classe de risco.

### Duas camadas de flag, mais o kill switch existente

`PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED` (do ADR-039) continua sendo o
interruptor geral de toda ação de negócio: sem ele, nenhuma das quatro tools
é admitida. Cobrança soma uma segunda camada, própria, também fail-closed
por padrão: `PORTAL_BUSINESS_ACTION_CHECKOUT_ENABLED`. É uma variável de
ambiente nova, não uma linha de banco, porque precisa poder zerar toda a
superfície de pagamento do produto inteiro (todos os tenants, mesmo os que
já usam agendamento e lead normalmente) sem depender do banco estar
alcançável ou correto, o mesmo motivo pelo qual `PORTAL_RUNTIME_BRIDGE_ENABLED`
já é uma variável de ambiente e não uma linha de configuração. As duas
variáveis são estruturalmente independentes uma da outra, no mesmo sentido
que o ADR-039 já formalizou para `PORTAL_RUNTIME_BRIDGE_ENABLED` e
`PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED`: nenhum código deste domínio importa
ou depende de código do domínio de calendário/lead além do módulo comum de
admissão.

Abaixo das duas variáveis, um terceiro degrau: `checkout_enabled`, coluna
nova em `portal_business_action_agent_settings` (a mesma tabela onde o
ADR-039 já grava `auto_confirm_scheduling`), controlada pelo `tenant_admin`,
padrão `false`. Isso dá rollout dark por tenant, o mesmo padrão de toda
capacidade nova deste repositório. `request_checkout` só é admitida se as
duas variáveis de ambiente estiverem `"true"`, o kill switch de tenant/agent/
`action_kind` (a mesma tabela `portal_business_action_kill_switches` do
ADR-039, cujo domínio fechado de `action_kind` ganha o valor
`request_checkout` ao lado dos três já existentes) não estiver desligado, o
agente tiver `checkout_enabled=true` e, condição adicional só deste domínio,
o tenant tiver uma conta Stripe conectada e ativa (próxima seção). Ausência
de qualquer uma dessas condições produz uma recusa declarada, nunca uma
falha muda, no mesmo padrão de `auto_confirm_disabled` do ADR-039. Essas
quatro camadas (mais o catálogo e a conta Stripe) continuam decidindo só se
`request_checkout` é admitida, isto é, se uma reserva chega a ser criada;
não decidem mais, sozinhas, se o link sai para o prospect, isso é o assunto
da seção "Aprovação humana do tenant" abaixo.

### Mecanismo de cobrança: Stripe Connect Standard, cobrança direta

A escolha óbvia, dado que o resto do repositório já fala Stripe, é Stripe
Connect. Entre as três formas de conta conectada que a Stripe oferece,
Standard, Express e Custom, a decisão é Standard, com o padrão de cobrança
direta (Direct charges: a Checkout Session é criada diretamente na conta
conectada, usando o cabeçalho `Stripe-Account` junto da chave de plataforma
já existente, `STRIPE_SECRET_KEY`).

O motivo central é liability, não elegância técnica. Numa conta Standard, o
tenant é o merchant of record perante a própria Stripe: ele tem o dashboard
Stripe dele, resolve o próprio KYC direto com a Stripe, responde
diretamente por estorno, disputa e chargeback, e recebe o próprio 1099-K (ou
equivalente) quando aplicável. A Axtro fica na posição de facilitadora da
transação, não de processadora responsável pelo dinheiro de terceiros. Numa
conta Express ou, pior, Custom, a Axtro assume progressivamente mais
responsabilidade operacional e de compliance sobre o dinheiro do prospect e
sobre a relação comercial do tenant com o cliente final dele, exatamente o
tipo de responsabilidade que uma software house pequena, cautelosa com
categoria de risco ALTO, não deveria acumular sem um motivo concreto. Hoje
não existe esse motivo: nenhum tenant piloto pediu onboarding mais suave do
que o fluxo padrão da Stripe, e cobrança direta não exige nenhuma UI de
onboarding própria (a Stripe hospeda o fluxo inteiro), o que também é a
opção mais simples de construir (Art. 17). Se a fricção de onboarding de
conta Standard (o tenant precisa ter ou criar uma conta Stripe própria)
provar ser um bloqueio real para os primeiros tenants piloto, revisitar para
Express é o degrau natural, não Custom.

Cobrança direta com conta Standard também é compatível, sem nenhuma
alteração de desenho, com uma taxa de plataforma (próxima seção): é a
combinação mais documentada da própria Stripe para plataformas que cobram
comissão sobre vendas de terceiros (`docs.stripe.com/connect/direct-charges`,
`docs.stripe.com/payments/checkout/connect`). Isso responde diretamente a
uma pergunta que taxa de plataforma poderia levantar: não, dar suporte a
`application_fee_amount` não muda a escolha de tipo de conta.

### Onboarding: OAuth Standard, sem segredo por tenant no Vault

O ADR-039 tratou credencial do Google Calendar como o primeiro segredo por
tenant do repositório e desenhou custódia via Supabase Vault porque a API do
Google exige um refresh token de longa duração guardado pelo servidor. Este
ADR decide diferente, e a diferença é estrutural, não uma economia de
engenharia: cobrança direta com conta Standard não precisa persistir
nenhuma credencial da conta conectada. O único dado que o Portal guarda por
tenant é o `stripe_account_id` (`acct_...`), que não é segredo (é
equivalente a um customer ID, seguro para uma coluna de banco comum). Toda
chamada em nome do tenant usa a própria `STRIPE_SECRET_KEY` da plataforma
com o cabeçalho `Stripe-Account: acct_...`; é essa combinação, não um token
por tenant, que autoriza a plataforma a agir sobre a conta conectada depois
que a conexão foi estabelecida. Isto é o comportamento documentado da
própria Stripe para esse padrão, mas ainda não foi exercitado contra uma
conta conectada real neste código, então conta como hipótese de integração
a validar (Art. 16), não fato confirmado.

O fluxo de conexão usa o OAuth clássico de conta Standard da Stripe
(`connect.stripe.com/oauth/authorize` seguido da troca de `code` por
`stripe_user_id` em `/v1/oauth/token`), o mesmo formato de "clicar para
conectar" que o Google Calendar do ADR-039 já usa, só que sem persistir o
`access_token` que a Stripe também devolve nessa troca: ele é descartado
depois de confirmar a conexão, porque cobrança direta não precisa dele e
guardar um segredo que nunca é lido é superfície de ataque sem benefício.
O `state` de proteção contra CSRF do redirect OAuth vive num cookie
assinado, HttpOnly, de curta duração (poucos minutos), amarrado a
tenant e ator autenticado, não numa tabela nova: diferente do grant de canal
ou de uma reserva de efeito, esse valor não precisa sobreviver a um restart
do Railway nem coordenar réplicas, só precisa sobreviver à ida e volta do
navegador até a Stripe e de volta, o mesmo raciocínio que já justifica não
usar banco para esse tipo de dado efêmero de um único request-response.

A tabela nova `portal_business_action_checkout_connections` guarda uma linha
por tenant: `stripe_account_id`, um `status` (`connected`, `restricted`,
`disconnected`) e os três booleanos de capacidade que a própria Stripe
expõe (`charges_enabled`, `payouts_enabled`, `details_submitted`),
atualizados pelo evento assinado `account.updated` (mesmo webhook de conta
conectada descrito abaixo). Se `charges_enabled` virar falso depois de ter
sido verdadeiro (ex.: a Stripe pede mais verificação do tenant), o status
vira `restricted` e nenhuma reserva nova de cobrança é admitida até o tenant
resolver a pendência do lado da Stripe; isso é uma recusa declarada, nunca
falha muda (Art. 14), no mesmo espírito do `reauth_required` que o ADR-039
já desenhou para o Google Calendar. Desconectar (`portal_disconnect_stripe_service`,
ação explícita do `tenant_admin`) chama o endpoint de desautorização da
própria Stripe e marca a linha `disconnected`; isso não invalida uma
Checkout Session já `committed`, porque ela já existe de forma independente
do lado da Stripe, hospedada na própria conta do tenant. Toda reserva nova
exige `status='connected'`.

Isto é, junto com o Google Calendar do ADR-039, a segunda peça de
infraestrutura de credencial por tenant deste produto, e continua sendo
categoria de risco ALTO (auth e pagamento ao mesmo tempo, os dois maiores da
classificação de Fernando). Está marcada em destaque aqui de propósito:
exige gate humano antes de qualquer tenant real conectar uma conta Stripe
de verdade, e a revisão de segurança e compliance específica desse fluxo
(escopos OAuth pedidos, habilitação de Connect na própria conta Stripe da
Axtro, aceite dos termos de plataforma Connect da Stripe) é trabalho à
parte deste ADR, listado nos gates abaixo.

### O que é cobrado: catálogo fechado do tenant, nunca texto livre do modelo

O mesmo princípio que já rege `confirm_meeting_slot` (o modelo só confirma
um horário que o próprio servidor já ofereceu) vale aqui com um peso maior:
o modelo nunca informa preço, moeda, desconto ou identificador de preço da
Stripe. `request_checkout` aceita só `productId` (uma chave que precisa
existir e estar `active` no catálogo aprovado do tenant, nunca aceita como
texto livre) e, opcionalmente, `quantity` (inteiro entre 1 e o `max_quantity`
configurado naquela linha de catálogo, padrão 1) e `contactEmail` (validado
por formato; se omitido e a sessão já capturou um e-mail de contato antes,
por `register_lead` ou por `confirm_meeting_slot`, o servidor reaproveita
esse e-mail já validado; se nenhum dos dois existir, a ausência não bloqueia
a criação da reserva, mas passa a importar no momento da aprovação humana,
ver "Aprovação humana do tenant" abaixo).

O catálogo, `portal_business_action_checkout_products`, é configurado pelo
`tenant_admin` antes da call, fora do escopo de código deste ADR (fica para
o ticket que constrói a tela de Configurações), mas o contrato de dados já
fica fixado: cada linha amarra um `product_id` interno do Portal a um
`stripe_price_id` que existe na conta Stripe conectada do próprio tenant,
com nome de exibição, valor e moeda cacheados no momento do cadastro. Antes
de qualquer dispatch, o servidor roda uma verificação de preflight contra o
preço vivo na conta conectada, exatamente a mesma disciplina que
`checkout-preflight.ts` já aplica para o catálogo de assinatura da própria
Axtro: se o preço na Stripe não bater com o que está cacheado (o tenant
mudou o valor direto no dashboard Stripe dele, por exemplo), a reserva não
avança. Isso fecha por construção o mesmo risco que o Art. 15 já nomeia
para transcript: um prompt adversarial não pode fazer o servidor cobrar um
valor que não foi aprovado pelo próprio tenant antes da call. Como o
dispatch agora só acontece depois de uma aprovação humana (abaixo), esse
preflight passa a rodar tipicamente horas depois da reserva ter sido
criada, o que é uma proteção a mais, não a menos: um preço que mudou
enquanto a reserva esperava aprovação também é pego por ele, não só um
preço que já estava errado no momento da call.

V1 não suporta desconto, carrinho com múltiplos produtos na mesma reserva
nem assinatura recorrente para o cliente final (`mode: "payment"`, cobrança
única, sempre). Cada uma dessas é uma extensão real, não um requisito
implícito do pedido de Fernando, e entra como revisit trigger.

### Fluxo de confirmação: pedir, aprovar e completar são três atos diferentes, só o terceiro move dinheiro

Esta continua sendo a decisão de maior risco do documento inteiro, e agora
tem três atos distintos, não dois.

O primeiro ato não é ambíguo e este ADR já o fixa desde a versão original:
o cartão do prospect nunca passa pelo modelo nem pelo backend do Portal.
`request_checkout` produz um link para uma Stripe Checkout Session hospedada
(`checkout.stripe.com`), nunca um formulário de cartão embutido na
interface do Portal (Stripe Elements) e nunca qualquer campo onde o modelo
"digite" um número de cartão. Checkout hospedado mantém o Portal fora do
escopo PCI mais pesado (elegível a SAQ A, o nível mais simples de
autoavaliação PCI), o prospect é quem abre a tela da própria Stripe e digita
os próprios dados, e é literalmente essa ação, o clique em "Pagar" na tela
da Stripe, que constitui a confirmação explícita do próprio prospect que a
tarefa original pede. Não existe um caminho alternativo mais seguro que
ainda cumpra "o closer fecha e cobra de verdade"; isto continua sendo
recomendação firme, não um ponto em aberto.

O segundo ato, gerar o link em si, era o ponto genuinamente aberto da versão
original deste ADR, e foi resolvido por Fernando Silva (2026-08-28), na
direção oposta à recomendação deste documento: `request_checkout` não pode
ser tão autônomo quanto `confirm_meeting_slot`. Um `tenant_admin` do tenant
precisa aprovar cada oferta de cobrança antes de o link ser gerado e
chegar ao prospect. O argumento de Fernando pesa mais do que o argumento
original deste ADR a favor da autonomia: cobrança é dinheiro saindo do
bolso de um terceiro real, e um closer mal calibrado ofertando cobrança
fora de hora, mesmo sem nenhuma fraude envolvida, é um problema comercial e
de reputação que o tenant só descobriria depois do fato; um operador humano
revisando antes de o link sair elimina essa classe de erro por construção,
ao custo de o link nunca mais sair em tempo real dentro da própria call.
Isso não é um ajuste de parâmetro num flag já existente: aprovação humana
assíncrona desacopla o momento em que o link passa a existir do momento da
chamada de vídeo, às vezes por minutos, às vezes por horas, quase sempre
depois de a call já ter terminado. O modelo não pode "esperar" no meio de
uma conversa por uma aprovação de um humano que talvez nem esteja olhando o
Portal naquele instante, então ele deixa de ser o canal de entrega do link.
A seção "Aprovação humana do tenant: máquina de estados, prazos e entrega"
logo abaixo é a máquina de estados nova por inteiro; esta seção mantém só a
decisão e o porquê.

O terceiro ato não mudou: gerar o link não move um centavo, só o prospect
completando o Checkout move. A distinção entre `committed` (o link existe)
e `payment_completed` (o prospect de fato pagou) continua sendo o coração
deste desenho, detalhada na seção "Idempotência e fence" abaixo, só que
agora nenhuma das duas transições acontece dentro de uma call ao vivo nem é
anunciada por um Presenter.

### Aprovação humana do tenant: máquina de estados, prazos e entrega

`request_checkout` continua sendo admitido exatamente como a seção "Duas
camadas de flag" acima descreve: as duas variáveis de ambiente, o kill
switch, `checkout_enabled` do agente, o catálogo fechado e a conta Stripe
conectada decidem, sozinhos, se a tool call é admitida. Nada disso mudou. O
que muda é o que acontece depois da admissão. Antes desta revisão, admissão
levava direto a `reserved` e, poucos segundos depois, a `committed` (o link
já pronto, dentro da mesma execução da tool call). Com aprovação humana
obrigatória, admissão leva a um estado novo, anterior a `reserved`:
`pending_approval`. Nenhuma chamada à Stripe acontece neste estado nem em
nenhum estado anterior a ele.

**O que fica gravado em `pending_approval`, imutável a partir daqui.**
`portal_reserve_business_checkout_service` continua fazendo exatamente a
mesma validação e o mesmo snapshot que já fazia na versão original (valida o
grant, a sessão e o catálogo; roda o preflight de preço vivo contra a conta
Stripe conectada; resolve `contactEmail` de `register_lead`/`confirm_meeting_slot`
se a tool call não trouxe um), só que agora a linha nasce em
`pending_approval`, não em `reserved`. Todo dado que o operador vai aprovar
já está resolvido e travado nesse momento: `product_id`, `display_name`,
`unit_amount_cents`, `currency`, `quantity`, `stripe_price_id`,
`stripe_account_id`, `platform_fee_bps`/`application_fee_amount_cents` (se
algum), `contact_email` (se já capturado) e `lead_id`/`session_id` de
correlação. Nenhum desses valores é recalculado nem regravado depois: o
operador aprova exatamente o que o prospect pediu durante a call, nunca um
preço, uma quantidade ou uma conta Stripe diferente. Se o preço vivo na
Stripe tiver mudado entre a criação da reserva e a aprovação, isso é pego
pelo preflight que já roda antes de qualquer dispatch (o mesmo preflight da
seção "O que é cobrado" acima), não por uma segunda leitura do catálogo
aqui: a linha `pending_approval` não é regravada com um preço novo, o
dispatch simplesmente falha de forma declarada e a reserva não avança.

**Quem aprova, e como.** Só um `tenant_admin` do tenant dono da reserva, a
mesma autorização que já governa `auto_confirm_scheduling` (ADR-039) e o
catálogo de checkout deste próprio ADR. A tela que lista reservas
`pending_approval` e oferece os botões de aprovar/rejeitar é trabalho de
produto fora do escopo de código deste ADR (o mesmo tratamento que o
catálogo e a tela de conexão Stripe já recebem), mas o contrato de RPC já
fica fixado aqui, porque é o que qualquer código futuro dessa tela vai
chamar:

- `portal_approve_business_checkout_service`, `service_role`-only, exige
  `tenant_admin` autenticado do tenant da reserva. Aceita `reservationId` e,
  opcionalmente, `contactEmail` (usado só se a reserva não capturou nenhum
  e-mail durante a call; ver "Entrega do link" abaixo). Fence estrito: só
  transiciona `pending_approval` → `reserved`; chamar sobre qualquer outro
  estado (já aprovado, já rejeitado, já expirado, não encontrado) devolve
  uma recusa declarada (`already_approved`/`already_rejected`/
  `approval_expired`/`not_found`), nunca um erro mudo. Grava `approved_by`
  (o `user_id` do `tenant_admin`) e `approved_at`. Não chama a Stripe: só
  abre o fence para a pipeline que já existia
  (`portal_dispatch_business_checkout_reservation_service` →
  `portal_commit_business_checkout_reservation_service`), disparada em
  seguida, no mesmo fluxo de aplicação que serve o clique de "Aprovar", sem
  alteração de desenho na própria pipeline.
- `portal_reject_business_checkout_service`, mesma autorização e mesmo
  fence, só que transiciona `pending_approval` → `rejected` (estado
  terminal novo). Aceita um `rejectionReason` opcional (texto curto, de
  autoria do operador, nunca do modelo, guardado só para o histórico do
  próprio tenant). Nenhuma chamada à Stripe acontece neste caminho, nunca.

**O que o modelo diz ao prospect na hora.** Como o link não existe mais no
momento da tool call, `request_checkout` nunca mais devolve um link ou uma
promessa de valor ao Tavus: devolve uma frase curta de handoff, no mesmo
espírito da doutrina de `auto_confirm_disabled` que o ADR-039 já desenhou
para agendamento não autônomo. Uma frase de exemplo, só para ilustrar o
tom (o texto final é trabalho de prompt em `metodo-silva.ts`, fora do
escopo de código deste ADR, igual ao resto da doutrina de conduta do closer
já citada neste documento): "vou preparar o link de pagamento com o time e
te envio em seguida". O modelo nunca afirma que o link já foi gerado e
nunca afirma que já foi enviado; depois desta revisão, ele também nunca
mais tem uma segunda oportunidade de anunciar isso durante a mesma call.
Pela primeira vez neste domínio, o produto assume de propósito que o
"sucesso" de `request_checkout` não é algo que o Presenter chega a anunciar
ao vivo. Isso é consistente com o Art. 7 ("o Presenter só anuncia conclusão
após receipt de sucesso"): a consequência de não existir mais um receipt
`succeeded` síncrono para esta ação (ver receipt, abaixo) é justamente que
não existe mais conclusão para o Presenter anunciar dentro da call.

**Entrega do link depois da aprovação.** Quando
`portal_commit_business_checkout_reservation_service` grava `checkout_url`
(o mesmo passo que já existia, só que agora disparado pelo fluxo de
aprovação em vez de pela própria tool call), a aplicação dispara um e-mail
para `contact_email`, reaproveitando a infraestrutura Resend já existente em
`apps/portal/src/lib/email.ts` (o mesmo provedor do SMTP de auth, D-V2-063)
com uma função nova, irmã de `sendProposalEmail`, por exemplo
`sendCheckoutLinkEmail`, no mesmo padrão de "IA rascunha, humano manda" que
`sendClosingProposal` (`apps/portal/src/lib/actions/proposal.ts`) já aplica
para o fechamento ao vivo do próprio Digital Human OS: um clique humano
explícito, depois de revisão, dispara um e-mail para um endereço externo,
best-effort, sem desfazer o efeito já commitado se o envio falhar. Se
`contactEmail` nunca foi capturado, nem por `register_lead`, nem por
`confirm_meeting_slot`, nem no próprio `request_checkout`, a aprovação NÃO
fica bloqueada só por isso, mas o `tenant_admin` precisa fornecer um e-mail
válido no momento de aprovar: o argumento opcional `contactEmail` de
`portal_approve_business_checkout_service` passa a ser obrigatório só nesse
caso específico, com a mesma validação de formato que `sendClosingProposal`
já aplica hoje ao próprio `prospect_email` (`PROSPECT_EMAIL_PATTERN`). Isso
reaproveita, na aprovação, exatamente o mesmo padrão de UI já comprovado
neste repositório, em vez de inventar um segundo formulário de captura de
contato. Se o e-mail falhar no envio (a mesma classe de falha que
`sendClosingProposal` já trata hoje), a reserva continua `committed`, com
`checkout_url` gravado e legível pelo operador na mesma tela, que pode
copiar o link manualmente; a Checkout Session já existe do lado da Stripe
independentemente do e-mail ter saído ou não.

**Prazo de expiração e o que acontece com o receipt.** Uma reserva em
`pending_approval` expira sozinha depois de 72 horas (três dias corridos)
sem que nenhum `tenant_admin` aja sobre ela, gravado em
`approval_expires_at` no momento da criação da reserva. O prazo é fixo, não
configurável por tenant nesta versão (Art. 17): curto o bastante para o
produto não empurrar um link stale para um prospect que já esfriou, comprido
o bastante para atravessar um fim de semana ou um feriado sem que o único
`tenant_admin` do tenant, ausente naquele dia, perca a janela inteira. O
mesmo worker de varredura periódica que o ADR-036 já roda a cada dez
minutos, e que o ADR-039 já estendeu para varrer a reserva de calendário,
ganha mais um alvo: uma RPC nova,
`portal_expire_pending_business_checkout_reservations_service`, transiciona
toda linha `pending_approval` com `approval_expires_at` no passado para
`approval_expired` (estado terminal novo, sem chamada à Stripe em nenhum
momento deste caminho). Este prazo é inteiramente independente da expiração
do grant do `BusinessActionIntent` (60 minutos, ADR-039): um grant expirado
não invalida uma reserva já criada, o mesmo princípio que já vale para uma
reserva de calendário `unknown` sobrevivendo ao grant que a originou.

Isto força reconsiderar o receipt. Na versão original deste ADR, o receipt
do `BusinessActionIntent` marcava `succeeded` no momento em que `committed`
era alcançado, porque isso acontecia dentro da mesma execução da tool call.
Agora não acontece mais: `committed` só é alcançável depois de uma
aprovação humana que pode vir horas ou dias depois, numa execução de
servidor completamente diferente (o clique do `tenant_admin`), sem nenhum
Presenter vivo do outro lado para receber uma conclusão. Gravar `succeeded`
ali continuaria tecnicamente possível, mas violaria o espírito do Art. 7 (
"o Presenter só anuncia conclusão após receipt de sucesso"): não existe mais
conclusão para o Presenter anunciar, porque o Presenter, na prática, já não
está mais na chamada quando isso acontece. A decisão deste ADR é que
`portal_business_action_receipts.outcome` ganha um quinto valor, aditivo,
`pending_approval`, ao lado dos quatro já existentes
(`succeeded`/`rejected`/`failed`/`unknown`). `portal_reserve_business_checkout_service`
grava o único receipt deste grant com `outcome='pending_approval'` no
momento em que a reserva é criada; esse é, na prática, o desfecho final do
receipt para todo `request_checkout` que chega a criar uma reserva, porque
o próprio Art. 7 já ordena a sequência certa (`aprovação quando exigida`
vem antes de `execução idempotente` e de `tool_execution_receipt` no funil
que ele descreve), e a aprovação, quando exigida, nunca acontece dentro da
mesma execução que o receipt síncrono cobre.
`portal_commit_business_checkout_reservation_service` deixa de gravar
receipt (removido nesta revisão; ver "Migração 0052" abaixo): o desfecho
real da cobrança (link gerado e enviado, rejeitado ou expirado sem ação)
fica inteiramente registrado na própria
`portal_business_action_checkout_reservations`, a mesma tabela que a seção
"Receipt e auditoria" já chama de "evidência financeira de verdade",
correlacionável ao receipt só pelo `reservationId` que ele já guarda. Isso
preserva o desenho append-only, um receipt por grant, que o ADR-039 já
fixou para este domínio: nenhuma linha de `portal_business_action_receipts`
é reescrita por esta revisão, só um valor novo de `outcome` passa a existir.
`succeeded` continua um valor válido do domínio fechado (`confirm_meeting_slot`,
por exemplo, continua usando), só deixa de ser alcançável por
`request_checkout` nesta versão do produto; isso é uma consequência real e
documentada da decisão de Fernando, não um efeito colateral escondido.

**Rejeição.** Se o `tenant_admin` rejeita, nada é enviado ao prospect, a
Stripe nunca é chamada, e a reserva vai para `rejected` (estado terminal),
com `rejected_by`/`rejected_at`/`rejection_reason` gravados para o
histórico do próprio tenant (a mesma tela de "vendas fechadas pelo closer"
já prevista fora do escopo deste ADR mostra isso). Esta versão do ADR não
desenha uma notificação automática de volta ao "closer", porque o closer,
neste produto, é o próprio agente de vídeo, não um funcionário do tenant
com caixa de entrada própria: quem rejeita já sabe que rejeitou, e não
existe hoje um segundo humano no fluxo que precise ser avisado. Uma
notificação por e-mail para outro `tenant_admin` do mesmo tenant (por
exemplo, quando quem originou a call e quem aprova são pessoas diferentes)
é um gate de pré-lançamento razoável, listado abaixo, não uma peça
obrigatória da arquitetura.

### Idempotência e fence no padrão do ADR-036, com uma vantagem real do Idempotency-Key da Stripe

Criar uma Checkout Session é uma chamada de rede que pode falhar de forma
ambígua (timeout depois de a Stripe já ter criado a sessão do lado dela).
Isso é a mesma classe de risco que qualquer efeito pago já desenhado neste
repositório, e recebe a mesma disciplina reserved → provider_in_flight →
committed/unknown → completed, agora precedida por `pending_approval` (seção
anterior). A tabela nova, `portal_business_action_checkout_reservations`,
não tenta reaproveitar `provider_effect_reservations` (as colunas de
billing e cap bucket daquela tabela são específicas de Tavus, Recall e
OpenRouter; forçar cobrança para dentro dela repetiria a modelagem por
overload que o Art. 17 já proíbe, o mesmo racional que o ADR-039 já aplicou
para não reaproveitar aquela tabela com a reserva de calendário) nem
`portal_business_action_calendar_reservations`
(o ciclo de vida e as colunas de evidência são de domínios diferentes,
Google Calendar de um lado, Stripe do outro).

A vantagem real aqui, ainda mais forte do que a do Google Calendar, é que a
própria API da Stripe já resolve a ambiguidade de "foi dispachado ou não":
toda criação de Checkout Session neste código já usa uma chave de
idempotência (o padrão já em produção em `checkout-intents.ts` e em
`packages/provider-stripe`), e a Stripe garante que repetir exatamente a
mesma chamada com a mesma chave dentro de uma janela de tempo devolve o
resultado original em vez de criar uma segunda sessão. Isso significa que a
reconciliação de uma linha `unknown` não depende de um lookup separado
(como o `Events.get` que o ADR-039 precisou desenhar para o Google
Calendar): ela é, primeiro, uma repetição automática e limitada da mesma
chamada de criação, com a mesma chave de idempotência e o mesmo corpo
persistidos na reserva. Só se essa repetição automática também falhar ou
ficar inconclusiva (ex.: a própria Stripe está indisponível) a reconciliação
cai para o mesmo caminho manual de dois operadores que o ADR-038 já
formalizou para o M5-02. Diferente de um efeito Tavus ou Recall, uma
Checkout Session nunca criada não tem custo nem recurso ativo para conter:
ela simplesmente nunca existiu ou vai expirar sozinha do lado da Stripe
(prazo padrão configurável, este produto usa um prazo curto, poucas horas,
suficiente para cobrir uma janela curta depois da aprovação); não existe,
portanto, um estado `cleanup_pending` nem uma lease de terminação neste
domínio, porque não há nada para terminar. Isso é uma simplificação real em
relação ao Tavus e ao Recall, não uma lacuna: o Art. 17 pede para não
construir uma máquina de estados maior do que o problema exige.

Os estados da reserva, depois desta revisão, são: `pending_approval`
(estado inicial, criado pela admissão do `BusinessActionIntent`, sem
nenhuma chamada à Stripe; ver "Aprovação humana do tenant" acima), `reserved`
(só alcançável por aprovação explícita de um `tenant_admin`, nunca
diretamente da admissão), `provider_in_flight`, `committed` (a Checkout
Session existe, com `stripe_checkout_session_id` e `checkout_url`
gravados; é neste ponto que a aplicação dispara o e-mail com o link, não
mais o Presenter anunciando nada ao vivo, porque o Presenter normalmente já
não está mais na call quando isso acontece), `unknown`, `expired` ou
`released` (só por falha comprovada pré-dispatch depois da aprovação, por
exemplo produto desativado no catálogo ou conta Stripe desconectada entre a
aprovação e o dispatch, nunca depois do dispatch), dois estados terminais
pré-Stripe que nunca envolvem nenhuma chamada à Stripe, `rejected`
(rejeição explícita de um `tenant_admin`) e `approval_expired` (prazo de 72
horas em `pending_approval` esgotado sem ação), e dois estados terminais que
só um webhook assinado pode escrever: `payment_completed` e
`payment_failed`. A distinção entre `committed` (o link existe) e
`payment_completed` (o prospect de fato pagou) continua sendo o coração
deste desenho, só que agora nenhuma das duas transições acontece dentro de
uma call ao vivo nem é anunciada por um Presenter: como "Aprovação humana do
tenant" já detalha, o receipt do `BusinessActionIntent` grava
`pending_approval` uma única vez, na admissão, e não é reescrito quando a
reserva chega a `committed` ou a `payment_completed`. A doutrina de conduta
do closer (texto a escrever em `metodo-silva.ts`, fora do escopo deste ADR)
só precisa cobrir o momento da própria call, o handoff ("vou preparar o
link de pagamento com o time e te envio em seguida"), porque não existe mais
um momento, dentro da call, em que o modelo saiba que o link foi gerado ou
que o pagamento foi confirmado, para anunciar certo ou errado.

### Split de plataforma: suportado estruturalmente, percentual é decisão de negócio

Cobrança direta com conta Standard aceita nativamente
`payment_intent_data[application_fee_amount]` na criação da Checkout
Session: um valor fixo em centavos, calculado pelo servidor
(`unit_amount_cents × quantity × platform_fee_bps ÷ 10000`, nunca informado
ou influenciado pelo modelo), que a Stripe desconta automaticamente da
cobrança e credita na própria conta Stripe da Axtro, líquido da tarifa de
processamento da Stripe (que, em cobrança direta, é paga pela conta
conectada, isto é, pelo tenant). A resposta para "faz sentido a Axtro cobrar
uma comissão sobre vendas fechadas pelo closer" é uma decisão comercial de
Fernando, não uma decisão técnica: este ADR só garante que a arquitetura
suporta a taxa sem exigir nenhuma mudança de tipo de conta ou de padrão de
cobrança se e quando esse percentual for definido. O desenho trata
`platform_fee_bps` como um campo por tenant (ou por plano), nulo/zero por
padrão, calculado e snapshotado no momento da reserva, nunca recalculado
depois.

### Webhook de eventos conectados: endpoint novo, segredo novo, resolução de tenant por metadata

Eventos de conta conectada (`checkout.session.completed`,
`checkout.session.expired`, `checkout.session.async_payment_failed`,
`account.updated`) chegam por um endpoint novo,
`apps/portal/src/app/api/stripe/connect-webhook/route.ts`, com um segredo
de assinatura próprio, `STRIPE_CONNECT_WEBHOOK_SECRET`, distinto de
`STRIPE_WEBHOOK_SECRET` (o webhook de assinatura do tenant já existente).
Isso não é redundância: a Stripe exige uma configuração de endpoint
separada, com "escutar eventos em contas conectadas" habilitado, para
receber esse tipo de evento, e misturar os dois fluxos no mesmo handler
misturaria dois domínios de dinheiro diferentes (Axtro cobrando tenant,
tenant cobrando prospect) atrás da mesma verificação de assinatura. O
handler segue exatamente o padrão já em produção em
`apps/portal/src/app/api/stripe/webhook/route.ts`: corpo cru lido antes do
parse, assinatura HMAC obrigatória, tipo de evento fora do escopo tratado
responde 200 sem ação (Art. 14), e tipo de evento dentro do escopo com
payload malformado responde erro em vez de silêncio. O tenant nunca é lido
de um header; é resolvido pela `metadata.tenant_id` que o próprio servidor
gravou ao criar a Checkout Session, cruzado contra o `stripe_account_id`
armazenado para aquele tenant (o campo `account` que a Stripe inclui em todo
evento de conta conectada precisa bater com o que este produto tem
registrado, ou o evento é rejeitado). A tabela nova
`portal_business_action_checkout_stripe_event_receipts` reclama cada
`event_id` uma única vez antes de aplicar qualquer efeito, o mesmo padrão
de `billing_stripe_event_receipts`, prevenindo reprocessamento de retry da
Stripe. Este webhook só é alcançado depois de `committed`, o que esta
revisão não muda: só o instante em que `committed` acontece, dentro da
linha do tempo, se deslocou para depois da aprovação humana.

### Receipt e auditoria

`portal_business_action_receipts` (a tabela do ADR-039) ganha
`request_checkout` como um valor válido de `action_kind`, com uma
referência à reserva de cobrança no mesmo lugar onde hoje guarda `leadId`
ou `reservationId` de calendário. A evidência financeira de verdade, porém,
vive na própria `portal_business_action_checkout_reservations`: valor,
moeda, quantidade, `stripe_checkout_session_id`, e, quando aplicável,
`stripe_payment_intent_id`, `stripe_charge_id`, `amount_total_cents` e
`application_fee_amount_cents` (estes últimos quatro só preenchidos pelo
webhook assinado, nunca pelo redirect de sucesso do navegador, o mesmo
princípio que `billing.ts` já aplica ao próprio checkout de assinatura da
Axtro). Isso dá ao tenant um histórico append-only de toda cobrança
oferecida pelo closer, paga ou não, correlacionável ao lead e à sessão de
call de origem. Uma tela de "vendas fechadas pelo closer" para o tenant ver
esse histórico é trabalho de produto fora do escopo deste ADR.

Esta revisão soma a essa evidência quem aprovou ou rejeitou e quando
(`approved_by`/`approved_at`/`rejected_by`/`rejected_at`/`rejection_reason`),
pelo mesmo motivo que já vale para o resto da tabela: a reserva, não o
receipt, é quem carrega a história completa do que aconteceu com aquela
oferta de cobrança. O `outcome` do receipt em `portal_business_action_receipts`
fica travado em `pending_approval` assim que a reserva é criada, como
"Aprovação humana do tenant" já explica; a futura tela de "vendas fechadas
pelo closer" lê o estado da reserva, nunca o `outcome` do receipt, para
mostrar o desfecho real ao tenant.

### Fronteira navegador → servidor

`request_checkout` entra pelo mesmo handler de `conversation.tool_call` e
pela mesma Server Action `executeBusinessActionIntent` que o ADR-039 já
desenhou para as outras três tools: o navegador nunca decide política, só
aguarda o resultado e devolve ao Tavus uma frase curta em linguagem
natural, nunca o receipt bruto, nunca um identificador de reserva ou de
sessão Stripe. Uma chamada real à Stripe (criação de Checkout Session) não
é instantânea; o mesmo problema de UX que o ADR-039 já registrou para a
chamada ao Google Calendar se repete aqui e recebe o mesmo tratamento (texto
de preenchimento no prompt, edição futura de `metodo-silva.ts`, fora deste
ADR). Depois desta revisão, esse problema de UX passa a valer só para o
instante da admissão em si (responder rápido com o handoff), nunca para a
criação da Checkout Session, que já não acontece mais dentro desta
fronteira navegador → servidor de jeito nenhum.

## Migração 0052: tabelas e RPCs (nível de design, sem SQL completo)

A última migration física em `database/supabase-only/` era
`0048_tavus_stage_settlement_timestamp.sql` quando este ADR foi escrito
(confirmado rodando `ls database/supabase-only/ | sort | tail -5`). O
ADR-039, aceito um dia antes deste, reservava logicamente o número `0049`
para o domínio de calendário e lead. Antes de qualquer uma das duas migrations
mergear, porém, uma sessão concorrente aplicou em produção suas próprias
`0049_portal_text_preview_admission.sql` e `0050_meeting_terminal_notification_claim.sql`
(feature não relacionada), forçando a onda 1a do ADR-039 a renumerar para
`0051` (D-V2-145 em `docs/operations/DECISIONS_LOG.md`). Este ADR não
reutiliza nenhum dos números já tomados: a próxima migration livre para o
domínio de cobrança é `0052`, e pressupõe `0051` já aplicada antes dela
(nenhuma tabela deste domínio lê dado de `0051`, mas a sequência expand-only
e o probe de capacidades, que sobe de v51 para v52, exigem essa ordem).

Tabelas novas, todas com `tenant_id app.uuid_v7 not null`, RLS forçada, sem
policy para `authenticated`/`anon`/`service_role` direto (só RPC
`SECURITY DEFINER`), no mesmo padrão de toda tabela do ADR-038/ADR-039:

- `portal_business_action_checkout_connections` (uma linha por tenant:
  `stripe_account_id`, `status` em `connected`/`restricted`/`disconnected`,
  `charges_enabled`, `payouts_enabled`, `details_submitted`, autor e
  timestamps de conexão/desconexão/última sincronização de capacidade;
  `unique(tenant_id)`)
- `portal_business_action_checkout_products` (o catálogo aprovado: `product_id`
  interno único por tenant, `display_name`, `stripe_price_id` da conta
  conectada, `unit_amount_cents` e `currency` cacheados, `max_quantity`,
  `active`, autor e timestamp da última alteração)
- `portal_business_action_checkout_reservations` (a reserva durável no
  padrão ADR-036: `grant_id` referenciando o grant do `BusinessActionIntent`,
  `product_id`, `quantity`, `unit_amount_cents`/`currency` snapshotados no
  momento da reserva, `stripe_account_id` snapshotado, `platform_fee_bps` e
  `application_fee_amount_cents` snapshotados, `contact_email` opcional,
  `lead_id` opcional e nullable só para correlação, `stripe_idempotency_key`
  único por tenant, `state` em `pending_approval`/`reserved`/
  `provider_in_flight`/`committed`/`unknown`/`expired`/`released`/
  `rejected`/`approval_expired`/`payment_completed`/`payment_failed`,
  `approval_expires_at` (gravado na criação, usado só pela varredura
  periódica de expiração), `approved_by`/`approved_at`, `rejected_by`/
  `rejected_at`/`rejection_reason`, `stripe_checkout_session_id`,
  `checkout_url`, `stripe_payment_intent_id`, `stripe_charge_id`,
  `amount_total_cents`, colunas de reconciliação espelhando
  `provider_effect_reservations`)
- `portal_business_action_checkout_stripe_event_receipts` (dedup de eventos
  do webhook de conta conectada: `event_id` chave primária, `event_type`,
  `tenant_id`, `reservation_id`, `connected_account_id`,
  `payload_fingerprint`, `receipt_state`, `receipt_applied`, mesmo padrão de
  `billing_stripe_event_receipts`)

RPCs novas, todas `service_role`-only, revogadas de `public`/`anon`/
`authenticated`:

- `portal_complete_stripe_connect_service` (troca o `code` do OAuth por
  `stripe_user_id`, exige `tenant_admin`, grava a conexão, nunca persiste o
  `access_token`)
- `portal_disconnect_stripe_service` (`tenant_admin`, chama a desautorização
  da própria Stripe, marca `disconnected`)
- `portal_sync_stripe_connect_capabilities_service` (aplica `account.updated`,
  atualiza `charges_enabled`/`payouts_enabled`/`details_submitted`, rebaixa
  para `restricted` quando necessário)
- `portal_stripe_connect_status_service` (leitura, para a tela de
  Configurações e para a checagem de admissão)
- `portal_upsert_business_checkout_product_service` /
  `portal_deactivate_business_checkout_product_service` (`tenant_admin`
  gerencia o catálogo, com verificação do preço vivo na Stripe no momento do
  cadastro)
- `portal_reserve_business_checkout_service` (valida grant, sessão e
  catálogo, roda o preflight de preço vivo contra a conta Stripe conectada,
  snapshota preço/moeda/quantidade/conta Stripe/contato, cria a linha em
  `pending_approval` com `approval_expires_at`, grava o único receipt deste
  grant com `outcome='pending_approval'`)
- `portal_approve_business_checkout_service` (`tenant_admin`, fence
  `pending_approval` → `reserved`, aceita `contactEmail` opcional/
  obrigatório só quando a reserva não capturou nenhum durante a call, grava
  `approved_by`/`approved_at`, nunca chama a Stripe)
- `portal_reject_business_checkout_service` (`tenant_admin`, fence
  `pending_approval` → `rejected`, aceita `rejectionReason` opcional, grava
  `rejected_by`/`rejected_at`, nunca chama a Stripe)
- `portal_expire_pending_business_checkout_reservations_service`
  (`service_role`, chamada pelo mesmo worker de varredura periódica do
  ADR-036/039, transiciona toda linha `pending_approval` com
  `approval_expires_at` no passado para `approval_expired`)
- `portal_dispatch_business_checkout_reservation_service` (fence `reserved`
  → `provider_in_flight`, chamado imediatamente antes da chamada à Stripe,
  só alcançável depois de `portal_approve_business_checkout_service`)
- `portal_commit_business_checkout_reservation_service` (`provider_in_flight`
  → `committed`, grava `stripe_checkout_session_id`/`checkout_url`; não
  grava receipt novo, o receipt deste grant já foi gravado como
  `pending_approval` na reserva e não é reescrito; a aplicação, no mesmo
  fluxo do clique de aprovação, dispara em seguida o e-mail do link para
  `contact_email`)
- `portal_release_business_checkout_reservation_service` (libera só falha
  comprovada pré-dispatch depois da aprovação, nunca antes dela: os
  desfechos pré-aprovação são `rejected` ou `approval_expired`, nunca
  `released`)
- `portal_mark_business_checkout_reservation_unknown_service`
- `portal_reconcile_business_checkout_reservation_service` (repete a mesma
  chamada de criação com a mesma chave de idempotência; se inconclusivo,
  exige o mesmo dual-approval de dois operadores que o ADR-038 já
  formalizou)
- `portal_apply_business_checkout_connect_event_service` (o writer do
  webhook: reclama `event_id` uma única vez, transiciona a reserva para
  `payment_completed`/`payment_failed`/`expired`)

`portal_schema_capabilities_service()` ganha chaves novas
(`businessActionCheckoutConnections`, `businessActionCheckoutProducts`,
`businessActionCheckoutReservations`,
`businessActionCheckoutStripeEventReceipts`), sem remover nenhuma chave
atual; a versão do probe sobe para 50. O domínio fechado de `action_kind`
em `portal_business_action_grants`, `portal_business_action_receipts` e
`portal_business_action_kill_switches`/`..._kill_switch_events` (tabelas do
ADR-039) é ampliado para incluir `request_checkout`, de forma aditiva, sem
remover os três valores existentes. O domínio fechado de `outcome` em
`portal_business_action_receipts` (tabela do ADR-039) ganha um quinto
valor, `pending_approval`, também de forma aditiva, sem remover os quatro
já existentes (`succeeded`/`rejected`/`failed`/`unknown`); ver "Aprovação
humana do tenant" acima para o porquê. Nenhuma tabela ou RPC anterior é
estreitada por esta migration.

`packages/provider-stripe` ganha um método novo (fora do escopo de código
deste ADR, mas o contrato já fica fixado aqui):
`createConnectedAccountCheckoutSession`, que envia o cabeçalho
`Stripe-Account` com o `stripe_account_id` do tenant, `mode: "payment"`, um
único line item referenciando o `stripe_price_id` da conta conectada,
`payment_intent_data.application_fee_amount` opcional e a mesma chave de
idempotência gravada na reserva, seguindo a mesma disciplina de validação
fechada (IDs por regex, URLs https, leitura de resposta limitada) já
aplicada a `createCheckoutSession` e `createProspectCheckoutSession` no
mesmo arquivo.

## Alternativas consideradas

1. Construir um segundo bridge (`PaymentActionIntent`,
   `PORTAL_PAYMENT_ACTION_BRIDGE_ENABLED`) independente do
   `BusinessActionIntent` do ADR-039. Rejeitado: duplicaria toda a lógica de
   admissão (disclosure, consentimento, presenter, geração, kill switch)
   sem ganho de segurança, já que o risco adicional de cobrança está na
   execução, não na admissão; o risco é tratado com camadas extras
   (`PORTAL_BUSINESS_ACTION_CHECKOUT_ENABLED`, `checkout_enabled`), não com
   um segundo funil.
2. Reaproveitar `provider_effect_reservations` ou
   `portal_business_action_calendar_reservations` para a reserva de
   cobrança. Rejeitado pelo mesmo racional que o ADR-039 já aplicou à
   reserva de calendário: colunas e ciclo de vida específicos de outro
   domínio, forçar cobrança para dentro deles seria modelagem por overload
   (Art. 17).
3. Cartão embutido na interface do Portal via Stripe Elements, em vez de
   redirecionar para o Checkout hospedado da Stripe. Rejeitado: aumenta o
   escopo PCI do Portal sem melhorar o fluxo do closer (link funciona bem
   dentro de uma call de vídeo), e o pedido explícito de Fernando já é que o
   modelo nunca digite ou manipule dado de cartão.
4. Conta Stripe Connect Express ou Custom em vez de Standard. Rejeitado
   para V1: as duas transferem mais responsabilidade operacional e de
   compliance sobre o dinheiro do cliente final para a Axtro do que o
   problema atual justifica; revisitar Express se a fricção de onboarding
   de conta Standard provar ser um bloqueio real para tenants piloto.
5. Deixar o modelo informar preço, produto ou desconto por texto livre.
   Rejeitado pelos Art. 3, 7 e 15, e pelo pedido explícito de Fernando:
   catálogo fechado, aprovado pelo tenant antes da call, é não negociável.
6. Persistir o `access_token` OAuth que a Stripe devolve na troca de código,
   com custódia via Supabase Vault, espelhando o Google Calendar do
   ADR-039. Rejeitado para V1: cobrança direta só precisa do
   `stripe_account_id` (não secreto) mais a chave de plataforma com o
   cabeçalho `Stripe-Account`; persistir um token adicional sem uso seria
   superfície de ataque sem benefício. Revisitar se uma capacidade futura
   exigir agir com o token da própria conta conectada em vez do da
   plataforma.
7. Manter `request_checkout` tão autônomo quanto `confirm_meeting_slot`, sem
   aprovação humana, protegido só pelas quatro camadas de
   flag/kill switch/catálogo/conta Stripe já descritas (a recomendação
   original deste ADR). Rejeitado por decisão explícita de Fernando Silva
   (2026-08-28): cobrança é dinheiro saindo do bolso de um terceiro real,
   uma categoria de risco que pesa mais do que a fricção comercial de uma
   aprovação assíncrona; ver "Fluxo de confirmação" e "Aprovação humana do
   tenant" acima.

## Consequências

O Portal processa, pela primeira vez, dinheiro que não é nem da Axtro nem
do tenant assinante: é do prospect, indo para o tenant. Isso exige habilitar
Connect na própria conta Stripe da Axtro e aceitar os termos de plataforma
correspondentes, uma dependência externa fora do controle deste
repositório. `packages/provider-stripe` ganha um segundo tipo de cobrança
(cobrança direta em conta conectada, ao lado da assinatura da própria
Axtro), e um segundo endpoint de webhook assinado, com segredo próprio,
soma-se ao já existente. A operação ganha um quarto `action_kind` de kill
switch, uma segunda camada de flag específica de pagamento, e um
interruptor por agente novo. Diferente do Google Calendar do ADR-039, este
domínio não adiciona custódia de segredo por tenant ao Supabase Vault,
porque cobrança direta não exige isso; o Portal continua com exatamente um
segredo por tenant no total (o do Google Calendar), mais um identificador
não secreto por tenant (a conta Stripe conectada). A doutrina de conduta do
closer em `metodo-silva.ts` precisa de texto novo, escrito fora deste ADR,
para nunca confundir "link enviado" com "pagamento recebido". Nenhuma
tabela ou RPC existente é estreitada; nenhuma promessa de cobrança é feita
ao modelo antes de um receipt confirmado, e nenhuma promessa de pagamento
recebido é feita antes de um webhook assinado da Stripe confirmar.

Esta revisão soma mais duas consequências estruturais. Primeiro, este
domínio passa a depender de e-mail transacional (Resend, via
`apps/portal/src/lib/email.ts`) para completar seu próprio fluxo, algo que a
versão autônoma original não precisava: sem uma função de envio nova
(`sendCheckoutLinkEmail` ou nome equivalente, fora do escopo de código
deste ADR) e sem um `contactEmail` válido no momento da aprovação, um link
gerado não chega a lugar nenhum sozinho. Segundo, `request_checkout` se
torna a primeira ação de negócio deste produto cujo receipt nunca atinge
`succeeded`: o `outcome` fica permanentemente em `pending_approval` a partir
da admissão, e o desfecho real (link entregue, rejeitado ou expirado sem
ação) vive só na reserva, nunca no receipt. Isso é uma divergência
deliberada e documentada do padrão que `confirm_meeting_slot` estabeleceu no
ADR-039, não um descuido: lá, a aprovação é a própria fala do prospect
dentro da call; aqui, a aprovação é um humano do tenant agindo depois,
quase sempre fora dela.

## Rollout e rollback

Esta migration mexe em banco (tabelas novas, RLS, RPCs `service_role`) e
introduz uma segunda credencial de terceiro por tenant (conta Stripe
conectada), duas das quatro categorias de risco ALTO de Fernando ao mesmo
tempo (banco e pagamento, com auth também presente no fluxo OAuth); a
aplicação em produção exige gate humano antes e depois, como qualquer
mudança dessa classe. O deploy segue o mesmo padrão expand-only já usado
desde o ADR-036: aplicar `0052` (depois de `0051`) antes de subir o
artefato de aplicação que a usa; nenhuma tabela ou RPC anterior é removida
ou estreitada, então o rollback de aplicação para antes de `0052` continua
seguro. `PORTAL_BUSINESS_ACTION_CHECKOUT_ENABLED` começa `false` em todo
ambiente, inclusive produção, e assim permanece até a revisão de segurança
e compliance do fluxo Stripe Connect ser concluída e um tenant canário ser
aprovado; `checkout_enabled` começa `false` por agente, o mesmo padrão dark
de toda capacidade nova. Nenhum tenant deve conectar uma conta Stripe real
antes dessa revisão. Rollback de qualquer uma das duas flags é imediato
(voltar para `false` bloqueia toda admissão nova de `request_checkout` sem
afetar nenhuma reserva ou pagamento já registrado); rollback de uma reserva
de cobrança individual que já passou de `reserved` em diante nunca é
automático, segue a mesma regra do ADR-036, só uma repetição idempotente
que prova o resultado ou uma reconciliação manual de dois operadores libera
ou resolve a reserva. Desconectar a conta Stripe de um tenant não invalida
uma Checkout Session já `committed`, ela continua existindo do lado da
Stripe até expirar ou ser completada.

Uma reserva ainda em `pending_approval` é mais simples de desfazer do que
qualquer uma dessas: como nenhuma chamada à Stripe jamais aconteceu nesse
estado, "cancelar" uma oferta de cobrança pendente é só deixá-la expirar
sozinha (`approval_expired`, 72 horas) ou o `tenant_admin` rejeitar
explicitamente; nenhuma das duas ações precisa de reconciliação com a
Stripe, porque não existe nada do lado da Stripe para reconciliar.

## Decisões do dono do produto

**Já decidido pelo arquiteto, com justificativa (não bloqueia o desenho,
mas toda aplicação real em produção continua exigindo gate humano por ser
categoria ALTO):**
- Mecanismo: Stripe Connect Standard com cobrança direta (Direct charges),
  não Express nem Custom.
- Custódia: nenhum segredo por tenant novo no Supabase Vault; só o
  `stripe_account_id`, não secreto. O `state` de CSRF do OAuth vive em
  cookie assinado de curta duração, não em tabela.
- Catálogo: sempre fechado e configurado pelo `tenant_admin` antes da call,
  com preflight contra o preço vivo na Stripe; o modelo nunca informa
  preço, produto ou desconto por texto livre.
- Reuso do `BusinessActionIntent`/`PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED`
  do ADR-039 como quarta ação, somado a um flag específico de pagamento
  (`PORTAL_BUSINESS_ACTION_CHECKOUT_ENABLED`) e a um interruptor por agente
  (`checkout_enabled`).
- Idempotência e fence no padrão do ADR-036, com reconciliação automática
  via repetição da chamada idempotente da Stripe antes de cair para
  dual-approval manual.
- Suporte estrutural a taxa de plataforma (`application_fee_amount`), com o
  percentual em si tratado como decisão de negócio pendente, não técnica.
- Migração `0052` (número confirmado livre depois da renumeração da onda 1a do
  ADR-039 — D-V2-145 em `docs/operations/DECISIONS_LOG.md`).
- Escopo V1: cobrança única (`mode: "payment"`), sem assinatura recorrente
  para o cliente final, sem ferramenta de reembolso dentro do Portal (o
  tenant usa o próprio dashboard Stripe para isso), sem desconto, sem
  carrinho multi-produto, moeda única (USD).
- **Aprovação humana obrigatória do tenant para `request_checkout`**:
  decidido por Fernando Silva (2026-08-28), na direção oposta à
  recomendação original deste ADR. Um `tenant_admin` precisa aprovar cada
  oferta de cobrança antes de o link ser gerado; o modelo nunca oferece o
  link ao vivo, só um handoff. A máquina de estados ganhou um estado
  inicial novo (`pending_approval`, anterior a `reserved`) e dois estados
  terminais novos (`rejected` e `approval_expired`, prazo fixo de 72
  horas); o receipt do `BusinessActionIntent` ganhou um quinto `outcome`
  (`pending_approval`) e nunca mais alcança `succeeded` para esta ação; a
  entrega do link ao prospect passou a depender de e-mail (Resend), no
  mesmo padrão de `sendClosingProposal`. Ver "Fluxo de confirmação" e
  "Aprovação humana do tenant: máquina de estados, prazos e entrega" acima
  para o desenho completo.

**Bloqueia o início do código:** nenhum item restante. O único ponto que
bloqueava (autonomia da geração do link de cobrança) foi resolvido acima.

**Gates de pré-lançamento, não bloqueiam o início da implementação:**
- Habilitar Connect na própria conta Stripe da Axtro e aceitar os termos de
  plataforma Connect correspondentes, dependência externa antes de
  qualquer tenant conectar.
- Revisão de segurança e compliance dedicada do fluxo Stripe Connect
  (escopos OAuth, fluxo de onboarding Standard, ausência de custódia de
  token por tenant) antes de qualquer tenant conectar uma conta real,
  equivalente à revisão que o ADR-039 já exige para o Google Calendar.
- Percentual (se algum) de `application_fee_amount`, decisão comercial de
  Fernando.
- Confirmação final do tipo de conta (Standard) antes do primeiro tenant
  real conectar, por ser categoria ALTO (pagamento) mesmo já vindo com
  recomendação técnica forte deste ADR.
- Aplicação da migration `0052` em produção segue o mesmo gate humano de
  toda migration deste porte (autorização explícita antes e depois, nunca
  automática).
- A tela de aprovação do `tenant_admin` (listar reservas `pending_approval`,
  aprovar, rejeitar) é trabalho de produto fora do escopo de código deste
  ADR; o contrato de RPC já está fixado em "Aprovação humana do tenant"
  acima, mas nenhum tenant piloto usa `request_checkout` de verdade antes
  de essa tela existir.
- Notificação por e-mail de rejeição ou de expiração de uma reserva
  `pending_approval` para um segundo `tenant_admin` do mesmo tenant (quando
  quem originou a call e quem aprova são pessoas diferentes) não é
  desenhada nesta versão; revisitar se um tenant piloto pedir.

## Revisit trigger

Revisitar quando o cliente final de um tenant precisar de cobrança
recorrente (não só cobrança única), quando um segundo tipo ou uma segunda
conta conectada por tenant for necessário, quando multi-moeda for pedido
por um tenant fora dos EUA, quando o tenant pedir reembolso ou estorno
iniciado de dentro do Portal em vez do dashboard próprio da Stripe, quando
a fricção de onboarding de conta Standard justificar reavaliar Express,
quando o prazo fixo de 72 horas de `pending_approval` precisar ser
configurável por tenant, quando um tenant piloto pedir notificação
proativa de reserva pendente de aprovação ou prestes a expirar, ou quando
o Action Runtime genérico descrito em
`docs/architecture/ACTION_AND_TOOL_RUNTIME.md` ganhar um contrato de
produção capaz de substituir este bridge específico de domínio.
