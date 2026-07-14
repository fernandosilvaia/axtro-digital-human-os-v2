# BENCHMARK_STUDY — Mercado de AI Sales Agents (acesso: 2026-07-13)

Estudo solicitado pelo founder: quem teve mais sucesso, o que modelar, onde superar. Fontes web com data de acesso; números de terceiros marcados como "reportado". Paráfrases próprias; verificar valores na contratação.

## 1. Panorama
O mercado se dividiu em três camadas:
1. **Aplicações "digital worker"** (concorrentes diretos): SalesCloser.ai, 11x (Alice/Julian), Artisan (Ava), AiSDR, 1mind (demos ao vivo), Spara e Qualified/Piper (inbound).
2. **Infra de voz** (nossos fornecedores e também concorrência indireta ao white-label): Vapi, Retell, Bland, Synthflow, ElevenLabs Agents, LiveKit, Pipecat/Daily, Telnyx Voice AI, Cartesia Line, Deepgram.
3. **Infra de vídeo conversacional**: Tavus CVI (líder), HeyGen Interactive, Beyond Presence, D-ID.

Tamanho reportado: mercado de AI SDR ~US$4,27B (2025) → ~US$5,22B (2026), CAGR ~21% até 2034 (Fortune Business Insights, via ante-rion, acesso 2026-07-13). Funding de voice AI ~US$2,1B em 2024, 8x vs 2023 (Landbase, acesso 2026-07-13).

**Insight estrutural (2026):** outbound frio em volume perdeu credibilidade (reclamações públicas de qualidade, ban de LinkedIn no caso Artisan); o que está convertendo é **conversa quente ao vivo** — inbound instantâneo, demo interativa, fechamento. A consolidação começou (Piper/Qualified absorvida pela Salesforce; Salesloft comprou Clari). Conclusão: a Axtro deve dominar o **meio/fundo de funil ao vivo** (exatamente a Reunião Silva) e tratar outbound como cadência governada, nunca spam.

## 2. Benchmark direto: SalesCloser.ai
- Fundada 2024 (Vancouver), ligada à Wishpond (TSXV: WISH). Canais: telefone, Zoom e chamadas no navegador; demos com screen-share; 32 idiomas; 24/7; ~200 integrações; SOC 2 Type I (Type II em progresso).
- Preço flat reportado US$990–2.500/mês (página oficial esconde valores). Tração reportada: 150+ clientes, ~US$1,8M ARR run-rate, 2.600+ agentes, 6x ARR YTD.
- Fraquezas documentadas: sinais de confiança fracos (G2 2,7/5 com 3 reviews; Trustpilot 3,4/5 com 44, dominado por reclamações de cobrança/cancelamento), preço opaco, qualidade inconsistente. Análise de terceiros: só compensa vs. per-minute acima de ~12,5 mil min/mês.
- **O que copiar:** posicionamento full-funnel por conversa ao vivo; demo com compartilhamento; multilíngue; discurso "independente de LinkedIn/Gmail" (menos risco de bloqueio).
- **Onde superar:** transparência de preço e billing; qualidade auditável (evals públicos por tenant); sala própria + Meet/Zoom + telefonia numa só plataforma; avatar em vídeo; metodologia explícita (SILVA) em vez de prompt genérico; white-label real; compliance BR (LGPD) de fábrica.

