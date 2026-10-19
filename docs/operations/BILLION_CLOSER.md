# Closer da Billion Leads Pro: arquitetura, provisionamento e pendências

Estado: **construído e medido offline e ao vivo na camada de conversa; nada provisionado, nada ingerido, nada em produção.** Escrito em 2026-10-17. O CRM não foi alterado.

## O que é

Um closer de IA que conversa com o agente que acabou de se cadastrar na Billion Leads Pro, tira dúvidas sobre os pacotes de leads Hot e os planos do CRM, e conduz para o próximo passo: escolher o pacote no catálogo, ativar o Lead Desk, pedir a demonstração ou agendar a consultoria estratégica. Ele não cobra, não pede cartão, não cria desconto e não promete resultado.

## Como foi montado

| Peça | Onde | O que faz |
|---|---|---|
| Base de conhecimento (19 documentos) | `knowledge/billion-leads-pro/` | 01 a 13: ofertas, preços, reposição, planos, consumo, primeiros passos, integrações, consentimento, indicação, economia, objeções, fechamento e glossário. 14 a 19: descoberta por perfil do agente, carisma e comportamento humano, técnicas avançadas de venda honesta, fechamentos e recuperação, objeções de segundo nível, e as primeiras 24 horas depois da compra. Parágrafos que se explicam sozinhos, porque a busca fatia em trechos de ~1.200 caracteres |
| Condução da conversa | `apps/portal/src/lib/brain/metodo-silva.ts` | O Método Silva completo (abertura, descoberta, apresentação, preço, fechamento, objeções), com as travas de "zero invenção de dado" e "preço tem dono" |
| Doutrina da vertical | `apps/portal/src/lib/brain/billion-leads.ts` | Vertical `billion_leads_sales`, sempre no prompt: responder primeiro, ensinar o passo exato a quem quer comprar, só o verdadeiro (sem promessa de renda, sem cliente inventado, sem recurso "em breve" vendido como pronto, sem desconto fora do publicado, sem cartão na conversa) |
| Ligar sem migration | `apps/portal/src/lib/brain/vertical-override.ts` | Variável `BRAIN_VERTICAL_OVERRIDES`, um JSON de id de agente para `billion_leads_sales`. Só sobe um agente `metodo_silva`; nunca toca nas verticais de seguro |
| Tamanho do turno e tiques | `apps/portal/src/lib/brain/spoken-shape.ts` | Até 4 frases e 1 pergunta por turno na fala de vídeo. Tira o elogio de abertura ("ótima pergunta") e o tique "deixa eu ser honesto com você:". A mesma garantia que a Priscila ganhou |
| Trava de saída | `apps/portal/src/lib/brain/billion-guard.ts` | Deterministica, como a sentinela do seguro: nenhuma frase com valor fora da tabela verificada, preço de um idioma atribuído ao outro, real brasileiro, promessa de ganho, comissão inventada ou prazo de entrega inventado chega à voz. Sobrou só uma frase curta, entra o recuo "confere o preço na tela do catálogo" |
| Tabela de preços sempre no prompt | `billion-leads.ts` (`BILLION_PRICE_CARDS`) | Os números mais perigosos não dependem de busca. Um teste amarra a tabela do prompt à da trava |
| Avaliação | `experiments/billion-closer-eval/` | 23 cenários de um agente recém-cadastrado, critérios determinísticos e recuperação simulada da base |

**Por que a vertical existe, e por que sem migration.** A primeira avaliação ao vivo mostrou que o Método Silva genérico enrola quem já quer comprar: a closer respondia "deixa eu entender melhor o seu cenário" a "quanto custa o lead?" e a "quero comprar o de 25". Documentos não resolvem isso, porque a regra "responda primeiro" precisa estar sempre no prompt. A coluna `closer_vertical` do banco só aceita três valores, e gravar o quarto exigiria uma migration aplicada no hospedado pelo método da janela. Por isso a vertical é escolhida por `BRAIN_VERTICAL_OVERRIDES` enquanto a migration não existe. Se você preferir o caminho definitivo, a migration só precisa ampliar a regra de `agent_video_config` e as duas funções que validam o valor (0068 e 0072).

