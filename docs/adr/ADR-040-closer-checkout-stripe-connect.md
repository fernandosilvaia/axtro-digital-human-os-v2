# ADR-040: Checkout do cliente final do tenant via Stripe Connect (o closer fecha e cobra)

**Status:** Proposto. Um ponto de decisão bloqueia o início do código (autonomia da geração do link de cobrança sem operador humano) e outros pontos são gates de pré-lançamento, ambos listados em "Decisões do dono do produto" abaixo.
**Data:** 2026-08-25
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
tenant, reserva durável, webhook assinado) e no controle de rollout, que
recebe uma camada extra descrita abaixo, especificamente por causa dessa
classe de risco.

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
falha muda, no mesmo padrão de `auto_confirm_disabled` do ADR-039.

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
esse e-mail já validado; se nenhum dos dois existir, a própria tela de
Checkout hospedada da Stripe pede o e-mail ao prospect, então a ausência não
bloqueia a geração do link).

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
valor que não foi aprovado pelo próprio tenant antes da call.

V1 não suporta desconto, carrinho com múltiplos produtos na mesma reserva
nem assinatura recorrente para o cliente final (`mode: "payment"`, cobrança
única, sempre). Cada uma dessas é uma extensão real, não um requisito
implícito do pedido de Fernando, e entra como revisit trigger.

### Fluxo de confirmação: o ato de gerar o link não move dinheiro, o ato de completá-lo sim

Esta é a decisão de maior risco do documento inteiro, e é dividida em duas
partes com pesos diferentes.

A primeira parte não é ambígua e este ADR já a fixa: o cartão do prospect
nunca passa pelo modelo nem pelo backend do Portal. `request_checkout`
produz um link para uma Stripe Checkout Session hospedada
(`checkout.stripe.com`), nunca um formulário de cartão embutido na
interface do Portal (Stripe Elements) e nunca qualquer campo onde o modelo
"digite" um número de cartão. Checkout hospedado mantém o Portal fora do
escopo PCI mais pesado (elegível a SAQ A, o nível mais simples de
autoavaliação PCI), o prospect é quem abre a tela da própria Stripe e digita
os próprios dados, e é literalmente essa ação, o clique em "Pagar" na tela
da Stripe, que constitui a confirmação explícita do próprio prospect que a
tarefa original pede. Não existe um caminho alternativo mais seguro que
ainda cumpra "o closer fecha e cobra de verdade"; isto é recomendação firme,
não um ponto em aberto.

A segunda parte é genuinamente aberta e por isso volta para Fernando: gerar
o link em si, sem nenhum operador do tenant revisando antes, é diferente de
cobrar de fato, porque gerar o link não move um centavo, só o prospect
completando o Checkout move. Isso separa o risco em dois eventos distintos:
o evento de baixo risco (oferecer um link para um produto que o próprio
tenant já aprovou previamente no catálogo) e o evento de risco real
(o prospect decidir pagar). A recomendação deste ADR é que `request_checkout`
siga o mesmo padrão de autonomia que o ADR-039 já aplicou a
`confirm_meeting_slot`: o modelo decide, dentro da conversa, o momento de
oferecer o link, sem um humano do tenant aprovando cada oferta em tempo
real, protegido pelas quatro camadas já descritas (duas flags de ambiente,
kill switch, interruptor por agente) mais o catálogo fechado e a conta
Stripe conectada como pré-requisitos. O argumento a favor é que o momento de
risco real de fraude e chargeback não é "o closer ofereceu um link", é "o
prospect pagou", e esse segundo momento já é estruturalmente gated pela
própria Stripe, fora do controle ou julgamento do modelo. O argumento contra
é que cobrança, mesmo com essa separação, ainda é dinheiro saindo do bolso
de um terceiro real, uma categoria de risco que Fernando classifica acima
de agendar uma reunião, e um closer mal calibrado ofertando cobrança fora de
hora é um problema comercial e de reputação mesmo sem nenhuma fraude
envolvida. Este ADR não resolve essa tensão sozinho: apresenta a
recomendação, mas a decisão final (se `request_checkout` pode ser tão
autônomo quanto `confirm_meeting_slot`, ou se exige algum tipo de aprovação
humana do tenant antes de o link ser oferecido ao prospect) fica
explicitamente para Fernando confirmar antes do início do código, listada
em "Decisões do dono do produto".

