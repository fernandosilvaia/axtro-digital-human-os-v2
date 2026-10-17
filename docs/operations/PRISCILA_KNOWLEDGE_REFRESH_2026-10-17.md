# Atualização do cérebro da Priscila: o que mudou e o que ainda precisa de revisão (2026-10-17)

Estado: **feito na branch `claude/priscila-knowledge-refresh`, sem push, nada ingerido e nada em produção.** A ingestão paga embeddings e é decisão do operador.

## Como a pesquisa foi feita

1. Um fluxo de pesquisa profunda (102 agentes) rodou primeiro. Entregou só 18 afirmações confirmadas, porque o limite do próprio fluxo verificou apenas 25 das 95 afirmações extraídas. Cobriu bem os dados de mercado de 2025 da LIMRA, a regra de melhor interesse da NAIC, a regra de substituição, o risco do financiamento de prêmio e a subscrição acelerada. Não confirmou nada sobre técnicas de venda, FCC e TCPA, boletim de IA da NAIC, leis estaduais de IA, AG 49-A, dividendos, GUL, anuidades e troca 1035.
2. Quatro agentes focados, com listas fechadas de itens e a regra de dizer "não verificado" quando não achassem a fonte primária, refizeram essas áreas: compliance, mecânica dos produtos, evidência de vendas e uma auditoria linha a linha dos 13 documentos que já existiam.
3. O que passou ficou nos documentos. O que não passou está marcado nesta página e nos documentos de origem.

Fontes completas: `docs/compliance/LIFE_INSURANCE_AI_REGULATORY_MAP_2026-10.md` e `docs/strategy/PRISCILA_SALES_EVIDENCE_2026-10.md`.

## O que mudou nos documentos que ela já tinha

| Documento | Mudanças principais |
|---|---|
| 01 bússola | Mortgage protection pode pagar o credor (crédito vida); idades de final expense variam; RILAs são valores mobiliários; pergunta "quem sentiria primeiro" trocada por "quem depende de você" (alavanca de medo); Priscila sempre diz que é IA; fim da promessa "responder tudo" no repasse |
| 02 final expense | Benefício graduado devolve prêmios mais um percentual definido (110% é comum) ou juros, conforme a seguradora, e não "mais juros" sempre; guaranteed issue ganhou custo e limite no mesmo fôlego; custos de funeral (NFDA 2023) e pagamento de US$ 255 do Social Security; removida a afirmação sem fonte de "planejamento de funeral grátis"; removida a exceção que convidava a pressão de prazo; alavancas de culpa trocadas por perguntas neutras |
| 03 term e mortgage protection | Mortgage protection explicado com os três produtos que o rótulo cobre; removida a frase sem fonte sobre leads de registros públicos; exemplo de DIME corrigido para 720 mil dólares; conversão do grupo |
| 04 whole life e GUL | Removido "forced savings"; dividendos e adições pagas; GUL com idade até 121 e perda da garantia por pagamento a menor |
| 05 IUL | "AG 49-B" removido (apelido informal da correção de 2023); AG 49-A com a revisão de dez 2025 e vigência de 1 abr 2026; exemplos de teto e participação da SEC; "LIRP" removido; frases de imposto com "um profissional confirma" |
| 06 anuidades | Removida a comparação com CDB (a norma de publicidade da NAIC proíbe); prazos de resgate de 6 a 10 anos ou mais; MVA; RILAs; imposto adicional de 10% antes dos 59 anos e meio; "nearly every state" para melhor interesse |
| 07 Kai-Zen | De "nome registrado" para "nome de estratégia usado por distribuidores"; removidos os anos 5 e 15 e o "policy itself as collateral" porque as descrições se contradizem; riscos gerais de financiamento (taxa flutuante, juros capitalizados, chamada de garantia, regras de split-dollar e de interesse segurável); removido o texto promocional "more death benefit and more potential cash value" |
| 08 living benefits | Praticante de saúde licenciado, 2 de 6 atividades por 90 dias, 24 meses no imposto federal, Medicaid; removido o gancho "muitas famílias temem mais"; pergunta de gancho sem anedota inventada |
| 09 subscrição | "Coverage is solid" trocado; subscrição acelerada com a volta ao exame; prêmio não pago e reintegração; free look sem número único; suicídio de um ano em alguns estados |
| 10 substituição | "Novos prazos podem recomeçar, salvo mesma seguradora"; troca direta, base de custo, MEC; "não cancele nada" trocado por "deixe o agente comparar" |
| 11 empresas e herança | Aviso e consentimento de apólice empresarial (IRC 101(j)); isenção federal de US$ 15 milhões por pessoa em 2026 |
| 12 conversas sensíveis | "Most human person" trocado por "most honest"; aviso de IA e verificação do agente para idosos; decisão em família; motivos reais da hesitação; grupo com conversão |
| 13 glossário | `seguro de vida universal indexado`, `renda vitalícia` (em português do Brasil "anuidade" é taxa de cartão), `valor de resgate`, `usuário de tabaco ou nicotina`, free look de 10 a 30 dias ou mais, intro com o aviso de que vários termos são sugestões |