## Como provisionar (decisões e ações do operador)

1. Criar um tenant ou usar o existente, e um agente de vendas "Closer da Billion Leads Pro" com o nome que você escolher (os testes usam "Bia" só como exemplo).
2. Ingerir a base: `railway run -- node scripts/ingest-knowledge-bulk.mjs knowledge/billion-leads-pro --dry-run`, revisar e repetir com `--apply`. Custa embeddings, algo pequeno.
3. Escolher réplica e voz, gerar o segredo do cérebro, criar a persona na Tavus em dry-run e depois de verdade, e vincular com `closer_vertical = 'metodo_silva'`, idioma `portuguese` e falas `{portuguese, english, spanish}`. O passo a passo é o mesmo de `docs/operations/PRISCILA_LAUNCH.md`.
4. Ligar a vertical da Billion Leads Pro nesse agente (ela carrega a tabela de preços, a trava de saída e o limitador de fala): `railway variable set --service portal 'BRAIN_VERTICAL_OVERRIDES={"<id do agente>":"billion_leads_sales"}'` e reimplantar o portal. Sem essa variável o agente roda como closer genérico, que enrola o cliente que já quer comprar.
5. Ligar o cérebro, ativar o agente e fazer uma chamada de teste paga.

## Como disparar logo após o cadastro (especificação, a ser feita no CRM)

O código do CRM mostra três pontos de entrada, do mais simples ao mais forte:

- **Tela de onboarding** (`/app/onboarding`): a primeira pergunta já é "CRM com IA ou Leads", e o caminho de Leads tem quatro etapas (público, estados, pacote opcional, conclusão). Um convite "Fale com a [closer]" nessa tela, com o interesse escolhido como contexto, é o ponto natural.
- **Pipeline comercial interno** (`private.platform_pipeline_sync`): cria uma oportunidade por conta nova nas etapas `new_interest`, `contacted`, `demo`, `proposal`, `trial`, `first_purchase`, `active_customer`, `expansion`, `at_risk` e `lost`. Um evento ligado a essas etapas permite acionar o closer na hora certa, inclusive em checkout abandonado.
- **Pedido de demonstração** (`request_crm_demo`): já exige consentimento de contato e cria uma tarefa.

Dados mínimos para o closer: nome, idioma, interesse (CRM ou Leads), estados declarados e etapa do funil. Nunca senha, cartão nem documentos.

### O canal pós-cadastro: o que é, que tipos existem e o que falta

"Canal" é o caminho pelo qual o cliente recém-cadastrado conversa com a closer, aberto pelo sistema da Billion logo depois do cadastro. Hoje não existe nenhum. Na Raissa há um molde que serve de exemplo do que falta: a rota `apps/portal/src/app/api/leads/video-session/route.ts` responde `503 runtime_admission_required` de propósito, porque o segredo estático do control-tower não carrega o aviso de IA e o consentimento da pessoa que será gravada. A ADR-038 proíbe criar recurso pago antes dessa admissão. A closer da Billion tem o mesmo problema, com uma diferença: quem entra é um usuário do CRM, não do portal.

Três tipos de canal, do mais barato ao mais caro:

