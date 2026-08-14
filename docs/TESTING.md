# TESTING — como testar tudo

## Pipeline completa (a mesma do CI)

```bash
pnpm install --frozen-lockfile
pnpm lint                      # boundaries + whitespace
pnpm contracts:check           # drift dos 48 schemas
pnpm typecheck                 # tsc --build dos packages
pnpm test                      # 427+ testes Node + 26 unittest Python
uv run pytest                  # validadores Python
pnpm build
pnpm db:test && pnpm db:rls    # PostgreSQL+pgvector local, RLS negativa
pnpm m1:e2e && pnpm m2:e2e     # walking skeleton + human presence (fakes)
python3 scripts/validate_all.py
```

## Portal (Next.js)

```bash
pnpm --filter @axtro/portal run typecheck
pnpm --filter @axtro/portal run build
```

## E2E de UI logada (Playwright)

Exige `apps/portal/.env.local` com `DEMO_EMAIL`/`DEMO_PASSWORD` (e Supabase).
Roda com `PORTAL_FAKE_PROVIDERS=1` — nenhum provider pago é tocado.

```bash
pnpm --filter @axtro/portal exec playwright install chromium   # uma vez
pnpm --filter @axtro/portal run e2e
```

Cobre: landing, redirect de rota protegida, login demo, dashboard, ativação/pausa
de agente, chat determinístico e apresentação simulada com navegação de deck.
Screenshots e trace ficam em `apps/portal/test-results/` quando algo falha.

## Modo demonstração sem chaves

`PORTAL_FAKE_PROVIDERS=1` no ambiente do portal ativa: chat determinístico
(sem OpenRouter), embeddings fake determinísticos (ingestão/busca funcionam),
apresentação simulada (deck navegável sem Tavus) e e-mail de convite mockado
com log estruturado.

## Smoke test pós-deploy

```bash
curl -s https://portal-production-b43e.up.railway.app/api/health
# esperado: {"ok":true,...,"checks":{"supabase_url":true,"language_provider":true,...}}
```

## Testes do cérebro Método Silva

`tests/portal/metodo-silva-brain.test.mjs` — caps de prompt por adapter,
disclosure sempre presente, maestria emocional (ADR-035) com as 4 proibições,
arco do deck sem números nos slides. Rodam dentro de `pnpm test`.
