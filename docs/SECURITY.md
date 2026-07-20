# SECURITY — resumo operacional

**Canônicos:** `docs/security/SECURITY_ARCHITECTURE.md`, `docs/security/THREAT_MODEL.md`,
`ARCHITECTURE_CONSTITUTION.md` (Arts. 4-9, 15). Este arquivo resume o estado aplicado.

## Aplicado e verificado

- **Autenticação:** Supabase Auth (e-mail+senha, confirmação, recuperação); Custom Access Token Hook injeta `tenant_id`/`actor_id`/`tenant_role` no JWT (D-V2-063).
- **Autorização por papel:** toda RPC `portal_*` valida `auth.uid()` → `user_tenant_memberships`; escrita restrita a `tenant_admin` (criar/ativar agente, fontes, convites, ingestão).
- **Isolamento de tenant:** RLS + force RLS em todas as tabelas tenant-scoped; testes negativos cross-tenant no CI (`pnpm db:rls`); RPCs resolvem o tenant exclusivamente pela membership do chamador.
- **Validação de payload:** limites explícitos em toda RPC (chunks 1..240, 1..4000 chars, embedding 1536 dims, status em enum, e-mail com regex) e em toda server action.
- **Caps de abuso:** teto diário de 500k tokens/tenant (falha fechada), limite de 20 agentes e 50 fontes por tenant, `maxOutputTokens` e timeouts nos adapters.
- **Segredos:** apenas server-side via env; adapters nunca logam chave; `secret_scan.py` no CI; repo público sem nenhum valor sensível (knowledge-vault gitignored).
- **Logs:** estruturados sem PII (e-mail de convite vira hash; erros de provider logam código/status, nunca payload).
- **Egress:** adapters com URL fixa (OpenRouter, Tavus, Resend) e timeout obrigatório.
- **Dados externos como dados:** conteúdo RAG marcado não-confiável; prompt injection coberta por teste no kernel (M3-02).

## Pendências conhecidas (com dono)

- Rate limit por tenant nas RPCs caras (T6 em `TASKS.md`).
- Migração de leituras para RLS-por-claim (D-V2-058).
- Telemetria de produção (decisão pendente).
- DPIA/parecer por jurisdição para percepção emocional (ADR-035) — bloqueante para mercados regulados.
- Webhooks assinados: não há webhooks recebidos hoje; quando Telnyx/Recall entrarem, exigir HMAC (padrão já documentado no adapter de tools Tavus).
