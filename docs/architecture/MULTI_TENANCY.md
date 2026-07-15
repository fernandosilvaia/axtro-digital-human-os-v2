# Multi-tenancy

## Modelo

Banco compartilhado com RLS para dados tenant-scoped. Global catalogs são explícitos, imutáveis por runtimes comuns e não armazenam dados de cliente.

## Request context

Cada request ou job resolve:
- tenant_id;
- actor_id e actor_type;
- service identity;
- purposes;
- region and sector policy;
- trace_id.

`X-Tenant-Id` é somente o seletor de contexto para service identities. A identidade já verificada precisa ter um grant explícito para o tenant solicitado antes de qualquer `TenantContext` existir. M0 rejeita o header para web users, mesmo quando o grant coincidir. A futura seleção de tenant por usuário exigirá claim ou contrato explícito, nunca inferência a partir do header. Actor, escopos e finalidades nunca vêm de headers ou body.

No Postgres, usar `SET LOCAL app.tenant_id` dentro da transação. O adapter M0 usa a forma parametrizada equivalente `SELECT set_config('app.tenant_id', $1, true)`. Nunca usar session-level setting em pool.

## Development auth boundary

O verificador determinístico consulta somente um registro server-side injetado no startup. Ele não é OIDC nem JWT de produção. O baseline M0 aceita `session:read`, `session:write`, `provider:use` e `tool:use`; M1-07 adiciona `event:relay` e `event:observe`, e M1-08 adiciona `workflow:dispatch`, `workflow:execute` e `workflow:observe`. Esses cinco escopos operacionais são exclusivos de service identity com actor type `workflow`, e os repositories exigem também a finalidade `essential_processing`. O relay recebe dispatch, não autoridade para claim ou cancelamento. Claim e checkpoint exigem execute mais `session:read`; cancellation exige somente execute. Resultados post-call são `restricted`; sua leitura exige observe mais `session:read`. As finalidades registráveis permanecem `essential_processing`, `provider_auth` e `tool_auth`. Wildcard, admin, bypass e grants amplos continuam proibidos. O verificador só pode ser construído com `dev_auth_enabled=true` em `development` ou `test`. Staging, canary e produção exigem um verificador de identidade posterior e falham fechados para o fake.

## Service identities

- web user;
- api service;
- realtime worker;
- workflow worker;
- axtro bridge;
- migration/admin.

Cada uma possui grants mínimos. Service role que bypassa RLS não é usada por requests normais.

## Storage e cache

- object keys começam com tenant ID;
- signed URLs curtas;
- Redis keys com namespace tenant;
- queues carregam tenant e são validadas no consumer;
- logs não agregam PII entre tenants.

## Testes obrigatórios

- SELECT/INSERT/UPDATE/DELETE cross-tenant;
- foreign key para entidade de outro tenant;
- pool context reset;
- cache collision;
- vector retrieval isolation;
- webhook actor spoofing;
- service identity overreach.
