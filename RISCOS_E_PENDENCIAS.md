# Riscos e pendências

**Atualizado:** 2026-07-16 · **Branch:** `feat/portal-operational-screens`

## Pendências com gate humano (não são bugs)

| # | Pendência | Onde está documentado | Quem destrava |
|---|---|---|---|
| 1 | Habilitar o Custom Access Token Hook no dashboard Supabase (`Authentication > Hooks` → `custom_access_token_hook`). A função já está publicada; sem ativar, o JWT não carrega `tenant_id`/`actor_id` e `resolveAuthorizedUserRequestContext` não pode ser usado em produção | D-V2-057, ADR-032 | Fernando (dashboard) |
| 2 | Chaves reais de provider (voz, avatar, LLM, telefonia) via Doppler — só no fim da fase, após auditoria, por instrução explícita | PROGRESS.md "Próxima ação" | Fernando |
| 3 | Deploy/hosting real do portal (Vercel/Railway/etc.) — exige aviso prévio antes de criar qualquer conta/infra | acordo da sessão de 2026-07-16 | Fernando |
| 4 | Confirmação de e-mail em signup real depende de SMTP do Supabase (padrão: e-mail builtin com rate limit baixo). **Confirmado na prática em 2026-07-16: o rate limit estourou durante os testes e bloqueou signup e recuperação de senha.** Para qualquer uso real, configurar SMTP próprio (Auth > SMTP no dashboard) | D-V2-061 | Fernando |
| 5 | Bake-off credenciado de provider + piloto interno real de M3-10 | D-V2-048/049/054 | Fernando |

## Riscos aceitos / dívidas técnicas

| # | Item | Racional | Mitigação futura |
|---|---|---|---|
| 1 | RPCs `SECURITY DEFINER` como camada de dados do portal, em vez de RLS por claim de JWT | D-V2-058 — funciona hoje sem o hook habilitado e sem `service_role` | Quando o hook estiver ativo, migrar leituras para RLS-por-claim mantendo as RPCs de escrita |
| 2 | As funções e tabelas do portal (`user_tenant_memberships`, `portal_*`, hook) vivem só no projeto Supabase, fora de `database/migrations/` | D-V2-055/056 — referenciam `auth.users`, inexistente no harness local | Criar um diretório `database/supabase-only/` versionando esses SQLs (hoje o registro canônico é o próprio banco + DECISIONS_LOG) |
| 3 | `user_tenant_memberships` permite um único tenant por usuário (PK em `user_id`) | Suficiente para self-serve atual; convites (D-V2-060) respeitam essa restrição — convidar e-mail que já tem workspace é rejeitado | Multi-tenant por usuário / mover usuário entre tenants exigem nova modelagem (revisit trigger no ADR-032) |
| 3b | Convites não enviam e-mail (modelo e-mail pré-aprovado): o convidado precisa ser avisado por fora e criar conta com o e-mail exato | D-V2-060 — sem SMTP próprio não há canal de envio confiável | Com SMTP próprio, adicionar notificação por e-mail no ato do convite |
| 4 | Sem rate limiting próprio nas RPCs do portal | Supabase Auth já limita auth; RPCs são baratas e tenant-scoped | Adicionar contadores por tenant quando houver endpoint caro |
| 5 | Telas de Agentes/Conhecimento são read-only (sem criar/editar) | Criação exige provedores conectados e contratos de disclosure — fronteira real de dependência externa | Liberar criação junto com a conexão de provedores |
| 6 | `robots: noindex` no portal inteiro | Portal é app logado; não há landing page pública neste repo | SEO/AEO pertencem à landing (projeto `axtroai`), não ao portal |

## Como monitorar

- Advisors de segurança/performance do Supabase: `get_advisors` (MCP) ou dashboard → Reports.
- Logs de auth e Postgres: dashboard → Logs (não há log drain configurado).
- O portal ainda não tem telemetria própria (Sentry etc.) — decidir na fase de deploy.
