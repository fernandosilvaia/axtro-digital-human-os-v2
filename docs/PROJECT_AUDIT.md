# Auditoria do Projeto — Axtro Digital Human OS V2

**Data:** 2026-07-19 · **Auditor:** execução autônoma (Claude) · **Branch:** `main`
Complementa (não substitui) os canônicos: `PROGRESS.md`, `docs/operations/DECISIONS_LOG.md`, `RISCOS_E_PENDENCIAS.md`, `FINAL_AUDIT_REPORT.md`.

## O que JÁ funciona (verificado)

| Área | Estado | Evidência |
|---|---|---|
| Kernel M0-M3 (fake-first) | ✅ completo e verde | 418 testes Node + 26 Python; `pnpm m1:e2e`/`m2:e2e`; FINAL_AUDIT_REPORT |
| Portal — auth real (signup/login/logout/confirmação/recuperação) | ✅ produção | Supabase Auth + SMTP Resend (D-V2-063), Railway no ar |
| Portal — dashboard com métricas + painel Uso de IA | ✅ | D-V2-072, dados reais do cost ledger |
| Portal — agentes (criar draft, listar) | ✅ | D-V2-062 |
| Portal — conhecimento (criar, ingerir, revogar/reativar, re-ingerir) | ✅ RAG real | D-V2-070/071; busca vetorial comprovada |
| Chat de teste com Cérebro Método Silva + RAG | ✅ | D-V2-073; e2e API com resposta E.A.R.C. |
| Vídeo Tavus por persona (Aurora/Amanda/Rafaela) | ✅ ao vivo | D-V2-074; conversa real criada e verificada |
| Modo apresentação (agente controla slides) | ✅ código + persona | D-V2-074; tools anexadas; validação com mic pendente |
| Percepção emocional profunda | ✅ ativa | ADR-035/D-V2-075, aplicada nas 3 personas |
| Equipe (convites por e-mail pré-aprovado, papéis) | ✅ parcial | D-V2-060 — SEM envio de e-mail ao convidado |
| Cost ledger (tokens, embeddings, conversas de vídeo) | ✅ | D-V2-064/071/072 |
| CI (lint, typecheck, testes, deps, RLS local, docs) | ✅ parcial | `.github/workflows/docs-qa.yml` — NÃO builda o portal |

## Incompleto / quebrado (ordem de prioridade)

1. **Ativação de agente indisponível no portal** — Bruno e Marina presos em `draft`; a UI diz "ativação é liberada quando os provedores forem conectados", mas OpenRouter + Tavus + RAG JÁ estão conectados. Falta RPC de ativação com guardas (disclosure profile + pelo menos o provider de texto ativo) e botão na UI. *Fluxo visivelmente interrompido para o operador.*
2. **Convite de equipe não notifica o convidado** — SMTP próprio existe; falta enviar o e-mail no ato do convite (risco 3b documentado como "trabalho natural de continuação").
3. **CI não builda o portal** — regressões de build do Next só aparecem no deploy Railway. Falta job `pnpm --filter @axtro/portal run build` (+ typecheck).
4. **Sem modo mock dos providers no portal** — sem OPENROUTER/TAVUS key o chat/vídeo respondem erro amigável, mas não há fallback determinístico para testar fluxos completos sem chave (o kernel tem fakes; o portal não).
5. **Sem e2e de UI logada** — nenhum teste automatizado entra com o usuário demo e exercita dashboard/chat/telas (a validação humana ficou pendente em RISCOS).
6. **Sem health check** — Railway sem endpoint de saúde; smoke test pós-deploy não existe.
7. **Sem telemetria** (Sentry ou equivalente) — decisão pendente desde o deploy.
8. **Rate limiting próprio ausente nas RPCs** — mitigado por caps de token diário; contadores por tenant pendentes para endpoints caros (ingestão).

## Bugs encontrados

- Nenhum bug funcional novo nesta varredura inicial (grep de TODO/FIXME: zero reais). Mensagem desatualizada na tela de agentes (item 1) é o único texto enganoso.
- **Encontrado durante a implementação de T5**: a rota `/api/health` recém-criada era interceptada pelo middleware de auth (`proxy.ts`) e redirecionada para `/login` — health check nunca respondia 200 sem sessão, quebrando o smoke test do Railway. Corrigido excluindo `api/health` do matcher do proxy (agora público, sem tocar Supabase). Verificado com curl local e com os specs de e2e de proteção de rota (continuam passando).

## Riscos técnicos (resumo — detalhe em RISCOS_E_PENDENCIAS.md)

- RPCs `SECURITY DEFINER` em vez de RLS-por-claim (D-V2-058) — migração planejada, não urgente.
- 1 tenant por usuário (PK) — limitação de modelagem conhecida.
- Percepção emocional ativa eleva DPIA/jurisdição a bloqueante para mercados regulados (ADR-035).
- `unit_cost=0` no ledger até existir rate card — custos em unidades, não em moeda.

## Integrações pendentes (ver docs/NEEDS_CONNECTION.md)

Telefonia (Telnyx), reuniões externas (Recall.ai/Meet/Zoom), LiveKit (sala própria), billing (Stripe), telemetria (Sentry), rate card de custos, Resend key no ambiente do portal (para e-mail de convite).

## Ordem de execução decidida

`TASKS.md` reflete esta ordem: ativação de agente → e-mail de convite → mock mode dos providers → e2e Playwright logado → CI do portal + health check → telemetria/rate limit.
