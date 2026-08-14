# Unit economics e preço — Axtro Digital Human OS (revisto em 2026-08-13)

> Todo número tem fonte e data. Estimativas de mercado/premissas (razão de fala
> do agente, turnos/minuto) são marcadas como tal — nunca apresentadas como
> medição (Art. 16). Ver também `docs/COST_OPTIMIZATION.md` (inventário de
> tetos já implementados) e o rate card já em produção
> (`database/supabase-only/0017_rate_card.sql`, D-V2-078, 2026-07-22).

## 1. O que realmente custa gerar 1 minuto de conversa em vídeo

| Componente | Custo/min | Fonte | Data |
|---|---|---|---|
| Tavus (replica + STT + percepção + orquestração) | US$ 0,32–0,37 (uso: US$ 0,35) | [tavus.io/pricing](https://www.tavus.io/pricing) — Growth US$397/mês/1.250min (US$0,32/min overage), Starter US$59/mês/100min (US$0,37/min overage) | 2026-08-03 |
| ElevenLabs (voz da agente, `eleven_turbo_v2_5`, chave própria) | ~US$ 0,017 | [elevenlabs.io/pricing](https://elevenlabs.io/pricing) US$0,05/1.000 chars (Turbo/Flash) × ~750 chars/min de fala × ~45% do tempo de call com a agente falando (estimativa) | 2026-08-03 |
| OpenRouter (cérebro, Claude Haiku 4.5) | ~US$ 0,014 | Rate card do repo (US$1/US$5 por 1M tokens in/out) × ~5.000 tokens de entrada/turno (prompt de vídeo ~10,4k chars medido + blocos de contexto) × ~2,5 turnos/min (estimativa) | rate card 2026-07-22 |
| **Total — vídeo sob demanda / portal** | **~US$ 0,38/min** (faixa 0,36–0,43) | soma acima | |
| + Recall.ai (reunião externa, `web_4_core` + transcript) | US$ 0,60/h de bot + US$ 0,15/h de transcrição | [Output Media](https://docs.recall.ai/docs/stream-media): `web_4_core` PAYG US$0,60/h; [usage](https://docs.recall.ai/docs/calculating-usage): runtime inclui waiting room. O adapter limita waiting room/no-one-joined a 5min, recording/non-recording a 30min e permission-denied a 1min; a reserva conservadora permanece 40min = US$0,50 | 2026-08-13 |
| **Total — reunião externa (Zoom/Meet/Teams)** | **até US$ 13,40 por conversa de 30min** | topo do vídeo (30 × US$0,43) + reserva Recall de 40min (US$0,50) | |

**Achado real desta análise**: o custo do ElevenLabs não entra em `cost_events`
hoje — é pago com chave própria (`ELEVENLABS_API_KEY`) fora do ledger. A
margem real é um pouco menor do que o painel mostra. Candidato de correção
futura: logar esse custo também (ou aceitar a imprecisão por ser ~4% do
custo total do minuto).

### Custo de uma call de referência (12 minutos)

**~US$ 4,55** (faixa US$ 4,30–5,15) — este é o número mais importante da
análise: **uma conversa de vídeo custa ~10-15× o que custa um e-mail ou
mensagem de LinkedIn** que ferramentas de "AI SDR" tradicionais mandam. A
estrutura de custo deste produto se parece mais com telefonia/API de vídeo
medida (tipo Twilio) do que com SaaS de texto.

## 2. O efeito dos planos mínimos dos providers (importa MUITO em baixo volume)

Tavus e ElevenLabs cobram por PLANO com minutos/créditos incluídos, não por
uso puro desde a primeira unidade. Em baixo volume, o custo EFETIVO por
minuto é muito maior que a tabela acima:

| Cenário | Plano Tavus | Uso real | Custo efetivo/min |
|---|---|---|---|
| 1 piloto testando (20 calls × 12min = 240min/mês) | Growth US$397/mês | 240min | **US$ 1,65/min** |
| 5 clientes ativos (100 calls × 12min = 1.200min/mês) | Growth US$397/mês | 1.200min | US$ 0,33/min |
| 20 clientes ativos (400 calls × 12min = 4.800min/mês) | Growth + overage | 4.800min | ~US$ 0,34/min |

**Implicação prática**: até acumular volume agregado (todos os tenants
somados) perto de ~150–200 min/mês, vale ficar no plano **Starter** do Tavus
(US$59/mês) + Recall/ElevenLabs pay-as-you-go, e só migrar pra Growth
quando o uso real justificar — evita pagar US$397/mês por um punhado de
chamadas de teste durante o piloto controlado.

## 3. Referência de mercado (ferramentas comparáveis, levantado 2026-08-03)

| Categoria | Faixa de preço | Por quê não serve de âncora direta |
|---|---|---|
| AI SDR (texto: e-mail/LinkedIn) — AiSDR, Reply.io Jason, Salesforge | US$250–900/mês entrada, US$1.500–3.000/mês médio | [artisan.co](https://www.artisan.co/blog/how-much-does-an-ai-sdr-cost-pricing-compared-to-human-sdrs), [whitespacesolutions.ai](https://www.whitespacesolutions.ai/content/ai-sdr-pricing-guide-2026) — custo marginal por lead é ~zero (mensagem de texto); o nosso não é |
| AI SDR enterprise — 11x, Artisan | US$1.500–10.000+/mês | mesmos, mas com mais volume/features |
| API de avatar/vídeo pura (sem wrapper SaaS) | US$0,10–0,37/min | [veed.io](https://www.veed.io/learn/best-avatar-apis) — confirma a ordem de grandeza do nosso custo Tavus isolado |

**Leitura**: nosso produto tem diferenciação real (presença em vídeo ao
vivo, leitura comportamental, entra em reunião de verdade) que justifica
preço na faixa média de AI SDR — mas a estrutura de custo NÃO permite
"ilimitado" barato como os concorrentes de texto fazem. Preço tem que
carregar metragem de uso.

## 4. Catálogo vigente: conversas incluídas + overage por conversa

Preço em USD (custos são 100% USD-denominados — evita a margem sangrar com
câmbio; ofereça fatura em BRL como conversão de referência, não como preço
nativo, e com cláusula de reajuste cambial se faturar em BRL).

Desde D-V2-101, a unidade faturável implementada é **conversa**, não minuto:
o sistema ainda não reconcilia duração real com invoice. O adapter Tavus fecha
cada conversa em no máximo 30 minutos; por isso o preço flat do overage precisa
suportar o pior caso inteiro, inclusive reunião externa.

| Plano | Preço/mês | Conversas incluídas | Overage/conversa | Custo variável modelado a 30min | Margem variável no pior caso |
|---|---|---|---|---|---|---|
| **Piloto** | US$ 497 | 7 | **US$ 30** | até US$ 13,40 | **55,33%** |
| **Crescimento** | US$ 1.497 | 30 | **US$ 30** | até US$ 13,40 | **55,33%** |
| **Escala** | US$ 3.997 | 85 | **US$ 30** | até US$ 13,40 | **55,33%** |

Reunião externa (Recall) conta no mesmo pool — ela é usada como cenário
conservador: topo da faixa total documentada de US$0,43/min mais a reserva
Recall `web_4_core` + transcript inteira de 40 minutos (US$0,50), mesmo que
a conversa Tavus termine em 30 minutos. A conta versionada em
`apps/portal/src/lib/billing/plans.ts` é:

`(US$30 - (30 × US$0,43 + US$0,50)) ÷ US$30 = 55,33%`.

Uma sala Tavus começa a gerar custo antes de existir prova de entrega humana.
M5-01 limita essa exposição a três efeitos no total entre `held` e efeitos
despachados sem ativação por tenant/período; a transição de um estado ao outro
não reabre uma vaga. No pior envelope de 30 minutos, isso limita o custo
modelado não faturável a `3 × US$11,10 = US$33,30` por
período, sem consumir o orçamento de conversas ativadas nem bloquear overage
legítimo. É um guardrail de custo estimado; a tarifa real ainda deve ser
reconciliada com a fatura Tavus.

**Por que o preço anterior foi corrigido**: os valores de US$14/US$12/US$10
por conversa só preservavam margem numa chamada média de 12 minutos. No teto
real de 30 minutos, o plano Escala teria margem variável negativa. O preço
único de US$30 mantém pelo menos 55% em todas as combinações testadas de
plano × superfície × duração suportada.

Esta é margem **modelada**, não invoice-grade. Não inclui impostos, taxas de
pagamento, Railway/Supabase, suporte, capacidade ociosa dos planos mínimos nem
desconto negociado. O gate de Stripe live continua humano: antes de ativar,
os três Prices metered precisam ser recriados/atualizados e seus IDs revistos.

**Referência — o que um flat ilimitado exigiria**: se algum dia quiser
oferecer "ilimitado" (linguagem de marketing), o teto de uso justo tem que
ficar perto de `preço ÷ US$0,38`. Num plano de US$497/mês isso é ~1.300
min/mês (~109 calls) — acima disso a conta vira prejuízo.

## 5. Enquadramento por valor (para a conversa comercial, não só custo)

Um plano Crescimento (US$1.497/mês, 30 conversas) custa menos que UM SDR
júnior por semana. Se o ticket médio do cliente for de alguns milhares de
dólares por venda fechada, uma única venda influenciada já paga o plano do
ano inteiro — é o mesmo enquadramento que a HubSpot usou ao lançar preço
por lead qualificado (~US$1/lead) em vez de por assento.

## 6. O que este documento NÃO tem (honestidade estrutural, Art. 16)

- **CAC e LTV reais**: não existe cliente pagante ainda — qualquer número
  aqui seria inventado. Framework para quando houver dados: meta LTV:CAC
  ≥ 3:1, payback ajustado à margem bruta < 12 meses. Revisitar depois dos
  primeiros 3–5 clientes do piloto.
- **Taxa negociada com providers**: os preços acima são de tabela pública
  (list price), igual ao rate card já em produção — a taxa negociada real
  (se/quando houver volume pra negociar) deixa a margem melhor do que aqui.
- **Custo de infra fixa** (Railway, Supabase, domínio): baixo e não medido
  isoladamente nesta análise — soma poucas centenas de dólares/mês no
  estágio atual, imaterial frente aos planos de provider de IA.

## 7. Próximos passos sugeridos

1. Reprovisionar os Prices metered de teste para **US$30/conversa**, validar
   lookup keys e só então promover IDs novos. Stripe live permanece gate
   humano (ver `docs/NEEDS_CONNECTION.md`).
2. Manter Tavus no plano Starter até o uso agregado passar de ~150min/mês;
   migrar pra Growth quando compensar.
3. Considerar logar o custo do ElevenLabs em `cost_events` pra o painel de
   custo refletir a margem real, não só Tavus+OpenRouter.
4. Depois dos primeiros clientes pagantes, substituir as estimativas de
   "turnos/minuto" e "razão de fala do agente" por números medidos reais.
