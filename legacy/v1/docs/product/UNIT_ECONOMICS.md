# UNIT_ECONOMICS.md — leitura executiva da planilha

> Fonte: `spreadsheets/UNIT_ECONOMICS.xlsx` (edite só as células amarelas da aba Premissas). **Todos os preços de providers cotados publicamente em 2026-07-13** — reconferir antes de contratar. Câmbio default R$5,30/US$. Números abaixo = saída da planilha com os inputs default.

## 1. Custo por minuto de conversa (5 cenários)
| Cenário | USD/min | BRL/min | Composição dominante |
|---|---|---|---|
| S1 Voz econômica (pipeline + Cartesia) | 0,0497 | **R$0,26** | LLM+STT |
| S2 Voz premium (pipeline + ElevenLabs) — **default do produto** | 0,0637 | **R$0,34** | TTS 38% |
| S3 Voz S2S (OpenAI Realtime) | 0,1200 | R$0,64 | modelo tudo-em-um |
| S4 Vídeo avatar (S2 + Tavus) | 0,4037 | **R$2,14** | avatar 84% do custo |
| S5 Telefonia (S2 + Telnyx, sem 2º participante LiveKit) | 0,0632 | R$0,34 | idem S2 |

Por interação típica (S2): call de qualificação de 8min ≈ **R$2,70**; reunião de fechamento de 45min ≈ **R$15,19** em voz — e ≈ **R$96,28** se for por vídeo/avatar (S4). Comparação honesta: um SDR humano custa R$25–60 por call de qualificação considerando salário+encargos+ociosidade; a IA em voz custa ~R$3–5 com pós-call incluído. **Em voz, a economia é 10x; em vídeo, a conta só fecha com pricing específico.**

## 2. Planos propostos (inputs default — decisão de pricing em aberto)
| | Starter R$997 | Pro R$2.497 | Scale R$5.997 |
|---|---|---|---|
| Minutos voz / vídeo | 500 / 0 | 1.500 / 200 | 4.000 / 800 |
| Margem bruta | **82,1%** | 61,4% | 47,6% |

**Leitura importante (não maquiar):** com franquias de vídeo generosas, Pro e Scale ficam **abaixo** do alvo de 70%. Três saídas, a decidir na precificação final: (a) vídeo como add-on cobrado por minuto (excedente sugerido pela planilha: **voz R$1,13/min, vídeo R$7,13/min**, já com 70% de margem); (b) franquias de vídeo menores (ex.: 60/240min); (c) preços maiores nos tiers com vídeo. A planilha permite simular os três em segundos.

## 3. Breakeven
Fixos estimados US$900/mês (R$4.770): infra base + observabilidade + ferramentas. Breakeven: **6 clientes Starter, 4 Pro ou 2 Scale** — mix realista: ~3–4 clientes pagantes cobrem a operação técnica do MVP. (Não inclui pró-labore/CAC — modelo de contribuição, não DRE.)

## 4. Sensibilidades que mais importam (testar na planilha)
1. **Fração de fala da IA (SPK, default 40%)** — cada 10pp a mais de fala da IA sobe TTS/avatar proporcionalmente; o Método Silva (lead fala 60%) é também vantagem de custo.
2. **Câmbio** — custo é 100% dolarizado; a R$6,00, S2 vai a R$0,38/min (margens caem ~3–5pp).
3. **Tavus por volume** — plano Growth (US$0,3176/min efetivo dentro da franquia) vs overage; negociar cedo se vídeo tracionar.
4. **S2S** — se o preço do Realtime cair ~50%, S3 empata com S2 premium e a flag vira decisão de qualidade, não de custo (monitorar trimestralmente).

## 5. Regra operacional
`cost.minute_usd` medido em produção (OBSERVABILITY §2) é comparado semanalmente com S2/S4 da planilha; desvio >25% por 2 semanas ⇒ gatilho de replanejamento (ROADMAP §4) e atualização das Premissas com a realidade.
