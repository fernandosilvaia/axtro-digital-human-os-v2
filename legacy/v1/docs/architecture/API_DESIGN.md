# API_DESIGN — SaaS API (NestJS)

Estilo: REST + JSON, versionada por path `/v1`, OpenAPI gerado no CI, erros RFC 9457 (problem+json). Auth: JWT Supabase (usuários) e service tokens escopados (workers). Todas as rotas exigem tenant (do JWT); rate limit por tenant+IP; idempotency-key aceito em todos os POSTs de efeito.

## Recursos v1 (MVP)
| Método/rota | Descrição | Papéis |
|---|---|---|
| POST /v1/agents · GET/PATCH /v1/agents/:id | CRUD de agente | admin+ |
| POST /v1/agents/:id/versions · POST .../versions/:v/activate | nova versão (gate de eval antes de activate) | admin |
| POST /v1/leads · GET /v1/leads · PATCH /v1/leads/:id | leads + consentimentos | manager+ |
| POST /v1/sessions | cria sessão {channel, agent_id, lead_id?, scheduled_at?} → tokens de sala/telefone | manager+ / api key |
| GET /v1/sessions/:id · GET .../transcript · GET .../state | inspeção | manager+ (gravações: ABAC) |
| POST /v1/sessions/:id/handoff/accept | humano aceita | agent_operator+ |
| POST /v1/knowledge/sources (multipart) · GET .../chunks/preview · POST .../reindex | knowledge | admin |
| GET/PUT /v1/tools/grants | permissões de tools por agente | admin |
| POST /v1/integrations/:provider/connect (OAuth) · DELETE | integrações por tenant | admin |
| GET /v1/analytics/kpis?range= | 15 KPIs do Head + técnicos | viewer+ |
| GET /v1/usage · GET /v1/budgets · PUT /v1/budgets | medição e limites | admin |
| POST /v1/approvals/:id/(approve|reject) | fila de aprovações (tools/experimentos/follow-ups) | manager+ |
| POST /v1/webhooks/test · registro de endpoints do tenant | eventos out | admin |

## Webhooks (in e out)
Entrantes (Telnyx, Stripe, Recall, Google): endpoint por provider, verificação de assinatura + timestamp (janela 5min) + nonce dedup; processamento async. Saintes (para o tenant): assinatura HMAC `X-Axtro-Signature`, retries exponenciais 5x, painel de entregas.

## Convenções
Paginação cursor-based; filtros whitelisted; campos PII retornados conforme papel/ABAC; `trace_id` em toda resposta; deprecações anunciadas ≥90 dias; contratos de payload = JSON Schemas do domínio (mesmos dos workers Python).