### Idempotência e fence no padrão do ADR-036, com uma vantagem real do Idempotency-Key da Stripe

Criar uma Checkout Session é uma chamada de rede que pode falhar de forma
ambígua (timeout depois de a Stripe já ter criado a sessão do lado dela).
Isso é a mesma classe de risco que qualquer efeito pago já desenhado neste
repositório, e recebe a mesma disciplina reserved → provider_in_flight →
committed/unknown → completed. A tabela nova,
`portal_business_action_checkout_reservations`, não tenta reaproveitar
`provider_effect_reservations` (as colunas de billing e cap bucket daquela
tabela são específicas de Tavus, Recall e OpenRouter; forçar cobrança para
dentro dela repetiria a modelagem por overload que o Art. 17 já proíbe, o
mesmo racional que o ADR-039 já aplicou para não reaproveitar aquela tabela
com a reserva de calendário) nem `portal_business_action_calendar_reservations`
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
suficiente para cobrir o resto da call e uma janela curta depois dela); não
existe, portanto, um estado `cleanup_pending` nem uma lease de terminação
neste domínio, porque não há nada para terminar. Isso é uma simplificação
real em relação ao Tavus e ao Recall, não uma lacuna: o Art. 17 pede para
não construir uma máquina de estados maior do que o problema exige.

Os estados da reserva são: `reserved`, `provider_in_flight`, `committed`
(a Checkout Session existe, com `stripe_checkout_session_id` e
`checkout_url` gravados; é neste ponto que o receipt do
`BusinessActionIntent` marca `succeeded`, porque o trabalho do modelo,
oferecer o link, terminou aqui), `unknown`, `expired` ou `released` (só por
falha comprovada pré-dispatch, por exemplo produto desativado no catálogo
ou conta Stripe desconectada, nunca depois do dispatch), e dois estados
terminais que só um webhook assinado pode escrever: `payment_completed` e
`payment_failed`. A distinção entre `committed` (o link existe) e
`payment_completed` (o prospect de fato pagou) é o coração deste desenho:
"sucesso" para o funil de ações de negócio (Art. 7, "o Presenter só anuncia
conclusão após receipt de sucesso") significa só que o link foi gerado, e a
doutrina de conduta do closer (texto a escrever em `metodo-silva.ts`, fora
do escopo deste ADR) precisa deixar isso explícito: o modelo nunca afirma
que recebeu ou confirmou um pagamento, porque essa informação chega de
forma assíncrona, muitas vezes depois de a call já ter terminado, e nunca
pelo julgamento do modelo. A frase certa é "te mandei o link de pagamento,
é só confirmar aí", nunca "recebi seu pagamento".

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
Stripe.

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
ADR).

## Migração 0050: tabelas e RPCs (nível de design, sem SQL completo)

A última migration física em `database/supabase-only/` é
`0048_tavus_stage_settlement_timestamp.sql` (confirmado rodando
`ls database/supabase-only/ | sort | tail -5`). O ADR-039, aceito um dia
antes deste, já reserva logicamente o número `0049` para o domínio de
calendário e lead, ainda não materializado em disco. Este ADR não reutiliza
esse número: a próxima migration livre para o domínio de cobrança é `0050`,
e pressupõe `0049` já aplicada antes dela (nenhuma tabela deste domínio lê
dado de `0049`, mas a sequência expand-only e o probe de capacidades, que
sobe de v49 para v50, exigem essa ordem).

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
  único por tenant, `state` em `reserved`/`provider_in_flight`/`committed`/
  `unknown`/`expired`/`released`/`payment_completed`/`payment_failed`,
  `stripe_checkout_session_id`, `checkout_url`, `stripe_payment_intent_id`,
  `stripe_charge_id`, `amount_total_cents`, colunas de reconciliação
  espelhando `provider_effect_reservations`)
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
  catálogo, snapshota preço/moeda/conta Stripe, cria a linha `reserved`)
- `portal_dispatch_business_checkout_reservation_service` (fence `reserved`
  → `provider_in_flight`, chamado imediatamente antes da chamada à Stripe)
- `portal_commit_business_checkout_reservation_service` (`provider_in_flight`
  → `committed`, grava `stripe_checkout_session_id`/`checkout_url`, grava
  receipt `succeeded`)
