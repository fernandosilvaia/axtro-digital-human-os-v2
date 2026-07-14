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

No Postgres, usar `SET LOCAL app.tenant_id` dentro da transação. Nunca usar session-level setting em pool.

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
