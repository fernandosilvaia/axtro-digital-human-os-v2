# HANDOFF: estado operável e como assumir

## O que está NO AR agora

- **Portal:** https://closer.axtroai.com (domínio próprio conectado desde 2026-08-01,
  D-V2-097; deploy automático da `main`). A raw URL `portal-production-b43e.up.railway.app`
  continua servindo em paralelo como fallback, mas não é mais a URL canônica.
- **Agentes de vídeo (Tavus, ao vivo, confirmado no banco em 2026-09-18):** Raissa
  `pa2dcc2d9c3e` (institucional, pt, assumiu o papel que era da Aurora),
  Rafaela `p8966676f4d2` (Closer Solar Residencial, pt), Amanda `pe468ba01ef5`
  (Ecoloop Solar, en), Camila `p57e931a8664` (Axtro Closer, pt), Marina
  `p243348ebb20` (Pré-vendas e Qualificação, pt), Sofia `p6f9cfb4817e` (Life
  Insurance/Billion Club, en, vertical `life_insurance_qualification`): todas com
  Cérebro Método Silva, percepção emocional (ADR-035) e tools de apresentação;
  Raissa/Camila/Marina/Sofia também têm as 3 tools de negócio (`register_lead`,
  `propose_meeting_slots`, `confirm_meeting_slot`) na doutrina do prompt desde
  D-V2-165, mas ainda não registradas na conta Tavus real (`scripts/provision-tavus-business-tools.mjs`
  escrito, não rodado, decisão do Fernando).
- **Conhecimento demo:** 4 fontes da conta + 10 manuais Método Silva (438 chunks RAG).
- **Ledger:** tokens, embeddings e conversas de vídeo registrados por tenant.

## Como operar (conta demo)

1. Login com o usuário demo (credenciais em `apps/portal/.env.local` / Doppler).
2. `/agentes`: criar rascunho, **Ativar/Pausar**, Testar.
3. Na sala de teste: chat (com RAG), "Conversa em vídeo" e "Apresentação ao vivo".
4. `/conhecimento`: criar fonte com conteúdo (ingere na hora), revogar/reativar.
5. `/configuracoes`: perfil do tenant e equipe (convite manda e-mail se `RESEND_API_KEY` setada).

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
- Migration supabase-only nova → escrever, testar no harness local
  (`pnpm db:portal:test`) e registrar na tabela do `database/supabase-only/README.md`
  no mesmo PR. Aplicar no live (`apply_migration`/`execute_sql` via MCP) é um
  passo separado, autorizado explicitamente pelo Fernando por migration, nunca
  automático nem no mesmo commit do código que a acompanha.
- `database/migrations/` continua portátil (nada que referencie `auth.users`).

## Gates que continuam humanos

Bake-off de provider · piloto real M3-10 · DPIA/jurisdição (percepção emocional) ·
Stripe Connect do zero (ADR-040) · credenciais reais Google Calendar/Telnyx ·
WAF da demo pública · prova end-to-end do P0 de media boundary (cancelamento/
barge-in cortando áudio/vídeo a tempo em Tavus/Recall) · religar M6-04
(governança/exclusão/redação de dado, migration 0059 escrita e validada
localmente, não aplicada em produção) · aplicar migration 0059 e as demais
pendentes · rodar `scripts/provision-tavus-business-tools.mjs` contra a conta
Tavus real · upgrade de plano Tavus se créditos esgotarem. Ver
`PROGRESS.md` (bloco "Estado atual" no topo) e `docs/NEEDS_CONNECTION.md`
pra a lista completa e atualizada.
