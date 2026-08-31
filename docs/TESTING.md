# TESTING — como testar tudo

## Pipeline completa (a mesma do CI)

```bash
pnpm install --frozen-lockfile
pnpm lint                      # boundaries + whitespace
pnpm contracts:check           # drift dos 69 schemas
pnpm typecheck                 # tsc --build dos packages
pnpm test                      # suíte Node completa + unittest Python
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

Exige `apps/portal/.env.local` com
`E2E_TENANT_ADMIN_EMAIL`/`E2E_TENANT_ADMIN_PASSWORD` e Supabase. Essa fixture
representa um cliente autenticado de teste e nunca é usada pela demo pública.
Roda com `PORTAL_FAKE_PROVIDERS=1`; nenhum provider pago é tocado.

```bash
pnpm --filter @axtro/portal exec playwright install chromium   # uma vez
pnpm --filter @axtro/portal run e2e
```

Cobre: landing, redirect de rota protegida, login da fixture, dashboard, ativação/pausa
de agente, chat determinístico e apresentação simulada com navegação de deck.
Screenshots, traces e uploads de artefatos estão desativados. Esses arquivos
podem capturar cookies bearer, estado assinado e conteúdo do tenant. Falhas usam
somente a saída textual content-free do job.

## E2E da demonstração pública isolada

Não usa conta, Supabase ou credencial de provider. A configuração Playwright
injeta apenas um segredo HMAC efêmero de teste e a attestation exata da política
edge. Traces e screenshots também permanecem desativados para não persistir o
estado assinado da simulação.

```bash
pnpm --filter @axtro/portal run e2e:public
```

O gate prova ausência de cookie Supabase, separação entre contextos, estado
bounded, cleanup e bloqueio estrutural de caminhos administrativos ou pagos.

## Providers fake para testes autenticados

`PORTAL_FAKE_PROVIDERS=1` no ambiente de teste autenticado ativa: chat determinístico
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