1. **Chat de texto dentro do CRM (recomendado como primeiro passo).** Um painel "Fale com a [nome]" na tela de onboarding e no Lead Desk, ao lado do tour. Custa centavos por conversa, não usa a Tavus, usa o mesmo cérebro e a mesma base. Serve para tirar dúvida de preço, plano, reposição e integração na hora em que o cliente decide. **Lacuna achada em 2026-10-19:** hoje só a fala de vídeo carrega a doutrina da Billion e a tabela de preços. A superfície de texto do cérebro monta o prompt genérico de chat (`buildCloserChatSystemMessages`, em `chat-completion-core.ts`), sem a doutrina; só a trava de saída de preços vale nas duas superfícies. Antes de abrir o texto, o portal precisa levar a doutrina e a tabela para a superfície de texto (com respostas um pouco mais longas que as de voz) e avaliar de novo ao vivo.
2. **Vídeo com a closer embutido no CRM.** O mesmo painel ganha o botão "falar por vídeo". É o canal mais forte para fechar, e o mais caro (minutos da Tavus). Exige tudo do tipo 1 mais teto diário e por pessoa, e uma chamada de teste paga para validar o caminho de ponta a ponta.
3. **Mensagem proativa (WhatsApp, SMS ou e-mail) para quem parou.** Cobre checkout abandonado e silêncio depois do cadastro. É o que mais converte e o que mais exige cuidado: precisa de consentimento de contato gravado no cadastro (o pedido de demonstração já pede), horário permitido, pausa imediata em "pare" e no máximo três toques com valor diferente em cada um.

O que precisa ser feito, em ordem:

1. **Decisão do dono:** qual tipo começa (a recomendação é texto, depois vídeo, depois mensagem proativa), e o nome e a voz da closer.
2. **ADR nova, "admissão de participante vindo do CRM".** Define como a conta do CRM vira uma admissão emitida no servidor: o backend do CRM (chamador de máquina com segredo próprio, não o segredo estático da Raissa) afirma quem é o usuário, o idioma, o interesse e a etapa do funil, e o portal grava, antes de gastar qualquer recurso pago, o aviso de IA entregue e o consentimento por finalidade. Inclui idempotência por cadastro, teto por pessoa e por dia, e chave de desligamento.
3. **Portal (este repositório):** a migração (próxima é a 0079) com a tabela de admissão, a rota de sessão que troca `runtime_admission_required` pela verificação real, o canal de texto sobre o cérebro existente, os testes e o painel de custo. A migração só é aplicada no banco hospedado com sua autorização.
4. **CRM (outro repositório, hoje com cópia local 561 commits atrás de `origin/main`):** o painel de conversa no onboarding, a chamada ao portal com os dados mínimos (nome, idioma, interesse, estados, etapa; nunca senha, cartão nem documento) e, para o tipo 3, o evento do `platform_pipeline_sync` nas etapas `trial`, `proposal` e checkout abandonado.
5. **Provisionamento da closer:** agente, persona, ingestão da base e `BRAIN_VERTICAL_OVERRIDES`, como na seção anterior.
6. **Depois:** a ferramenta somente leitura de catálogo para o preço sempre fresco.

Até lá, a closer pode ser testada nas telas de teste do portal e por uma chamada de vídeo de teste.

**Preço sempre fresco.** O código do CRM tem duas funções públicas, `public_lead_pack_catalog` e `public_crm_catalog_v3`, que dizem o catálogo e se o checkout está aberto. A base é um retrato de 17/10/2026, e o dono mudou o preço dos pacotes em português duas vezes em três dias. O ideal é uma ferramenta somente leitura que o closer consulte antes de citar preço. Enquanto não existir, a base diz ao closer para mandar o cliente conferir o valor na tela do checkout.

## Decisões do dono e pendências

Foram achadas pelo mapeamento do código (`origin/main`, que está 561 commits à frente da cópia local do CRM). As decisões abaixo foram dadas em 2026-10-18 e 2026-10-19 e já estão na doutrina e na base.

