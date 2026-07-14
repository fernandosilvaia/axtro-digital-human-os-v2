# ADR-015 — Deploy: Vercel (web) + Fly.io (API e workers, região gru) + Supabase + Upstash
**Status:** Aceito · 2026-07-13
**Contexto:** 1 desenvolvedor; caminho realtime precisa rodar perto do lead (Brasil) e perto do LiveKit; k8s é custo cognitivo indevido agora.
**Decisão:** Vercel para os 3 fronts Next.js; Fly.io região `gru` para api (NestJS) e realtime-worker/axtro-supervisor (máquinas dedicadas, autoscale por sessões ativas, `fly deploy` imutável); Supabase região SP (DB/Auth/Storage); Upstash Redis (streams+cache); Doppler p/ segredos; GitHub Actions CI/CD com ambientes dev/staging/prod. Saída documentada: containers são portáveis (Docker) — migrar para AWS/GCP se compliance enterprise exigir (F6).
**Alternativas rejeitadas:** AWS completo já (semanas de setup, IAM etc.); Railway/Render p/ workers realtime (menos controle de região/máquina); k8s (ADR D-17).
**Consequências:** + deploy em minutos, custo inicial baixo, latência BR ok. − multi-região fica manual; limites de Fly p/ workloads longos monitorados (sessões >1h são raras em vendas).
