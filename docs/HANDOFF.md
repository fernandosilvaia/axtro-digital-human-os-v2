# HANDOFF — estado operável e como assumir

## O que está NO AR agora

- **Portal:** https://portal-production-b43e.up.railway.app (deploy automático da `main`).
- **Agentes de vídeo (Tavus, ao vivo):** Aurora `pa2dcc2d9c3e` (institucional, pt),
  Amanda `pe468ba01ef5` (Ecoloop, en), Rafaela `p8966676f4d2` (solar, pt) — todas com
  Cérebro Método Silva, percepção emocional (ADR-035) e tools de apresentação.
- **Conhecimento demo:** 4 fontes da conta + 10 manuais Método Silva (438 chunks RAG).
- **Ledger:** tokens, embeddings e conversas de vídeo registrados por tenant.

## Como operar (conta demo)

1. Login com o usuário demo (credenciais em `apps/portal/.env.local` / Doppler).
2. `/agentes` — criar rascunho, **Ativar/Pausar**, Testar.
3. Na sala de teste: chat (com RAG), "Conversa em vídeo" e "Apresentação ao vivo".
4. `/conhecimento` — criar fonte com conteúdo (ingere na hora), revogar/reativar.
5. `/configuracoes` — perfil do tenant e equipe (convite manda e-mail se `RESEND_API_KEY` setada).

## Como desenvolver

```bash
pnpm install --frozen-lockfile
pnpm --filter @axtro/portal run dev        # exige apps/portal/.env.local (modelo em .env.example)
PORTAL_FAKE_PROVIDERS=1 pnpm --filter @axtro/portal run dev   # sem chave nenhuma de provider
```

Testes: `docs/TESTING.md`. Deploy: `docs/DEPLOYMENT.md`. Pendências suas: `docs/NEEDS_CONNECTION.md`.

## Regras do repo que não podem regredir

- Repo público: nada de segredo/IP em commit (`knowledge-vault/` é gitignored).
- Toda decisão não óbvia → `docs/operations/DECISIONS_LOG.md` (D-V2-NNN); mudança
  constitucional → ADR.
- Migration supabase-only nova → aplicar no live no mesmo PR + tabela do README.
- `database/migrations/` continua portátil (nada que referencie `auth.users`).

## Gates que continuam humanos

Bake-off de provider · piloto real M3-10 · DPIA/jurisdição (percepção emocional) ·
planos/preços/billing · upgrade de plano Tavus se créditos esgotarem.