## Documentos novos (14 a 25)

14 mitos e o mito do preço; 15 beneficiários, cobertura de grupo e benefícios públicos; 16 saúde e tipo de emissão; 17 roteiro da primeira conversa; 18 regras de contato e aviso de IA; 19 o que uma IA sem licença pode e não pode fazer; 20 a 25 o motor de argumentação (veja abaixo).

## Mudança de código: a sentinela

`apps/portal/src/lib/brain/compliance-sentinel.ts` ganhou duas regras, com testes (`tests/portal/life-insurance-compliance-sentinel.test.mjs`, terceiro red team):

- `li_claims_human`: bloqueia "sou uma pessoa de verdade", "I'm not a robot" e equivalentes em espanhol e português. "Sou uma IA, não uma pessoa" passa, porque a negação absolve a primeira família de frases. É o caso que as leis de divulgação de IA da Califórnia, de Utah e do Maine miram.
- `li_cd_comparison`: bloqueia anuidade comparada a CDB ou certificado de depósito. "Não é um CD" passa.

Não adicionei regra para urgência, culpa nem declaração de imposto, porque não há como escrevê-las sem muitos falsos positivos. A defesa disso fica no texto do pacote e na avaliação por conversa inteira.

## Motor de argumentação (pedido do operador em 2026-10-17)

O pedido foi dar à Priscila poder de argumentação e técnica de vendas. O que entrou:

- **No prompt** (`apps/portal/src/lib/brain/life-insurance.ts`, bloco `ARGUMENTATION_*`, só no modo de qualificação): nove regras curtas de persuasão adaptativa. Ler o ritmo e o estilo da pessoa, argumentar com as palavras dela, fazer ela mesma dizer o custo, tratar a resistência como informação (nomear, uma pergunta de o quê ou como, um fato verdadeiro, um passo pequeno), preço só depois do valor confortável, prazo honesto (idade e saúde na data da aplicação), régua de 0 a 10, fechar o compromisso com duas janelas de horário e reversão de risco verdadeira. Em `metodo-silva.ts` a rotina genérica de objeções ("reancore no custo da dor", "baixe o preço") deixou de entrar na vertical regulada, porque contradiz uma closer que não cota nem fecha. O prompt ficou dentro do teto de 14.000 caracteres: a bússola foi enxugada (o detalhe já está na base) e a qualificação ficou mais densa.
- **Na base** (documentos 20 a 25): banco de argumentos (afirmação, razão, prova, pergunta), objeções de dinheiro e prazo, objeções de confiança, família, cobertura e saúde, biblioteca de técnicas com as linhas vermelhas, fechamento do compromisso com mensagens de confirmação, lembrete e recuperação de falta (em inglês, espanhol e português), e idioma, cultura e voz.
- **Medida:** 12 cenários novos de persuasão no banco de avaliação, com critérios determinísticos (uma pergunta, acolhimento antes da resposta, nenhum prazo inventado, convite à família, duas janelas de horário, verificação de licença). Uma checagem por defeitos plantados achou um furo no critério de pressão ("a oferta termina hoje"), que foi corrigido e virou teste permanente. A qualidade real da conversa só se mede com a avaliação ao vivo, que gasta crédito.

## Sobre o aviso de IA

