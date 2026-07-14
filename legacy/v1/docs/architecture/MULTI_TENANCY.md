# MULTI_TENANCY — Isolamento como Fundação (ADR-007)

Modelo: **banco compartilhado + RLS obrigatório** (custo/velocidade no MVP) com caminho para schema-per-tenant/instância dedicada no Enterprise (F6, data residency/BYOK).

## Regras invioláveis
1. `tenant_id uuid not null` em toda tabela de dados (exceto catálogos globais) + política RLS `using (tenant_id = current_setting('app.tenant_id')::uuid)`; conexões da aplicação sempre setam `app.tenant_id` via middleware; service-role restrito a jobs administrativos auditados.
2. Storage: bucket path `tenants/{tenant_id}/...` com política de acesso derivada do JWT.
3. Segredos de integrações por tenant: **Supabase Vault** (criptografia por chave de projeto) com envelope adicional por tenant; nunca em colunas comuns; Doppler para segredos de plataforma.
4. Redis: prefixo `t:{tenant_id}:`; streams por tenant onde volume justificar.
5. Índices: todo índice de consulta começa por tenant_id.
6. Suite de vazamento cross-tenant roda no CI (dois tenants sintéticos; tentativa de leitura cruzada em cada tabela/endpoint/tool/RAG) — falha bloqueia merge.

## Identidade e acesso
Auth: Supabase Auth (e-mail+senha com MFA TOTP, magic link, Google SSO). RBAC papéis: owner · admin · manager · agent_operator · viewer (matriz de permissões em API_DESIGN). ABAC adicional para dados sensíveis (ex.: gravações só p/ papéis com `recordings:read` e finalidade registrada). Service identities: realtime-worker, supervisor, bot-worker com escopos mínimos e tokens rotacionados.

## Planos, medição e limites
`usage_meters` por tenant/dia/dimensão: minutos_voz, minutos_video, minutos_meetingbot, minutos_telefonia, tokens_in/out por categoria de modelo, storage_gb, gravacao_min. Budgets: soft (alerta 80%) e hard (encerramento gracioso + bloqueio de novas sessões). Créditos pré-pagos e franquia por plano (fórmulas na planilha). Margem por tenant = receita − Σ(custos por provider medidos) — relatório mensal automático.

## White-label e regionalização (F4)
Branding (logo, cores, nome do produto), domínio próprio (CNAME + cert automático), templates de e-mail, idioma/moeda/fuso por tenant, textos de identificação de IA por região, retenção de gravações configurável (7–730d), exportação (ZIP: dados+transcripts+gravações) e exclusão total com certificado. Ambientes: cada tenant pode ter `sandbox` lógico (dados isolados, providers em modo teste).
