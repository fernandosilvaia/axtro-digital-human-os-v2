# Development seed

`tenant_zero_development.sql` is a local, deterministic seed for development
and tests. It creates `tenant-zero-alpha` and `tenant-zero-beta`, installs the
same Sales Closer role pack in each tenant, and binds only the committed fake
providers.

It deliberately contains no customer records, personal data, real provider
credentials, URLs, or production configuration. The `secret_handle` values are
synthetic opaque references, not usable credentials.

Run it only after the local migrations are current:

```bash
AXTRO_ALLOW_LOCAL_DATABASE_URL=1 \
AXTRO_LOCAL_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/axtro_local \
pnpm db:seed
```

The command rejects non-local URLs, checks schema drift first, uses a sanitized
`psql` environment, and runs the fixed seed file only. It must run through the
local database setup role, never the runtime role. Repeating it is safe only
when the canonical Tenant Zero composition is intact; it fails closed instead
of silently accepting a tampered seed row.
