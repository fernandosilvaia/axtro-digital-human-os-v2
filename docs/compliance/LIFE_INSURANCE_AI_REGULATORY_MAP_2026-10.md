# Mapa regulatório de uma IA que fala de seguro de vida nos EUA (2026-10-17)

Estado: **pesquisa de fontes primárias, não é parecer jurídico.** Cada item foi aberto por um agente de leitura em 2026-10-17 (eCFR pela API versionada, PDFs do FCC, do NAIC e dos legislativos estaduais). Onde o agente não conseguiu abrir a fonte primária, o item está marcado **NV** (não verificado). Leis mudam rápido: confirme com advogado antes de operar em escala. Os resumos para a Priscila falar estão em `knowledge/life-insurance/priscila/18-contact-rules-and-ai-disclosure.md` e `19-what-an-unlicensed-ai-may-and-may-not-do.md`.

## O que muda na operação

1. Toda chamada ou voicemail de IA para telemarketing precisa de consentimento por escrito do número chamado, com o vendedor nomeado.
2. Janela segura de contato: 8h às 20h no horário local do lead, domingo no Texas a partir do meio-dia, no máximo 3 tentativas em 24 horas por pessoa.
3. "Pare" vale em qualquer canal, na hora, e para marketing vale para todo o marketing da empresa.
4. A Priscila avisa que é IA no início, em voz, vídeo e texto, e de novo quando perguntada. Isso cobre todos os gatilhos estaduais encontrados.
5. Ela fica no ensino geral, nos fatos que a pessoa oferece e no agendamento. Estados como Flórida e Texas tratam até receber dados de proposta como atividade licenciada.

## 1. Voz de IA e o TCPA (FCC 24-17): confirmado, com limites

Adotada em 2 fev 2024, divulgada em 8 fev 2024 (CG Docket 23-362). A "artificial or prerecorded voice" do TCPA cobre IA que se parece com voz humana, inclusive clonagem. Exige consentimento prévio expresso, e **consentimento prévio expresso por escrito** quando a chamada é telemarketing. As regras de identificação e de opt-out de 64.1200(b) valem para chamadas de IA.

- O texto não cita text-to-speech nem avatar de vídeo; a cobertura de TTS decorre de "resemble human voices" (inferência do agente).
- Fala de chamadas que o chamador "inicia" (outbound). Chamada iniciada pelo consumidor fica fora. Um retorno pedido pelo consumidor é outbound e exige consentimento. Uma sessão de vídeo no navegador que não disca número provavelmente não é "telephone call" (inferência, NV).
- Tribunais não são obrigados a seguir a leitura do FCC em ações privadas (McLaughlin Chiropractic v. McKesson, 20 jun 2025), então o ruling é persuasivo, não vinculante.
- Fonte: https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf

## 2. Consentimento de um vendedor por vez: derrubado

Insurance Marketing Coalition v. FCC, 11th Cir., nº 24-10277, 24 jan 2025: o FCC excedeu a autoridade e o tribunal anulou a Parte III.D da Ordem de 2023 (um vendedor por vez, "logically and topically associated"). A Ordem de 2012 (consentimento escrito para robocalls e robotexts de telemarketing) **segue em vigor**. A definição vigente em 47 CFR 64.1200(f)(9): documento assinado (assinatura eletrônica vale), autoriza o vendedor, inclui o número e traz aviso claro de que assinar autoriza telemarketing com discagem automática ou voz artificial e não é condição de compra. Um formulário que nomeia parceiros ainda sustenta consentimento federal se esse aviso e o vendedor nomeado estiverem de fato lá.
Fontes: https://media.ca11.uscourts.gov/opinions/pub/files/202410277.pdf e a API do eCFR (seção 64.1200, versão de 2026-10-15). Número da ordem do FCC que revogou a regra: NV.

## 3. Revogação de consentimento ("revoke-all"): mais novo que janeiro de 2026

- Regra: 64.1200(a)(10), respeitar em prazo razoável, no máximo 10 dias úteis. A parte "revoke all" foi suspensa até 31 jan 2027 (DA 26-12, 6 jan 2026).
- **Em 30 set 2026 o FCC adotou a FCC 26-67** (divulgada em 1 out 2026): o chamador pode designar um método exclusivo de revogação (tecla ou voz na chamada, palavras como STOP, ou site ou número designado, com divulgação clara). Um "pare" para mensagem informativa pode valer só para aquela categoria. Um "pare" para chamada ou texto de marketing revoga todo o marketing daquele chamador. Vigora 30 dias após a publicação no Federal Register e substitui a data de 31 jan 2027. **Publicação no Federal Register ainda não encontrada** (NV; fonte secundária também não achou em 14 out 2026).
- O prazo de 10 dias úteis não mudou; o FNPRM pergunta se deve encurtar (uma carta conjunta sugere 7 dias).
- Flórida: ação por texto exige um STOP mais 15 dias (501.059(10)).
- Decisão prática: tratar "pare" como global para marketing desde já.
- Fonte: https://docs.fcc.gov/public/attachments/FCC-26-67A1.pdf

