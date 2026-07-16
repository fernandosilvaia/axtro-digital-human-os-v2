# Deploy do portal (`apps/portal`) no Railway

**Estado:** configuração pronta; criação do projeto Railway e primeiro deploy
dependem de autorização explícita do Fernando (gate de infra real).

## O que já está pronto no repo

- `railway.json` na raiz: build via Nixpacks com
  `pnpm install --frozen-lockfile && pnpm run build && pnpm --filter @axtro/portal run build`
  (o portal importa `@axtro/domain` do workspace, então o `tsc --build` da raiz
  precisa rodar antes do `next build`), start com
  `pnpm --filter @axtro/portal run start`, healthcheck em `/login`.
- `apps/portal` lê `PORT` automaticamente (`next start` respeita a env do Railway).

## Passos do deploy (uma vez autorizado)

1. Criar o projeto no Railway (conta já logada no CLI local):
   ```bash
   railway init --name axtro-digital-human-os
   ```
2. Variáveis do serviço (nenhuma é secreta — a publishable key é pública por design):
   ```bash
   railway variables --set NEXT_PUBLIC_SUPABASE_URL=https://ovctadcrvnfpgxzplupp.supabase.co \
     --set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_lfrcFSCsRuHqUiSP7AYhNA_iR5H6iXk \
     --set NIXPACKS_NODE_VERSION=24
   ```
   (`NIXPACKS_NODE_VERSION=24` cobre o requisito `engines.node >=24 <27` do
   monorepo caso o builder não honre a faixa do `package.json`.)
3. Primeiro deploy: `railway up` (ou conectar o repo GitHub no dashboard para
   auto-deploy da `main`, como o Control Tower faz).
4. Gerar o domínio público: `railway domain`.

## Pós-deploy obrigatório (dashboard do Supabase)

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
