# ADR-007 — Multi-tenancy: banco compartilhado com RLS Postgres em 100% das tabelas
**Status:** Aceito · 2026-07-13
**Contexto:** White-label multi-tenant desde o design; 1 desenvolvedor; fronteira de segurança nº1 é o tenant; F6 pode exigir isolamento físico para enterprise.
**Decisão:** Um Postgres (Supabase, região SP) com `tenant_id` em toda tabela + políticas RLS obrigatórias + `set_config('app.tenant_id')` por request/worker; partição do pgvector por tenant; testes de isolamento bloqueantes no CI; storage com prefixo por tenant e URLs assinadas. Escalada futura: réplica dedicada/schema-per-tenant apenas para enterprise (F6), sem mudar o modelo lógico.
**Alternativas rejeitadas:** DB por tenant (ops inviável agora, migrações x N); schema por tenant (meio-termo com pior tooling); só filtro em aplicação (uma query esquecida = vazamento).
**Consequências:** + operação simples, custo baixo, isolamento verificável por teste. − RLS exige disciplina (roles, políticas por tabela) e tem custo de plan; enterprise físico fica para depois.
