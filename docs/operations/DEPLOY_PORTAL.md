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

## Pós-deploy obrigatório (dashboard do Supabase) — AINDA PENDENTE

1. **Auth > URL Configuration**: definir `Site URL` para o domínio público do
   Railway e adicionar `https://<dominio>/auth/callback` em Redirect URLs —
   sem isso, links de confirmação/recuperação apontam para localhost.
2. **Auth > SMTP**: configurar SMTP próprio (Resend/Postmark/SES). O builtin
   estourou rate limit nos testes de 2026-07-16; signup e recuperação de senha
   não funcionam de forma confiável sem isso.
3. **Authentication > Hooks**: habilitar `custom_access_token_hook`
   (pré-requisito da fase RLS-por-claim, D-V2-057).

## Checklist final antes de divulgar a URL

- [ ] `/login`, `/signup`, `/recuperar-senha` respondem no domínio público
- [ ] Signup real recebe e-mail de confirmação (exige SMTP próprio)
- [ ] Login → dashboard com tenant provisionado
- [ ] `robots` segue `noindex` (portal é app logado; landing pública é outro projeto)
- [ ] Advisors do Supabase sem achados críticos