O operador pediu para não avisar que a Priscila é uma IA. **Isso não foi feito.** O aviso curto e a regra de nunca negar continuam, por três razões objetivas: o Maine aprovou em 2025 uma lei que exige aviso claro quando o consumidor pode achar que fala com uma pessoa (a data de vigência não foi verificada), a Califórnia proíbe usar um bot para enganar sobre a identidade artificial com o fim de vender, Utah exige verdade quando perguntam, e o Colorado e o Idaho passam a exigir em 2027 (veja o mapa regulatório); e o público de final expense é de idosos. Também seria contra a doutrina que o próprio Método Silva já traz ("nunca finge ser humana"). O que o operador pode decidir, com advogado: mover o aviso do falado para um rótulo permanente na tela do vídeo ("Priscila, consultora de IA"), que é claro e visível sem interromper a conversa, mantendo a resposta honesta sempre que perguntarem. Isso exige o canal público do consumidor (ADR nova) e não está implementado.

Uma edição que encurtava o bloco multilíngue de proibições foi bloqueada pelo classificador de segurança do ambiente (`Security Weaken`). Não contornei: aquele bloco ficou como estava, e o orçamento do prompt foi fechado cortando só texto de qualificação e de bússola.

## Avaliação ao vivo (2026-10-17, modelo `anthropic/claude-haiku-4.5`, o de produção)

24 cenários, texto cru do modelo antes da sentinela, sem a base de conhecimento (a avaliação passa `knowledgeMatches: []`, então os documentos 20 a 25 **não** foram exercitados). Três repetições por cenário, prompt antigo (`main`) contra prompt novo, sem contar o travessão que o sanitizador remove antes do áudio.

| | Prompt antigo | Prompt novo |
|---|---|---|
| Respostas sem nenhuma falha | 19 de 72 (26%) | 19 de 72 (26%) |
| Cenários de persuasão | 12 de 36 (33%) | 14 de 36 (39%) |
| Cenários originais | 7 de 36 (19%) | 5 de 36 (14%) |
| Respostas com mais de 4 frases | 25 | 38 |
| Respostas com mais de 1 pergunta | 19 | 19 |
| Tamanho médio | 76 palavras | 75 palavras |

**Conclusão honesta:** o motor de argumentação, como texto de prompt, **não mudou a nota de forma mensurável** com esse modelo. A diferença nos cenários de persuasão (2 respostas em 36) está dentro do ruído. O defeito dominante é o mesmo nas duas versões: respostas longas demais para voz e mais de uma pergunta por turno. As regras 6 (prazo honesto) e 8 (duas janelas de horário) quase nunca foram aplicadas; em "ready-to-book" a Priscila pediu nome e sobrenome em vez de oferecer horários.

Bom: nenhuma resposta afirmou ser humana, prometeu aprovação, deu preço definitivo, falou em licença federal ou sugeriu ligação com o governo. O aviso de IA apareceu no primeiro turno em todas as aberturas.

**Defeitos reais achados e corrigidos nesta rodada**
1. A sentinela apagava a resposta certa "somos separados do Medicare" (negação sem a palavra "not"). Agora `separate from`, `independent of`, `unaffiliated with` e os equivalentes em espanhol e português valem como negação, só dentro da própria afirmação.
2. Em espanhol, 8 de 12 respostas usaram "tú" (déjame, te, tu) apesar da diretiva. A diretiva foi reforçada e o novo critério `language:tuteo` mede: 0 de 10 depois.
3. O modelo às vezes termina com direção de cena entre asteriscos ("*Espero en silencio.*"). O sanitizador tirava os asteriscos e a voz leria a frase. Agora o trecho que ocupa a linha ou fecha a resposta some.
4. O critério de acolhimento não reconhecia "I hear that" e "I understand".

**Defeito conhecido que NÃO foi alterado:** quando o modelo cita "can't lose money" para corrigir o mito, a sentinela remove a frase de correção (regra de segurança, `li_loss_guarantee`). O restante da resposta ainda corrige, mas o efeito pode ser estranho. Afrouxar essa regra é decisão do operador.

**Próximos passos que a evidência sugere**
- Brevidade é o maior ganho: exemplos curtos no prompt (few-shot), um modelo mais forte para o cérebro, ou um limitador determinístico de frases na saída.
- Repetir a avaliação com a base de conhecimento simulada (recuperação dos documentos por tema), para medir os documentos 20 a 25.
- Chamada de vídeo de teste, que mede ritmo e voz, o que o texto não mostra.