## 4. Horários e frequência

Federal: 64.1200(c)(1) proíbe solicitação telefônica antes das 8h e depois das 21h no local de quem recebe; 64.1200(e) estende a celulares e a textos.

| Estado | Regra | Observação |
|---|---|---|
| Flórida | 8h às 20h; mais de 3 chamadas em 24 h sobre o mesmo assunto proibidas (501.616(6)) | 501.604 isenta agentes licenciados da Lei de Solicitação, mas **não** de 501.616(6) e (7). 501.059 exige consentimento por escrito para chamada automática ou gravada, inclusive texto; US$ 500 por violação, até 3x se dolosa |
| Oklahoma | 8h às 20h, 3 em 24 h (775C.4) | HB 3168, vigente desde 1 nov 2022; alterações posteriores NV. Agentes licenciados dentro da licença são isentos |
| Maryland | nada das 20h às 8h; máximo 3 em 24 h por pessoa (14-4502(c)) | vigente 1 jan 2024; consentimento escrito para chamada automática ou gravada; US$ 500 por violação |
| Washington | 8h às 20h (RCW 80.36.390(8)) | ação por repetição, no mínimo US$ 1.000 cada; exclui chamada em resposta a pedido do consumidor |
| Texas | 9h às 21h de segunda a sábado, meio-dia às 21h no domingo (Bus. & Com. 301.051(b)(2)) | SB 140 (vigente 1 set 2025) inclui texto e imagem em "telephone solicitation" e acrescenta fiscalização pelo DTPA |

Fontes: eCFR 64.1200; statutes e PDFs dos legislativos de FL (501.616), OK (HB 3168 ENR), MD (14-4502), WA (RCW 80.36.390) e TX (BC 301; SB 140).

## 5. Do Not Call e relação comercial estabelecida

Registros nacionais valem indefinidamente; a base consultada não pode ter mais de 31 dias (64.1200(c)(2)). Pedido de não ligar à empresa: atender em até 10 dias úteis e honrar por 5 anos ((d)(3) e (d)(6)). Relação comercial estabelecida: compra ou transação em 18 meses, ou consulta ou proposta em 3 meses, salvo se uma das partes encerrou ((f)(5)); um pedido específico ao vendedor encerra. Os parágrafos (a)(2) e (a)(3) **não** trazem exceção de relação comercial, então telemarketing com discagem automática ou voz artificial para celular continua exigindo consentimento escrito (leitura do agente). A Flórida mantém lista própria de não solicitação (501.059(3) e (4)).

## 6. Boletim de IA da NAIC

Adotado pelo Executive Committee e Plenary em 4 dez 2023. Endereçado a "All Insurers Licensed" no estado; **não cita produtores nem agentes**, que só são alcançados pela cadeia de fornecedores da seguradora. Espera um programa escrito de governança de IA, controles de risco, auditoria interna, testes de erro, viés e discriminação injusta, diligência e cláusulas de auditoria para IA e dados de terceiros. Mapa da NAIC "Status as of October 8, 2026": **29 adotantes (27 estados, DC e Porto Rico)**. CA, CO, NY e TX constam à parte, com regras ou orientações próprias (Colorado 3 CCR 702-10, alterada com vigência em 15 out 2025; Nova York Circular Letter 7 de 2024). Um boletim não é lei. Se a Priscila rodar para uma seguradora, espere exigências contratuais de governança, testes e acesso de auditoria.
Fontes: https://content.naic.org/sites/default/files/inline-files/2023-12-4%20Model%20Bulletin_Adopted_0.pdf e https://content.naic.org/sites/default/files/legal-adoption-map-ai-model-bulletin.pdf

## 7. Leis estaduais de divulgação de IA

