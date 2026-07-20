# NEEDS_CONNECTION — o que depende só de você

Tudo abaixo já tem código, adapter, mock e teste prontos. Falta apenas a conexão indicada.

| Serviço | Variável ou ação necessária | Onde conectar | Status |
|---|---|---|---|
| Resend (e-mail de convite) | `RESEND_API_KEY` (existe no Doppler `axtro-human-digital-os`) | Railway → serviço do portal → Variables | aguardando variável em produção (local já configurado) |
| Portal URL nos e-mails | `PORTAL_PUBLIC_URL` (ou aceitar o default atual) | Railway → Variables | opcional |
| Telefonia (Telnyx) | Conta + `TELNYX_API_KEY` + número SIP | PENDENCIAS_EXTERNAS · sem adapter ainda (T10) | aguardando conta |
| Meet/Zoom/Teams (Recall.ai) | Conta + `RECALL_API_KEY` | PENDENCIAS_EXTERNAS · sem adapter ainda (T11) | aguardando conta |
| Billing (Stripe) | Decisão de planos/preços + conta Stripe | PENDENCIAS_EXTERNAS (decisão comercial) | aguardando decisão |
| Telemetria (Sentry ou log drain dedicado) | Decisão de vendor + DSN/credencial | `apps/portal/src/lib/telemetry.ts` já centraliza e redige todo log — só falta o wiring do vendor escolhido | aguardando decisão (logs estruturados do Railway já funcionam como observabilidade mínima) |
| Rate card de custos | Preços reais por unidade (OpenRouter/Tavus/embeddings) | `cost_events.unit_cost` via migration supabase-only | aguardando números |
| DPIA / parecer jurídico | Contratar avaliação por jurisdição (percepção emocional, ADR-035) | PENDENCIAS_EXTERNAS "Jurídico" | bloqueante p/ mercados regulados |
| Upgrade plano Tavus | Se os créditos conversacionais esgotarem de novo (D-V2-067) | dashboard Tavus | funcionando hoje |
| **Deploy manual do portal** | `railway up --service portal` (ou conectar GitHub→Railway para auto-deploy real) | terminal, raiz do repo | **bloqueante**: o Railway NÃO tem auto-deploy da `main` configurado — o deploy ativo (`f43c610c`, 2026-07-19) é anterior aos PRs #16-#20 desta sessão (cérebro, percepção emocional, ativação de agente, e-mail, mock mode, telemetria). Tudo mergeado no GitHub, nada disso está em produção ainda. Ação de deploy bloqueada pelo classificador de permissões — aguardando autorização explícita |

Já conectados e funcionando: Supabase (auth+dados+RAG), OpenRouter (chat+embeddings), Tavus (vídeo por persona), ElevenLabs (voz via persona), Resend SMTP (e-mails de auth), Railway (deploy da `main`), GitHub (CI).
