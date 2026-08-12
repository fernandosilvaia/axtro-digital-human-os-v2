# Unit economics e preço — Axtro Digital Human OS (2026-08-03)

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
| + Recall.ai (só reunião externa, bot-hora) | + US$ 0,0083 | [recall.ai/blog](https://www.recall.ai/blog/new-recall-ai-pricing-for-2026) US$0,50/hora de bot ATIVO (cobra independente de gravação — confirmado em [docs.recall.ai/docs/calculating-usage](https://docs.recall.ai/docs/calculating-usage)), sem taxa de plataforma | 2026-08-03 |
| **Total — reunião externa (Zoom/Meet/Teams)** | **~US$ 0,39/min** | | |

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

## 4. Recomendação: 3 planos com minutos incluídos + overage

Preço em USD (custos são 100% USD-denominados — evita a margem sangrar com
câmbio; ofereça fatura em BRL como conversão de referência, não como preço
nativo, e com cláusula de reajuste cambial se faturar em BRL).

| Plano | Preço/mês | Minutos incluídos | ≈ chamadas de 12min | Overage/min | Margem no incluído | Margem no overage |
|---|---|---|---|---|---|---|
| **Piloto** | US$ 497 | 80 min | ~6–7 | US$ 1,20 | **94%** | 68% |
| **Crescimento** | US$ 1.497 | 350 min | ~29 | US$ 1,00 | **91%** | 62% |
| **Escala** | US$ 3.997 | 1.000 min | ~83 | US$ 0,85 | **90%** | 55% |

Reunião externa (Recall) conta no mesmo pool de minutos — a diferença de
custo (+US$0,008/min) é irrelevante (~2% do preço de overage).

**Por que overage nunca fica no vermelho**: mesmo o cliente mais pesado, que
estoura o plano inteiro em overage, ainda deixa 55–68% de margem. Não existe
risco de "baleia" destruir a economia — ao contrário de um plano flat
ilimitado, onde um único cliente de alto uso pode inverter a margem.

**Referência — o que um flat ilimitado exigiria**: se algum dia quiser
oferecer "ilimitado" (linguagem de marketing), o teto de uso justo tem que
ficar perto de `preço ÷ US$0,38`. Num plano de US$497/mês isso é ~1.300
min/mês (~109 calls) — acima disso a conta vira prejuízo.

## 5. Enquadramento por valor (para a conversa comercial, não só custo)

Um plano Crescimento (US$1.497/mês, 29 conversas) custa menos que UM SDR
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

1. ~~Definir os 3 planos acima (ou ajustar os números) e implementar o
   mecanismo de cobrança~~ — **feito** (D-V2-101, 2026-08-03): os 3 planos
   desta seção (Piloto/Crescimento/Escala) estão implementados em código
   com esses mesmos números, catálogo real provisionado na Stripe em modo
   teste (2026-08-10) e o funil completo (checkout → webhook → tetos →
   overage → alertas de custo) está em produção — falta só configurar as
   env vars da Stripe no Railway (gate humano, ver `docs/NEEDS_CONNECTION.md`)
   pra ativar cobrança de verdade.
2. Manter Tavus no plano Starter até o uso agregado passar de ~150min/mês;
   migrar pra Growth quando compensar.
3. Considerar logar o custo do ElevenLabs em `cost_events` pra o painel de
   custo refletir a margem real, não só Tavus+OpenRouter.
4. Depois dos primeiros clientes pagantes, substituir as estimativas de
   "turnos/minuto" e "razão de fala do agente" por números medidos reais.
