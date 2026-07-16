# Deploy do portal (`apps/portal`) no Railway

**Estado: NO AR desde 2026-07-16.**
Projeto Railway `axtro-digital-human-os` (workspace fpxcorpdigital, id
`5c4d7de2-77fe-4727-957f-8e4c4868fa96`), serviço `portal`, URL pública
**https://portal-production-b43e.up.railway.app** — login real testado em
produção (usuário de teste criado, logou, tenant provisionado, removido).

## Configuração que ficou valendo (aprendida em 3 builds quebrados)

- **Builder: Railpack** (`railway.json`), não Nixpacks — o corepack 0.24.1 do
  Nixpacks quebra ao carregar o pnpm no Node 24.10
  (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`).
- **`railpack.json` com `provider: node` explícito** — sem ele, o Railpack
  detecta o repo como Python (por causa do `pyproject.toml`/`uv.lock` na raiz)
  e nunca instala o pnpm. A env `RAILPACK_PROVIDERS=node` sozinha não bastou.
- **`allowBuilds: sharp: true` no `pnpm-workspace.yaml`** — o pnpm 11 em CI
  falha o install com `ERR_PNPM_IGNORED_BUILDS` para build scripts não
  aprovados (localmente é só warning).
- Build: `pnpm install --frozen-lockfile && pnpm run build && pnpm --filter @axtro/portal run build`
  (o portal importa `@axtro/domain` do workspace, então o `tsc --build` da
  raiz precisa rodar antes do `next build`). Start:
  `pnpm --filter @axtro/portal run start`, healthcheck em `/login`.
- Variáveis do serviço (nenhuma é secreta — a publishable key é pública por
  design): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `RAILPACK_PROVIDERS=node`, `NIXPACKS_NODE_VERSION=24` (residual, inofensiva).

## Deploys seguintes

`railway up --service portal` a partir da raiz do repo (CLI já logada), ou
conectar o repo GitHub no dashboard para auto-deploy da `main`, como o
Control Tower faz (recomendado como próximo passo).

## Pós-deploy obrigatório — CONCLUÍDO 2026-07-16 (D-V2-063)

1. ✅ **URL Configuration** (feito pelo Fernando no dashboard): Site URL =
   domínio público do Railway + redirect `/auth/callback`.
2. ✅ **SMTP próprio** (aplicado via Management API, D-V2-063):
   smtp.resend.com:465, user `resend`, remetente `no-reply@axtroai.com`
   (domínio verificado no Resend), rate limit 30/h. Chave vive no Doppler
   (`axtro-human-digital-os`, configs dev/prd, `RESEND_API_KEY`).
3. ✅ **Custom Access Token Hook** habilitado
   (`pg-functions://postgres/public/custom_access_token_hook`) — JWT testado
   com claims de tenant; login sem membership continua funcionando.

## Checklist final antes de divulgar a URL

- [x] `/login`, `/signup`, `/recuperar-senha` respondem no domínio público (2026-07-16)
- [x] Signup real envia e-mail de confirmação via Resend (testado 2026-07-16 — envio visto no painel do Resend)
- [x] Login → dashboard com tenant provisionado (testado em produção 2026-07-16)
- [x] `robots` segue `noindex` (portal é app logado; landing pública é outro projeto)
- [x] Advisors do Supabase sem achados críticos (última checagem 2026-07-16)
