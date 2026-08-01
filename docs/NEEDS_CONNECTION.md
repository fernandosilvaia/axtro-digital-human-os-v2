# NEEDS_CONNECTION — o que depende só de você

Tudo abaixo já tem código, adapter, mock e teste prontos. Falta apenas a conexão indicada.

| Serviço | Variável ou ação necessária | Onde conectar | Status |
|---|---|---|---|
| Resend (e-mail de convite) | ~~`RESEND_API_KEY`~~ **RESOLVIDO 2026-07-31**: configurada no Railway | Railway → Variables | — |
| Portal URL nos e-mails | ~~`PORTAL_PUBLIC_URL`~~ **RESOLVIDO 2026-07-31**: configurada no Railway | Railway → Variables | — |
| Telefonia (Telnyx) | Conta + `TELNYX_API_KEY` + número SIP | PENDENCIAS_EXTERNAS · sem adapter ainda (T10) | aguardando conta |
| Meet/Zoom/Teams (Recall.ai) | ~~Conta + `RECALL_API_KEY`~~ **RESOLVIDO 2026-07-31**: chave do Doppler validada contra a API real (região `us-west-2` confirmada; as outras 3 dão 401), `RECALL_API_KEY`/`RECALL_API_REGION`/`RECALL_WEBHOOK_TOKEN` no Railway, UI no portal | `/agentes/<id>/testar` → "Levar para uma reunião externa" | funcional — falta só o webhook (linha abaixo) |
| **Webhook do Recall.ai** | Cadastrar a URL `https://portal-production-b43e.up.railway.app/api/recall/webhook?token=<RECALL_WEBHOOK_TOKEN>` no dashboard (é config de dashboard/Svix, não tem API) | https://us-west-2.recall.ai/dashboard/webhooks/ | **opcional para testar**: sem ele o agente entra na reunião normalmente; só o status da sessão no nosso banco fica sem atualizar |
| Billing (Stripe) | Decisão de planos/preços + conta Stripe | PENDENCIAS_EXTERNAS (decisão comercial) | aguardando decisão |
| Telemetria (Sentry ou log drain dedicado) | Decisão de vendor + DSN/credencial | `apps/portal/src/lib/telemetry.ts` já centraliza e redige todo log — só falta o wiring do vendor escolhido | aguardando decisão (logs estruturados do Railway já funcionam como observabilidade mínima) |
| Rate card de custos (taxa negociada) | ~~Preços reais por unidade~~ **RESOLVIDO 2026-07-24 com preço público de tabela** (D-V2-078) — se você tiver taxa negociada diferente da lista pública, atualize as constantes em `database/supabase-only/0017_rate_card.sql` | supabase-only 0017 | opcional — funciona com preço público, atualize se tiver taxa negociada |
| DPIA / parecer jurídico | Contratar avaliação por jurisdição (percepção emocional, ADR-035) | PENDENCIAS_EXTERNAS "Jurídico" | bloqueante p/ mercados regulados |
| Upgrade plano Tavus | Se os créditos conversacionais esgotarem de novo (D-V2-067) | dashboard Tavus | funcionando hoje |
| Auto-deploy Railway↔GitHub | Conectar o repo no dashboard do Railway (Settings → Source) | dashboard Railway | recomendado — hoje cada release exige `railway up --service portal` manual (foi o caso desta sessão: 5 PRs mergeados só chegaram à produção depois de deploy manual explícito) |
| **CI roda o e2e (14 specs Playwright)** | Cadastrar 4 secrets no GitHub: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (mesmos valores de `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` do Railway), `DEMO_EMAIL`, `DEMO_PASSWORD` (mesma conta demo usada localmente) | GitHub → repo → Settings → Secrets and variables → Actions | job `e2e-portal` já existe em `.github/workflows/docs-qa.yml` e roda fake providers + login demo real; sem os secrets ele é pulado automaticamente em todo PR/push (nunca falha por ausência de credencial) — D-V2-096 |

Já conectados e funcionando: Supabase (auth+dados+RAG), OpenRouter (chat+embeddings), Tavus (vídeo por persona), ElevenLabs (voz via persona), Resend SMTP (e-mails de auth), Railway (deploy manual da `main`, confirmado 2026-07-22), GitHub (CI).
