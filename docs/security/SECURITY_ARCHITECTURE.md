# Security Architecture

## Security objectives

1. Uma empresa nunca acessa dados de outra.
2. O modelo não amplia permissões.
3. Ações externas são comprováveis, idempotentes e reversíveis quando possível.
4. Conteúdo e mídia não confiáveis não controlam o sistema.
5. Segredos ficam fora de prompts, browser e logs.
6. Falhas degradam com segurança e sem inventar resultado.

## Trust boundaries

- participant devices;
- meeting platforms;
- realtime provider;
- avatar, STT, TTS and model providers;
- Axtro browser applications;
- API and workers;
- database, cache and object storage;
- Axtro Agent daemon;
- tenant integrations;
- human operators.

## Identity

- OIDC para usuários.
- Service identities curtas e específicas para workers.
- Tokens de sala de curta duração e audience limitada.
- MFA obrigatório para admins.
- Impersonation administrativa somente com motivo, duração e audit trail.

Enquanto OIDC não é integrado, M0 usa somente uma registry determinística de desenvolvimento, injetada no startup e protegida por `dev_auth_enabled`. Ela é proibida em staging, canary e produção, não materializa credenciais reais, aceita somente grants M0 mínimos e não transforma `X-Tenant-Id` em autoridade.

## Authorization

Camadas:
1. tenant membership;
2. role and attribute policy;
3. purpose and region policy;
4. agent and skill grants;
5. tool-specific policy;
6. resource ownership and current state.

O bearer verificado produz actor, tipo, grants, escopos e finalidades server-side. `X-Tenant-Id` apenas seleciona um grant já presente para service identities. M0 rejeita o seletor para users, até existir um contrato claim-based específico. O middleware rejeita tenants não concedidos antes de abrir uma transação ou chamar um serviço.

Scopes e finalidades são cumulativos, não alternativos. Toda operação que lê ou
altera lifecycle, timeline, Session Actor, outbox, workflow ou custo de uma
sessão exige `essential_processing` no guard do bounded context. Um grant com
`session:read` ou `session:write` emitido somente para `provider_auth` ou
`tool_auth` falha antes de leitura, alocação ou mutação.

## Data protection

- TLS em trânsito.
- encryption at rest do provider.
- envelope encryption para PII sensível.
- signed URLs curtas.
- field redaction antes de LLM e logs.
- data classification no event envelope.
- retention e deletion graph.

## Prompt and tool injection

- system instructions são templates versionados e imutáveis durante sessão;
- RAG é delimitado e marcado como dados;
- tool output é schema-validated;
- scene URLs e tool names são allowlisted;
- nenhum documento concede permission;
- high-risk action requer policy e approval independente.

## Realtime hardening

- media frame limits;
- participant and room admission policy;
- rate limits por session;
- cancellation e output kill switch;
- generation IDs para bloquear late output;
- bounded mailbox;
- audio and video resource quotas;
- no raw media in general logs.

## Application ingress and egress baseline

- API composition measures the received body bytes before parsing or authentication. `Content-Length` never replaces this measurement.
- M0 limits are code-owned and explicit: 64 KiB body, 32 headers, 128 bytes per header name, 4 KiB per header value, 8 KiB total headers, 30 authenticated requests per tenant, actor and route bucket per 60 seconds, and a bounded 1,024-bucket local limiter.
- The API applies a static no-store response-header profile. It does not reflect CORS, use wildcard CORS or emit HSTS until a trusted TLS transport owns that decision.
- After authenticated tracing exists, rejected API requests use the existing OpenAPI `Problem` schema with static detail and `trace_id`; the correlation ID remains in tenant-safe telemetry rather than a competing response shape.
- Rate keys come only from the authenticated tenant context and code-owned route metadata. IP, `X-Forwarded-For`, raw tenant headers and body fields do not affect quota identity.
- The validated runtime request timeout becomes an absolute deadline and derived cancellation signal. A late handler result is discarded.
- Egress is default deny. Only composition-owned, adapter-specific capabilities may approve an exact HTTPS origin. The capability binds the approved token to the normalized target and resolves it only in its transport dispatch boundary. Redirect hops require separate approval. M0 fakes have no egress capability and never make network calls.

## Supply chain

- lockfiles committed;
- SBOM por release;
- dependency and container scans;
- committed advisory snapshot for deterministic M0-M1 dependency scanning; malformed input and high or critical findings fail closed;
- signed images and provenance quando disponível;
- SDK de provider encapsulado em adapter;
- version pin, changelog review e canary.

## Security gates

M0: secret scan, SAST, deterministic dependency scan, ingress and egress negative tests e RLS negative tests.
M2: media abuse, scene sandbox e provider failure tests.
M3: threat-model review, external pen test antes de clientes regulados.
