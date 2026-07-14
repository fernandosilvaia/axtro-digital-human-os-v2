# ADR-014 — Observabilidade: OpenTelemetry + Grafana Cloud + Sentry, com 3 planos de medição
**Status:** Aceito · 2026-07-13
**Contexto:** Debugar latência de conversa exige trace por turno; o negócio exige métricas comerciais (15 KPIs do Head); qualidade exige métricas "humanas". Uma stack só, correlacionada.
**Decisão:** OTel SDK em TS e Py com spans padronizados por turno/estágio; métricas nomeadas conforme OBSERVABILITY; Grafana Cloud (métricas+traces+Loki logs) e Sentry para erros; correlação universal por 6 chaves; sampling 100% em anomalias. Dashboards mínimos definidos (5).
**Alternativas rejeitadas:** Datadog (custo cresce agressivo com volume de spans de voz); "printf + Sentry" (impossível achar estouro de budget por estágio); ferramenta APM de LLM dedicada agora (Langfuse etc. — reavaliar F3 como complemento para evals, não substituto).
**Consequências:** + um lugar para técnico/humano/comercial; custo controlável. − instrumentação é trabalho contínuo exigido no DoD (item 4).