1. **Reposição depende do CRM. Decidido: sim, assinatura paga.** O sistema é quem registra as tentativas de ligação, WhatsApp e SMS, e só assim a Billion verifica os requisitos. **O teste grátis de 7 dias não vale**, porque a regra precisa de 10 dias de tentativas registradas e o teste dura 7. O closer diz isso a quem pergunta e avisa, antes da compra, quem pretende comprar só os leads ou está no teste. **Falta alinhar o texto público e os Termos:** `llms-full.txt` e a página de leads ainda dizem que não precisa de CRM, e os Termos precisam dizer que o teste não conta. Enquanto isso, o closer segue a regra da casa e um cliente pode ver o texto antigo no site.
2. **Flag da garantia de reposição: ligada (confirmado em 2026-10-19).** O closer pode apresentar a reposição como parte da compra, sempre como crédito em outro lead, nunca como garantia de venda.
3. **Checkout V3: aberto (confirmado em 2026-10-19).** O closer pode tratar os planos como disponíveis. Se a tela mostrar "indisponível" ou "inscrição em breve", ele não insiste e passa para a equipe.
4. **Depoimentos do site: reais (confirmado em 2026-10-19).** Mesmo assim o closer continua sem citar cliente, volume ou resultado, porque a base não tem o texto verificado de nenhum depoimento. Para o closer citar, alguém precisa colocar na base os depoimentos reais, com autorização de uso.
5. **Termos dos leads Meta: aprovados pelo jurídico (confirmado em 2026-10-19).** Nada a fazer na base. Vale guardar a data e o parecer na pasta de compliance.
6. **Textos do site que o closer não repete:** "Congratulations! You just earned N free days of the best and most complete CRM" (superlativo sem prova), "One closed Final Expense policy covers your Starter plan for the month" (promessa de ganho, plano antigo), e "validated consent" em termos gerais (internamente, o fluxo antigo do Meta não tem prova automática de consentimento para telefonia de IA).
7. **Texto de indicação desatualizado.** `llms-full.txt` ainda fala de comissão sobre pacote de leads, que foi removida em 12/10.
8. **Preço de consumo.** Todas as tarifas estão "em validação" e o débito pago da carteira está desligado. O closer só cita como previsto.
9. **Domínios.** O código usa `billioncrm.com` e `billionleadspro.com` como apelidos.

Informação confidencial que não entrou na base e nunca deve entrar: economia unitária dos leads e nomes de fornecedores (`docs/UNIT_ECONOMICS_LEADS.md`, campo `fornecedor`).

## O que a simulação de conversas achou (2026-10-18)

O avaliador de turno único (23 e depois 36 cenários) não pegou o defeito mais grave, que só aparece em conversa longa: quando a busca não traz o trecho do preço, **a closer inventa a tabela inteira**. Casos reais das duas versões do prompt: "10 leads por 99 dólares, 25 por 199... entrega em 24 a 48 horas", "Solo 29 dólares por mês", "um lead sai de R$ 18 a R$ 22", "a comissão costuma estar entre 40 a 100 dólares... com 3 a 8 vendas você já cobre os 300", "o resto é lucro seu", e preço de espanhol atribuído a português. A resposta foi a trava de saída e a tabela sempre no prompt, não mais texto de instrução.

O simulador (`experiments/billion-closer-sim/`) faz o cliente conversar com a closer por até 7 turnos. Há 6 personas com objetivo escondido (iniciante com medo, veterano frustrado, líder de agência cética, quem usa outro CRM, quem só está olhando, quem quer comprar rápido). Um juiz com rubrica dá notas de 1 a 5, e métricas determinísticas contam preço, promessa, prazo e fórmulas de robô. Comparação com a closer genérica (`metodo_silva`), 18 conversas por versão, mesmo modelo:

| | Genérica | Com doutrina, tabela e trava |
|---|---|---|
| Média das 8 notas do juiz | 2,95 | 3,43 |
| Turnos com falha determinística | 7 (preço inventado, promessa de renda, elogio de abertura) | 4 (adiamento, tique) |
| Cliente que quer comprar rápido | 2,2 | 4,4 |
| Conversas que terminam em compra | 3 de 18 | 4 de 18 |

Depois de mais ajustes (comissão inventada na trava, faixas "X a Y dólares", prazo do teste primeiro para quem tem medo de gastar), uma quarta rodada de 18 conversas deu média 3,2, dentro do ruído da anterior. **Leitura honesta:** o juiz é o mesmo modelo que a closer (viés a favor dele) e a variação entre rodadas é de uns 0,3 ponto, então a nota do juiz é direcional. O que vale como prova são as métricas determinísticas: com a trava e a tabela, nenhum preço inventado chegou à voz. **A persona mais fraca continua sendo a iniciante com medo (2,7 de 5):** o Haiku 4.5 acolhe bem mas pergunta demais e demora a dar o passo de segurança. É o ponto onde um modelo maior ajuda.

