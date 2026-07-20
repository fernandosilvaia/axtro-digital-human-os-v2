# ADR-035: Percepção emocional profunda como capacidade central

**Status:** aceito (2026-07-19, decisão do dono do produto) · **Relacionados:** ADR-034, D-V2-074, D-V2-075 · **Emenda constitucional:** Art. 4

## Contexto

O Art. 4 original ("Percepção é evidência, não verdade") proibia "emoção
tratada como fato", e o cérebro Método Silva (D-V2-073/074) herdou essa
postura: as agentes recebiam sinais visuais mas eram instruídas a nunca
afirmar leitura de emoção. Fernando Silva, dono do produto, decidiu
explicitamente o contrário: a leitura emocional e comportamental — corpo,
micro-expressões faciais, tom — deve ser uma capacidade CENTRAL da closer
digital, o que a torna "mestre em entender o cliente pelas expressões e
palavras", decidindo o que perguntar e o que responder a partir disso.

Isso é o que um closer humano de elite faz: lê a sala, percebe hesitação,
nota o desconforto antes da objeção verbal, e adapta. O Método Silva chama
isso de inteligência emocional ("Lead nervoso → baixa o ritmo. Defensivo →
dá espaço. Disperso → chama pro ponto principal") e a plataforma deve
executá-lo com maestria, não com timidez.

## Decisão

1. **Art. 4 reescrito** (ver Constituição): percepção emocional e
   comportamental profunda é capacidade central. O agente lê expressões
   faciais, micro-expressões, linguagem corporal, tom e comportamento, forma
   leituras emocionais e AGE sobre elas em tempo real — incluindo nomeá-las
   com tato quando servir à conversa ("sinto que esse ponto te preocupou").
2. **O que permanece proibido** (não conflita com o desejo do produto e
   protege juridicamente a operação): identificação biométrica oculta
   (faceprint/voiceprint para identificar pessoas), inferência de atributos
   protegidos (raça, religião, orientação, saúde, opinião política),
   alegação de detecção de mentira e diagnóstico médico/psicológico.
3. **Transparência em vez de silêncio**: a leitura emocional é coberta pelo
   disclosure de IA (Art. 6) e pelas finalidades de consentimento (Art. 5 —
   "análise comportamental" e "análise visual" continuam finalidades
   distintas, aplicadas por jurisdição). O que era "inferência silenciosa
   proibida" vira "inferência declarada e governada".
4. **Engenharia mantida**: sinais continuam carregando evidência, confiança,
   detector versionado e validade (`observed_at`/`expires_at`) — isso é
   qualidade de dado, não freio de produto. A leitura pode ser tratada como
   leitura profissional confiável na conversa.
5. **Implementação imediata**: `ambient_awareness_queries` das personas
   passam a cobrir micro-expressões, linguagem corporal e estado emocional;
   o cérebro instrui maestria de leitura e adaptação (ritmo, profundidade,
   momento do fechamento) e uso empático da leitura na própria fala.

## Consequências

- A validação jurídica por jurisdição (DPIA, EU AI Act para mercados
  europeus, LGPD para dado biométrico/comportamental) continua listada em
  `PENDENCIAS_EXTERNAS.md` e ganha relevância — a capacidade agora existe e
  precisa dessa cobertura antes de mercados regulados.
- Os testes que afirmavam "nunca ler emoção" foram substituídos por testes
  que garantem a presença da capacidade E a permanência das quatro
  proibições do item 2.