| Estado | O que diz | Vigência | Observação |
|---|---|---|---|
| Califórnia | B&P 17940 a 17943: ilegal usar bot online com californianos "com intenção de enganar" sobre a identidade artificial para incentivar uma venda; sem responsabilidade se divulgar de forma clara e visível | 1 jul 2019 | O número de 10 milhões de usuários só define "online platform". Sem cláusula de multa; cumulativa com outras leis |
| Utah | SB 226, 13-75-103: divulgar se o consumidor perguntar de forma clara; divulgar no início e ao longo da conversa é porto seguro (13-75-104). Dever proativo só para ocupações reguladas pelo Department of Commerce em interações de alto risco | 7 mai 2025 | Produtor de seguros: NV. Multa até US$ 2.500 por violação, US$ 5.000 por violar ordem. O AI Policy Act (cap. 72) expira em 1 jul 2027 (SB 332) |
| Maine | P.L. 2025 c. 294: proibido usar chatbot "ou qualquer outra tecnologia" no comércio que possa levar um consumidor razoável a achar que fala com humano, sem aviso claro e visível | assinada em 12 jun 2025 | Violação é prática desleal. Data de vigência e valores de multa: NV |
| Colorado | SB 24-205 foi revogada e substituída pela **SB 26-189** (assinada em 14 mai 2026, cap. 131) | 1 jan 2027 | Seguro é domínio coberto. Aviso claro no ponto da interação antes de decisão relevante e explicação em 30 dias de um resultado adverso. Só o procurador-geral aplica, aviso para correção até 1 jan 2030. Não é regra geral de "sou um bot" |
| Idaho | S 1297: divulgar IA se pessoas razoáveis forem enganadas | 1 jul 2027 | US$ 1.000 por violação, teto de US$ 500.000 por operador. Exclui ferramentas "primarily designed and marketed for commercial use by business entities"; se a Priscila se enquadra: NV |
| Texas (TRAIGA), Washington (HB 2225) e outros | NV, só fontes secundárias | | |

Decisão prática: divulgar proativamente, em texto, voz e vídeo, no início e de novo quando perguntada. Isso satisfaz todos os gatilhos acima.
Fontes: leginfo.legislature.ca.gov (BPC 17941), le.utah.gov (SB 226 enrolled), legislature.maine.gov (HP1154), leg.colorado.gov (bill 116489), legislature.idaho.gov (S1297 2026).

## 8. Atividade de seguros sem licença

Modelo NAIC #218 (compilação de jan 2005; revisões posteriores NV). **Sell**: trocar um contrato de seguro por dinheiro em nome de uma seguradora. **Solicit**: tentar vender, ou pedir ou instar uma pessoa a pedir um tipo de seguro de uma companhia específica. **Negotiate**: conferir diretamente ou orientar um comprador sobre benefícios, termos ou condições substantivos de um contrato específico, por quem vende ou obtém seguro. A Seção 3 proíbe os três sem licença. A Seção 4.B isenta equipe sem comissão de função executiva, administrativa, gerencial ou de escritório ligada só indiretamente à venda, e publicidade de mídia de massa sem intenção de solicitar.

- Texas, Ins. Code 4001.051(b): agir como agente inclui solicitar, ou receber ou transmitir uma proposta de seguro; (d): encaminhar um cliente a um agente não é conduta de agente, salvo se a pessoa discute termos ou condições específicos de apólice.
- Flórida, 626.112(1)(b): solicitação inclui descrever benefícios, termos, prêmios ou taxas, fazer recomendações gerais ou específicas, preencher propostas, comparar produtos e aconselhar. Atividade sem licença consciente, ou ajudá-la, é crime de terceiro grau ((10)).
- Califórnia, Ins. Code 1631 e 1633: contravenção, multa de até US$ 50.000 e até um ano. As isenções do 1634 não se encaixam em um fornecedor de software.
- Tennessee, boletim de 8 ago 1985 (comissário John C. Neff): pessoal sem licença **pode** tomar informação factual para proposta, cotar taxas como informação geral, receber pedidos de cobertura para um agente licenciado, marcar compromissos para o agente e ser pago por tempo ou trabalho. **Não pode** aconselhar que cobertura comprar, instar uma companhia, indicar que a cobertura está ou será vigente, vincular ou receber prêmio antes da vinculação, solicitar vendas para o agente, nem ser pago por comissão. Se foi substituído: NV (o tn.gov ainda o hospeda, mas o texto de 56-6-102 é anterior ao licenciamento de produtores).
- O "person" que age é o operador (inferência). Pagar por indicação dependente de venda a quem não tem licença é vedado na Flórida (626.112(8)).
Fontes: https://content.naic.org/sites/default/files/model-law-218.pdf, statutes de TX, FL e CA, e o PDF do Tennessee.

## 9. FTC

