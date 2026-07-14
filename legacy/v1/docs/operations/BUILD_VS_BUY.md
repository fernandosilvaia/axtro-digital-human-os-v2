# BUILD_VS_BUY.md

> Status: DECIDIDO (registrar mudanças via ADR). Critério: construímos o que é **diferencial competitivo ou fronteira de confiança**; compramos o que é **commodity com mercado competitivo**; adiamos o que não bloqueia aprendizado.

## CONSTRUIR (core, nosso IP)
| O quê | Por quê |
|---|---|
| **Sales Intelligence Engine** (SalesSessionState, motor de funil, SILVA, objection handler, NBA) | É O produto. Nenhum concorrente tem metodologia brasileira nativa e auditável; é o que o benchmark mostrou faltar no salescloser.ai e afins |
| **Orquestração de conversa** (turnos, interrupção, contexto 7 camadas, humanização) | Latência e naturalidade são a experiência; terceirizar = virar revenda indiferenciada |
| **Tool Runtime com contratos/risk-class** | Fronteira de confiança; incidentes aqui matam a empresa |
| **Multi-tenancy + RLS + isolamento de conhecimento/memória** | Fronteira de confiança nº 1 |
| **Memória (7 tipos) e RAG comercial** | RAG genérico existe, mas chunking/ranking orientado a venda (preço, objeção, prova social) é diferencial |
| **Evaluation framework + simulated buyers** | É como garantimos qualidade em escala; ninguém vende isso pronto para vendas PT-BR |
| **Meeting Gateway (abstração de canal)** | A abstração é nossa; os bots por trás são comprados |
| **Axtro Agent integration (broker, skills, kill switch)** | Arquitetura proprietária do fundador; é a tese do produto |
| **Model Gateway fino** | 300 linhas que economizam lock-in; gateways prontos (LiteLLM) avaliados e dispensados no realtime por overhead/controle de hedging |

## COMPRAR (commodity)
Avatar (Tavus) · STT (Deepgram) · TTS (ElevenLabs/Cartesia) · LLMs (Anthropic/OpenAI) · Infra realtime (LiveKit) · Meeting bots (Recall.ai) · Telefonia (Telnyx) · Banco/Auth (Supabase) · Observabilidade (Grafana/Sentry) · Billing (Stripe) · Secrets (Doppler). Racional comum: mercados competitivos, preço caindo, qualidade subindo; nosso volume não justifica P&D próprio; interfaces nossas (`AvatarProvider`, `SttProvider`...) preservam poder de troca.

## NÃO FAZER AGORA (adiado com data de revisão)
| O quê | Revisão |
|---|---|
| Modelo de voz/avatar próprio | F6 — só com escala e margem que justifique |
| Fine-tuning de LLM | pós-F3 — prompt+RAG+estado resolvem 90%; FT congela metodologia cedo demais |
| Self-host LiveKit | F5 — quando custo de Cloud > custo de time de infra |
| NATS JetStream | F3 — Redis Streams aguenta o MVP com menos ops |
| Marketplace de metodologias | F6 — precisa de massa de tenants |
| App mobile | sem data — web responsivo cobre |