- `portal_release_business_checkout_reservation_service` (libera só falha
  comprovada pré-dispatch)
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
remover os três valores existentes. Nenhuma tabela ou RPC anterior é
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

## Rollout e rollback

Esta migration mexe em banco (tabelas novas, RLS, RPCs `service_role`) e
introduz uma segunda credencial de terceiro por tenant (conta Stripe
conectada), duas das quatro categorias de risco ALTO de Fernando ao mesmo
tempo (banco e pagamento, com auth também presente no fluxo OAuth); a
aplicação em produção exige gate humano antes e depois, como qualquer
mudança dessa classe. O deploy segue o mesmo padrão expand-only já usado
desde o ADR-036: aplicar `0050` (depois de `0049`) antes de subir o
artefato de aplicação que a usa; nenhuma tabela ou RPC anterior é removida
ou estreitada, então o rollback de aplicação para antes de `0050` continua
seguro. `PORTAL_BUSINESS_ACTION_CHECKOUT_ENABLED` começa `false` em todo
ambiente, inclusive produção, e assim permanece até a revisão de segurança
e compliance do fluxo Stripe Connect ser concluída e um tenant canário ser
aprovado; `checkout_enabled` começa `false` por agente, o mesmo padrão dark
de toda capacidade nova. Nenhum tenant deve conectar uma conta Stripe real
antes dessa revisão. Rollback de qualquer uma das duas flags é imediato
(voltar para `false` bloqueia toda admissão nova de `request_checkout` sem
afetar nenhuma reserva ou pagamento já registrado); rollback de uma reserva
de cobrança individual nunca é automático, segue a mesma regra do ADR-036,
só uma repetição idempotente que prova o resultado ou uma reconciliação
manual de dois operadores libera ou resolve a reserva. Desconectar a conta
Stripe de um tenant não invalida uma Checkout Session já `committed`, ela
continua existindo do lado da Stripe até expirar ou ser completada.

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
- Migração `0050` (número confirmado livre, considerando a reserva lógica
  do `0049` pelo ADR-039).
- Escopo V1: cobrança única (`mode: "payment"`), sem assinatura recorrente
  para o cliente final, sem ferramenta de reembolso dentro do Portal (o
  tenant usa o próprio dashboard Stripe para isso), sem desconto, sem
  carrinho multi-produto, moeda única (USD).

**Bloqueia o início do código, decisão explícita necessária:**
- **Autonomia da geração do link de cobrança**: se `request_checkout` pode
  ser tão autônomo quanto `confirm_meeting_slot` (o modelo oferece o link
  durante a conversa, sem um operador do tenant aprovando cada oferta em
  tempo real, protegido pelas quatro camadas de controle já descritas), ou
  se Fernando quer algum tipo de aprovação humana do tenant antes de o link
  ser oferecido ao prospect. A recomendação deste ADR é autonomia protegida
  por camadas (ver seção "Fluxo de confirmação"), mas, diferente do
  agendamento do ADR-039, esta decisão específica não foi tomada por
  Fernando ainda e precisa ser antes de qualquer código deste domínio,
  porque é dinheiro saindo do bolso de um terceiro real.

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
- Aplicação da migration `0050` em produção segue o mesmo gate humano de
  toda migration deste porte (autorização explícita antes e depois, nunca
  automática).
- Confirmar se `contactEmail` deve ser obrigatório antes de gerar o link
  ou se a própria tela da Stripe pode coletá-lo (assumido como não
  obrigatório neste ADR, para reduzir fricção); revisitar se algum tenant
  piloto pedir o contrário.

## Revisit trigger

Revisitar quando o cliente final de um tenant precisar de cobrança
recorrente (não só cobrança única), quando um segundo tipo ou uma segunda
conta conectada por tenant for necessário, quando multi-moeda for pedido
por um tenant fora dos EUA, quando o tenant pedir reembolso ou estorno
iniciado de dentro do Portal em vez do dashboard próprio da Stripe, quando
a fricção de onboarding de conta Standard justificar reavaliar Express, ou
quando o Action Runtime genérico descrito em
`docs/architecture/ACTION_AND_TOOL_RUNTIME.md` ganhar um contrato de
produção capaz de substituir este bridge específico de domínio.