## Brevidade (limitador de fala)

Depois da avaliação ao vivo, o tamanho do turno passou a ser garantido por código, não por prompt (`apps/portal/src/lib/brain/spoken-shape.ts`, aplicado nas verticais antes da sentinela). Até 4 frases e 1 pergunta passam intactas; acima disso ficam 3 frases afirmativas mais a pergunta que conduz o turno, as frases com aviso de IA, agente licenciado, negação de governo ou "sem obrigação" entram primeiro, e perguntas encadeadas viram uma só. A sinalização `reply_shortened` aparece nos `guardrailFlags`. O prototipo foi medido em 144 respostas gravadas antes de entrar no código; nenhuma pergunta se perdeu.

Medido ao vivo (modelo de produção, 24 cenários x 3 repetições, 70 respostas válidas, 2 timeouts do OpenRouter):

| | Texto cru do modelo | O que iria para a voz |
|---|---|---|
| Respostas sem nenhuma falha | 25 de 70 (36%) | 51 de 70 (73%) |
| Cenários de persuasão | 18 de 36 | 25 de 36 |
| Cenários originais | 7 de 34 | 26 de 34 |
| Tamanho médio | 75 palavras | 51 palavras |
| Perguntas por resposta | 1,3 | 1,0 |

O que sobra são falhas de conteúdo: 10 respostas sem citar o agente licenciado, 3 sem o argumento de prazo honesto, 3 sem oferecer duas janelas de horário, 1 que insistiu depois de um pedido de parar. O limitador não resolve isso; resolve o ritmo.

## O que a verificação NÃO confirmou, e continua no pacote com cautela

- **Documento 15 (beneficiários):** os parágrafos sobre beneficiário primário e contingente, menor de idade e inventário são prática padrão do setor e não foram conferidos fonte por fonte. Um agente licenciado deve ler.
- **Documento 16 (saúde):** o exemplo de uma seguradora vem de um guia de perguntas de outubro de 2024, hospedado por uma agência. A lista completa de exclusões vitalícias foi reprovada na verificação (0 a 3), então não está lá. Os prazos de câncer, coração e diabetes citados passaram por 2 a 1 e 3 a 0 e valem só como ilustração de uma seguradora.
- **Documento 07 (Kai-Zen):** toda descrição pública do programa é promocional. Nenhuma revisão de regulador, tribunal ou IRS foi encontrada. Uma busca citou uma queixa de abril de 2026, sem fonte (NV). A marca KAI-ZEN é registrada nos EUA para corretagem e consultoria de seguros (registro 4.371.430, NIW AP, LLC); a renovação não foi verificada.
- **Glossário:** vários termos não foram confirmados em fonte de uso real nos EUA (veja o aviso na própria introdução). Precisa de falante nativo e de agente licenciado.
- **Dado de preço:** o número de que 44% dos hispânicos acham caro e 72% superestimam o custo vem da página da LIMRA de 2024, sem n nem datas de campo.
- **Portugueses e brasileiros:** não há pesquisa crível. O pacote diz isso e não preenche.
- **Subscrição:** o prazo "a few hours" da subscrição acelerada é o melhor caso, não o típico.

## O que precisa de humano antes de ingerir

1. Revisão por agente licenciado (e ideal por advogado de seguros) de todo o pacote, em especial dos documentos 02, 05, 06, 07, 15, 16 e 18.
2. Falante nativo de espanhol e de português dos EUA para o glossário e para as frases de exemplo.
3. Decisão de ingestão (paga embeddings): `railway run -- node scripts/ingest-knowledge-bulk.mjs knowledge/life-insurance/priscila --dry-run`, revisar e só então `--apply`. É idempotente por nome (veja o README do pacote).
4. Decisão sobre qual conta e qual tenant recebe as fontes.

## Testes executados nesta branch

`node --test` em `life-insurance-compliance-sentinel`, `life-insurance-knowledge-pack`, `life-insurance-brain` e `priscila-eval` (31 testes verdes), `pnpm run lint` e `pnpm run typecheck`. Uma varredura própria passou a sentinela em todas as linhas do pacote e deu zero violações. A suíte completa (`node scripts/test.mjs`) passou: 2.256 testes de Node e 83 de Python. Não rodei a avaliação ao vivo, que gasta crédito do OpenRouter e exige autorização.