## 3. Quem "deu mais certo" e por quê
| Player | Sinal de sucesso (reportado) | Lição para a Axtro |
|---|---|---|
| **ElevenLabs** | Val. US$3,3B (Série C US$180M, jan/2025); parceria IBM watsonx (mar/2026); sub-100ms; 70+ idiomas | Qualidade de voz é aposta técnica vencedora → usar como provider primário PT-BR, nunca competir em TTS |
| **Vapi** | 62M chamadas/mês, SLA 99,99%, US$0,05/min de orquestração; custo real BYOK ~US$0,23–0,33/min | Orquestração multi-provider vende → nosso Model/Voice Gateway segue esse padrão, mas com camada comercial em cima |
| **11x** | US$50M+ (a16z/Benchmark), ~US$5k/mês, SOC2 II, multicanal voz/e-mail/LinkedIn/SMS/WhatsApp | Enterprise paga por "digital worker" gerenciado; ponto fraco público: conversas de resposta ruins → nosso diferencial é exatamente a conversa |
| **Qualified/Piper → Salesforce** | Absorção pelo incumbente | Inbound instantâneo é a categoria vencedora; incumbentes vão comprar — construir independente de CRM |
| **1mind / Spara** | Demos e inbound ao vivo com boa reputação | Demo interativa (nosso Presentation Engine) é o "wow" que fecha |
| **Tavus** | Líder de CVI; Phoenix-4; preços públicos US$0,32–0,37/min overage; Starter US$59/100min; Growth US$397/1.250min; white-label enterprise (tavus.io/pricing, acesso 2026-07-13) | Comprar avatar, não construir; abstrair para trocar |
| **Bland/Retell/Synthflow** | Volume outbound / compliance / no-code | Referências de latência (~800ms alvo; Bland criticado a 800ms+ percebidos) e de pricing por minuto |
| **Artisan** | YC + HubSpot Ventures; mas ban de ~2 semanas no LinkedIn e reviews "AI slop" | Risco reputacional de automação de canais de terceiros; qualidade > volume |
| **Air.ai** | Notoriedade seguida de reclamações públicas de reembolso | Overpromise mata a categoria; nunca prometer latência/resultado irreal |

## 4. Matriz de diferenciação (critérios objetivos e mensuráveis)
Meta = como mediremos superioridade (EVALUATION_FRAMEWORK). Concorrentes: SC=SalesCloser, 11x, VP=Vapi/Retell (infra), TV=Tavus (infra vídeo).

| Critério | Métrica | Meta Axtro | SC | 11x | VP | TV |
|---|---|---|---|---|---|---|
| Naturalidade de turno | EOT→1º áudio p50 | ≤800ms voz / ≤1.2s vídeo | s/ dado público | s/ dado | ~0,8s típico | ~sub-s |
| Interrupção | stop ≤250ms taxa | ≥95% | — | — | varia | — |
| Metodologia explícita | estado estruturado c/ score | SILVA nativo + 6 plugáveis | não | não | não | não |
| Sala própria + Meet/Zoom + fone + widget | canais na mesma plataforma | 5 canais F3 | 3 | fone/canais outbound | fone | web |
| Avatar em vídeo com apresentação | demo + slides + proposta in-call | F2 | screen-share | não | não | vídeo sem sales engine |
| Handoff quente c/ pacote | cliente não repete | 100% roteiros | parcial | parcial | n/a | n/a |
| Multi-tenant white-label | domínio+branding+isolamento RLS | F4 | parcial | não | por dev | enterprise |
| Governança de tools | risk class+aprovação+audit | 100% execuções | opaco | opaco | por dev | n/a |
| Avaliação contínua | gates de eval bloqueando deploy | obrigatório | não público | não público | não | não |
| Compliance BR | LGPD+identificação IA+consentimento | de fábrica | GDPR em prog. | SOC2 II | varia | enterprise |
| Preço transparente | página pública c/ calculadora | sim | não | não | sim | sim |
| Autonomia pós-call | resumo→CRM→follow-up→coaching | Axtro Agent | parcial | parcial | não | não |

## 5. Posicionamento e pricing recomendados
- **Categoria:** "Sales OS de IA com funcionários digitais" — acima de "AI closer".
- **Cunha de entrada BR:** operações Método Silva (base instalada da marca Fernando Silva) + verticais com templates (imobiliário, educação, serviços, seguros com módulo compliance).
- **Pricing (proposto, validar na planilha):** híbrido transparente — plano base + franquia de minutos + overage por minuto por modalidade (voz < vídeo < meeting-bot < telefone). Publicar preços (contra-posicionamento direto ao "fale com vendas" de SC/11x, seguindo o playbook AiSDR que virou arma de aquisição).
- **Promessas que NÃO faremos:** latência "instantânea", substituição total de humanos, resultados garantidos. Superioridade só afirmada com métrica comparável (tabela acima) medida pelo nosso próprio eval público por tenant.

## 6. Riscos competitivos
Incumbentes (Salesforce/HubSpot) empacotando agentes; ElevenLabs subindo a pilha para "Agents" completos; Tavus lançando camada comercial própria; guerra de preço em voz pura. Mitigação: valor proprietário concentrado em orquestração, estado da venda, tools governadas, memória, avaliação, multi-tenancy e Meeting Gateway (BUILD_VS_BUY.md) — nada disso é commodity.
