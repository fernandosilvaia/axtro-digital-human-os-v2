# OBSERVABILITY.md

> Status: PROPOSTO. Stack: OpenTelemetry (traces+métricas) → Grafana Cloud; Sentry (erros); logs estruturados JSON → Grafana Loki. Correlação universal: `tenant_id · agent_id · session_id · lead_id · opportunity_id · trace_id` presentes em todo log/métrica/evento onde aplicável.

## 1. Três planos de medição
**Técnico** (a máquina funciona?) · **Humano** (soa humano?) · **Comercial** (vende?). Um release só é saudável se os três estiverem verdes — dashboards separados, mesma fonte.

## 2. Métricas técnicas (SLIs) e SLOs iniciais
| Métrica | Definição | SLO (F1) |
|---|---|---|
| `rt.eot_to_first_audio_ms` | fim de fala do lead → 1º byte de áudio do agente | p50 ≤ 800ms · p95 ≤ 1500ms |
| `rt.interrupt_stop_ms` | lead começa a falar → agente silencia | p95 ≤ 250ms |
| `rt.stt_latency_ms` / `rt.llm_ttft_ms` / `rt.tts_ttfb_ms` | por estágio do pipeline | budget por estágio (REALTIME §5) |
| `rt.provider_fallback_count` | fallbacks acionados por sessão/provider | alerta se >2% sessões/h |
| `session.setup_time_ms` | criação → sala pronta | p95 ≤ 3s |
| `session.drop_rate` | sessões terminadas por erro técnico | < 1% |
| `tool.exec_latency_ms` / `tool.error_rate` | por tool | p95 ≤ 2s · erro < 2% |
| `api.availability` | uptime API | 99,9% |
| `axtro.briefing_ready_rate` | % sessões que iniciaram com briefing pronto | ≥ 90% (informativo, não bloqueia) |
| `cost.minute_usd` | custo real por minuto de conversa (soma providers) | acompanhar vs UNIT_ECONOMICS |

## 3. Métricas humanas (qualidade de conversa)
Calculadas pós-call (jobs) sobre transcript+áudio; amostragem 100% no F1.
| Métrica | Como medir | Alvo |
|---|---|---|
| `talk_ratio_lead` | % de tempo de fala do lead | 55–65% (Método Silva: lead fala 60%) |
| `interruption_rate` | interrupções do agente sobre o lead /10min | < 1 |
| `avg_response_gap_ms` | silêncio médio entre turnos | 400–900ms |
| `question_statement_ratio` (descoberta) | perguntas/afirmações na fase de descoberta | ~70/30 |
| `latency_complaints` | lead diz "alô?", "tá aí?" | < 2% das sessões |
| `naturalness_score` | rubrica LLM-judge 1-5 (prosódia via proxy de texto+timing) | ≥ 4,0 média |
| `robotic_markers` | detecção de padrões proibidos (HUMANLIKE §7) | 0 críticos |

## 4. Métricas comerciais (15 KPIs do Head + funil)
Espelham o painel do Head Comercial do Método Silva, agora medidos automaticamente: contatos efetivos/agente/dia · agendamentos/semana · **show rate ≥70%** · taxa de qualificação SILVA ≥60% · tempo de resposta inbound <5min · propostas enviadas · taxa de fechamento · ticket médio · ciclo de venda · pipeline coverage 3x · CRM atualizado ≤48h (aqui: 100% automático) · custo por reunião realizada · custo por oportunidade · receita influenciada por IA · % handoffs aceitos pelo time humano. Cada KPI tem card no dashboard com meta configurável por tenant e comparação vs baseline humano do próprio tenant (quando informado).

## 5. Traces
Trace por sessão com spans: `session.create → room.join → turn[n]{stt, classify, retrieve, llm, guard, tts} → tool.exec → handoff → postcall.jobs`. Turnos são spans filhos repetidos — permite ver exatamente qual estágio estourou o budget em qualquer turno de qualquer call. Sampling: 100% de sessões com erro/fallback/latência acima de p95; 20% das demais (F1), reavaliar custo.

## 6. Logs
JSON estruturado, um evento por linha, chaves fixas (`ts, level, svc, tenant_id, session_id, trace_id, msg, data`). PII minimizada (SECURITY §6). Retenção 30d hot / 12m cold.

## 7. Alertas (PagerDuty-like via Grafana OnCall — F1 usa Slack/Telegram do fundador)
P1 (acorda alguém): API down · drop_rate >5% em 10min · fallback total de um estágio (ex.: TTS primário+fallback caindo) · isolamento de tenant violado (teste canário) · custo/min > 3x esperado. P2 (horário comercial): SLO de latência estourado 1h · tool error >5% · show rate caindo >20% semana/semana em tenant grande. Todo alerta linka runbook (playbooks/).

## 8. Dashboards mínimos (F1)
1. **Sala de máquinas** (técnico realtime) · 2. **Qualidade de conversa** (humano) · 3. **Comercial por tenant** (15 KPIs) · 4. **Custos por provider/minuto** · 5. **Axtro Agent** (jobs, briefings, sugestões aceitas).
