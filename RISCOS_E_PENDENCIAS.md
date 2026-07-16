# Riscos e pendências

**Atualizado:** 2026-07-16 (noite) · **Branch:** `main`

## Pendências com gate humano (não são bugs)

| # | Pendência | Onde está documentado | Quem destrava |
|---|---|---|---|
| 1 | ~~Habilitar o Custom Access Token Hook~~ — **RESOLVIDO 2026-07-16** via Management API (D-V2-063): hook ativo, JWT testado carregando `tenant_id`/`actor_id`/`tenant_role` | D-V2-063, ADR-032 | — |
| 2 | Chaves reais de provider (voz, avatar, LLM, telefonia) via Doppler — só no fim da fase, após auditoria, por instrução explícita | PROGRESS.md "Próxima ação" | Fernando |
| 3 | ~~Deploy/hosting real~~ — **RESOLVIDO 2026-07-16** (autorizado): https://portal-production-b43e.up.railway.app | docs/operations/DEPLOY_PORTAL.md | — |
| 4 | ~~SMTP próprio~~ — **RESOLVIDO 2026-07-16**: Resend configurado via Management API (smtp.resend.com:465, domínio axtroai.com verificado, 30 e-mails/h); envio real de confirmação testado e visto no Resend | D-V2-063 | — |
| 5 | Bake-off credenciado de provider + piloto interno real de M3-10 | D-V2-048/049/054 | Fernando |

## Riscos aceitos / dívidas técnicas

| # | Item | Racional | Mitigação futura |
|---|---|---|---|
| 1 | RPCs `SECURITY DEFINER` como camada de dados do portal, em vez de RLS por claim de JWT | D-V2-058 — funciona hoje sem o hook habilitado e sem `service_role` | Quando o hook estiver ativo, migrar leituras para RLS-por-claim mantendo as RPCs de escrita |
| 2 | As funções e tabelas do portal (`user_tenant_memberships`, `portal_*`, hook) vivem só no projeto Supabase, fora de `database/migrations/` | D-V2-055/056 — referenciam `auth.users`, inexistente no harness local | ~~Criar `database/supabase-only/`~~ feito 2026-07-16 — SQLs versionados em `database/supabase-only/0001..0007` |
| 3 | `user_tenant_memberships` permite um único tenant por usuário (PK em `user_id`) | Suficiente para self-serve atual; convites (D-V2-060) respeitam essa restrição — convidar e-mail que já tem workspace é rejeitado | Multi-tenant por usuário / mover usuário entre tenants exigem nova modelagem (revisit trigger no ADR-032) |
| 3b | Convites não enviam e-mail (modelo e-mail pré-aprovado): o convidado precisa ser avisado por fora e criar conta com o e-mail exato | D-V2-060 | SMTP próprio agora existe (D-V2-063) — adicionar notificação por e-mail no ato do convite é trabalho natural de continuação |
| 4 | Sem rate limiting próprio nas RPCs do portal | Supabase Auth já limita auth; RPCs são baratas e tenant-scoped | Adicionar contadores por tenant quando houver endpoint caro |
| 5 | Agentes nascem `draft` e fontes nascem `pending` (D-V2-062); ativação de agente e ingestão de conteúdo seguem indisponíveis no portal | Ativação exige provedores conectados + disclosure validado; ingestão exige provedor de embeddings — fronteiras reais de dependência externa | Liberar ativação/ingestão junto com a conexão de provedores |
| 6 | `robots: noindex` no portal inteiro | Portal é app logado; não há landing page pública neste repo | SEO/AEO pertencem à landing (projeto `axtroai`), não ao portal |

## Como monitorar

- Advisors de segurança/performance do Supabase: `get_advisors` (MCP) ou dashboard → Reports.
- Logs de auth e Postgres: dashboard → Logs (não há log drain configurado).
- O portal ainda não tem telemetria própria (Sentry etc.) — decidir na fase de deploy.
