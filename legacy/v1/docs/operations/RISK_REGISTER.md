# RISK_REGISTER.md

> Status: VIVO — revisar quinzenalmente e a cada mudança de fase. Score = Impacto(1-5) × Probabilidade(1-5). Dono default: fundador (solo) — coluna mantida para quando houver time.

| ID | Risco | I | P | Score | Mitigação | Gatilho de ação | Status |
|---|---|---|---|---|---|---|---|
| R01 | Latência real acima do aceitável em rede BR (4G, wifi ruim) — conversa "trava" | 5 | 4 | 20 | Budgets por estágio + streaming ponta a ponta + fillers/backchannels mascarando + região SP + hedging LLM | latency_complaints >2% | Aberto |
| R02 | Custo por minuto (avatar) inviabiliza margem nos planos | 4 | 4 | 16 | Avatar só F2; voz-only default; planilha UNIT_ECONOMICS com cenários; negociar Tavus com volume | custo/min >40% projetado 2 sem | Aberto |
| R03 | Dependência Tavus (lock-in réplicas, preço, estabilidade) | 4 | 3 | 12 | Interface AvatarProvider; manter mídia-fonte p/ retreinar; avaliar HeyGen se ≥3 incidentes/mês | incidentes/preço | Aberto |
| R04 | Alucinação comercial (preço/promessa falsa) gera dano a tenant | 5 | 3 | 15 | Catálogo como fonte única; validador numérico; commitments auditados; G3 adversarial | 1 incidente real | Aberto |
| R05 | Vazamento cross-tenant | 5 | 2 | 10 | RLS 100% + testes bloqueantes + partição pgvector | teste canário falhar | Aberto |
| R06 | Regulação de IA/telemarketing muda regras de disclosure/outbound | 3 | 4 | 12 | Disclosure já default; monitorar PL 2338; outbound frio fora do MVP | sanção do marco | Aberto |
| R07 | Fundador solo = bus factor 1 e ritmo | 4 | 4 | 16 | Docs-first (este repo); Claude Code como par; escopo MVP duro; automação de ops | atraso >30% em F1 | Aberto |
| R08 | Mercado: incumbentes (Zoom/Google) embutem vendedor IA nativo | 4 | 2 | 8 | Diferencial = metodologia BR + white-label + handoff quente; velocidade | anúncio de incumbente | Aberto |
| R09 | Qualidade de voz PT-BR dos providers regride/oscila | 3 | 3 | 9 | Dois TTS com voz clonada em ambos; evals de pronúncia; glossário | naturalness <3,5 | Aberto |
| R10 | Churn por show rate baixo (leads não aparecem p/ IA) | 4 | 3 | 12 | Confirmações multicanal automáticas; remarketing de no-show; medir vs baseline humano do tenant | show <50% num tenant | Aberto |
| R11 | Abuso da plataforma por tenant (spam, setor proibido) | 4 | 2 | 8 | AUP + classificação de setor + kill switch + limites por plano | denúncia/detecção | Aberto |
| R12 | Supabase/LiveKit outage regional | 4 | 2 | 8 | Status pages monitoradas; degradação graciosa (agendar retorno); PITR; game days | incidente | Aberto |
| R13 | Estimativas de preço de providers desatualizam (cotação 2026-07-13) | 2 | 5 | 10 | Datas registradas em todos docs; recheck obrigatório na PENDENCIAS antes de cada contrato | contratação | Aberto |
| R14 | Handoff quente falha (humano não atende) e lead esfria | 3 | 3 | 9 | Fallback automático: agendar reunião + resumo por WhatsApp/e-mail; SLA de aceite monitorado | aceite <70% | Aberto |
| R15 | Axtro Agent (Hermes) instável contamina operação | 3 | 2 | 6 | Fora do caminho crítico por design; kill switch; políticas locais de fallback | jobs falhando >10% | Aberto |