## Modelo: achado que muda o plano

O OpenRouter lista modelos mais novos e muito mais baratos: `claude-haiku-5.5` a US$ 0,10 por milhão de entrada (o Haiku 4.5 de produção custa US$ 1) e `claude-sonnet-5.5` a US$ 2. No mesmo avaliador, os dois escrevem bem mais natural já no texto cru (Sonnet 5.5: 66% limpo cru, contra 21% do Haiku 4.5; 41 palavras; menos de uma pergunta por turno). **Mas 15 a 19% das respostas voltaram vazias** ("completion payload has no text content"): o adaptador manda `max_tokens: 512` sem controlar o raciocínio, e esses modelos gastam parte desse orçamento pensando. Trocar `OPENROUTER_MODEL` em produção, portanto, não é drop-in. O trabalho é no adaptador (desligar ou limitar o raciocínio) e depois conferir a tabela de custo do ledger. Se der certo, é ganho de naturalidade e de custo ao mesmo tempo.

## Resultado da avaliação de turno único (2026-10-17)

Modelo de produção (`anthropic/claude-haiku-4.5`), 23 cenários de um agente recém-cadastrado, 3 repetições, base injetada pela recuperação simulada, e a closer na condição de conversa real (a abertura dela já aconteceu). Respostas sem nenhuma falha no que iria para a voz:

| Rodada | O que mudou | Sem falha |
|---|---|---|
| 1 | Closer genérica, sem abertura nos cenários | 33% |
| 2 | Cenários com abertura realista (sem isso a base chegava como se fosse a fala da pessoa) | 43% |
| 3 | Vertical `billion_leads_sales` com "responder primeiro" sempre no prompt | 64% |
| 4 | Exemplo curto de "quero comprar" e três critérios corrigidos | 72% |
| 5 | Regra de citar o número exato por idioma e mais três critérios corrigidos | 90% |

Depois de ler as 7 falhas da rodada 5, 5 eram respostas corretas reprovadas por critério estreito, e regrado a mesma saída com os critérios corrigidos dá 65 de 69 (94%). Atenção: parte da subida entre as rodadas 3 e 5 veio de corrigir critérios, não só do modelo, e a correção foi feita depois de ver os resultados. O ganho que não depende dos critérios é o das rodadas 2 e 3: a closer parou de devolver "deixa eu entender melhor" a quem perguntava preço ou queria comprar. O limitador de frases levou o texto cru de 43% para 90% (tamanho médio de 64 para 51 palavras, exatamente 1 pergunta por turno).

O que ainda falha: o cupom (às vezes ela não esclarece que cupom libera dias de CRM e não desconto), um caso de "quero comprar" em que ela perguntou o idioma antes de orientar, e a evasiva "não tenho o preço em português" quando o trecho do preço não foi trazido pela busca. O primeiro é fraqueza da resposta; o último é um risco da busca real, que só se mede depois da ingestão.

## Como avaliar

Offline, sem custo: `node experiments/billion-closer-eval/run.mjs`. Simulação de conversas, que gasta crédito: `BILLION_SIM_LIVE_CONFIRM=spend-openrouter-credit VARIANT=billion_leads_sales RUNS=3 railway run --service portal -- node experiments/billion-closer-sim/run.mjs > saida.json`, e o mesmo com `VARIANT=metodo_silva` para comparar. Ao vivo, gasta crédito do OpenRouter: `BILLION_EVAL_LIVE_CONFIRM=spend-openrouter-credit REPS=3 railway run --service portal -- node experiments/billion-closer-eval/run.mjs`. Os cenários injetam os documentos que a busca de produção deveria trazer, para medir a closer e não a busca. A qualidade da busca real (embeddings) se mede depois da ingestão.