A Telemarketing Sales Rule (16 CFR 310) cobre telemarketing por telefone; 310.4(b)(1)(v) proíbe chamada outbound com mensagem pré-gravada sem acordo escrito assinado. A regra final de 2024 (anunciada em 7 mar 2024) diz que ferramentas de soundboard digital e clonagem de voz que criam mensagem pré-gravada estão cobertas e acrescenta guarda de registros. Nenhum texto da TSR diz "AI". Chamada iniciada pelo cliente é isenta (310.6(b)(4) e (5)), salvo upselling. Se a TSR alcança a venda de seguros: NV. A Impersonation Rule (16 CFR 461.3) proíbe se passar falsamente por empresa ou dirigente; a extensão proposta para indivíduos e IA não é definitiva. Ações: Operation AI Comply (25 set 2024), Air AI (processo em 25 ago 2025; ordem proposta em 24 mar 2026, US$ 18 milhões em grande parte suspensos), ordem da Rytr anulada em 22 dez 2025, inquérito 6(b) sobre chatbots de companhia (11 set 2025) e proposta de política de acurácia de IA (FR 7 jul 2026). **Nenhuma ação da FTC contra um chatbot de vendas de IA como tal foi encontrada.**

## 10. Idosos, free look e modelos da NAIC

- O free look é lei estadual. Quadro LI-30 da NAIC (outono de 2023): vida individual costuma ser 10 dias (CT, GA, NY, NC, UT, VA), 15 a 20 em alguns estados (CO 15; ID e ND 20); CA 10127.9 permite 10 a 30. Substituição vai de 10 a 60 dias, 30 o mais comum (CA, TX, UT, VT, CO), TN 20, NY 60. CA 10127.10 exige no mínimo 30 dias para vida individual e anuidades vendidas a maiores de 60. Flórida e Texas para vida individual: NV. **A Priscila nunca diz um número único.**
- Modelo #613 (substituição, texto de 2015): o segurador substituto avisa do direito de devolução de 30 dias; cerca de 40 estados adotaram a versão de 2000 (contagem aproximada do agente). Modelo #275 (melhor interesse em anuidades, 2020) cobre só anuidades; a NAIC diz que 49 jurisdições o implementaram até 8 ago 2025. **Não foi achado modelo da NAIC de adequação para seguro de vida**; a venda de vida se apoia no modelo de práticas desleais (#880) e na lei estadual.
Fontes: https://content.naic.org/sites/default/files/model-law-chart-li-30-life-insurance-disclosure-provisions.pdf, model-law-613.pdf, model-law-275.pdf.

## 11. Outros pontos que um revisor de compliance vai querer

- Gravação de voz: Penal Code 632 da Califórnia exige consentimento de todas as partes para gravar chamada confidencial; 637.2 dá US$ 5.000 por violação.
- Preempção: a ordem executiva 14365 (11 dez 2025) manda uma força-tarefa do DOJ contra leis estaduais de IA e um processo no FCC sobre um padrão federal de divulgação de IA (docket não encontrado).
- NPRM FCC 24-84 (adotada em 7 ago 2024) propõe divulgação de IA no consentimento e no início da chamada; **nenhuma regra final encontrada** (NV).

## O que isto significa para o produto

| Lacuna | Onde resolver |
|---|---|
| Consentimento por escrito com vendedor nomeado e aviso de voz artificial | Formulário de captura e CRM (Billion CRM: o `consent_given` é de voz TCPA; WhatsApp exige `consent_records`) |
| Janela 8h às 20h local, 3 tentativas em 24 h, domingo no Texas | Orquestrador de contato (ainda não existe no CRM; ver `docs/operations/PRISCILA_BILLION_INTEGRATION.md`) |
| "Pare" global em qualquer canal | CRM e Priscila; o texto da Priscila já aceita opt-out imediato |
| Aviso de IA e proibição de se passar por pessoa | Doutrina e **sentinela** (regra `li_claims_human`, adicionada em 2026-10-17) |
| Não comparar anuidade a CD | Pacote de conhecimento e **sentinela** (regra `li_cd_comparison`) |
| Revisão jurídica do aviso de IA e da regra de gravação | Decisão humana, advogado |

## Itens que dependem de advogado

Se a sessão de vídeo no navegador é "telephone call"; se o Idaho S 1297 alcança a Priscila; se Utah exige divulgação proativa de produtor de seguros; texto final e data de vigência do FCC 26-67; leis de Texas (TRAIGA) e Washington; regime de gravação por estado; cláusulas que uma seguradora contratante exigiria pelo boletim da NAIC.
