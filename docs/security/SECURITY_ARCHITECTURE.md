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

## Supply chain

- lockfiles committed;
- SBOM por release;
- dependency and container scans;
- signed images and provenance quando disponível;
- SDK de provider encapsulado em adapter;
- version pin, changelog review e canary.

## Security gates

M0: secret scan, SAST, dependency scan e RLS negative tests.
M2: media abuse, scene sandbox e provider failure tests.
M3: threat-model review, external pen test antes de clientes regulados.
