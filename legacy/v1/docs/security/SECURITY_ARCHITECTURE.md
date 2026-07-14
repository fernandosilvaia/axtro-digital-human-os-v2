# SECURITY_ARCHITECTURE.md

> Status: PROPOSTO (aprovar via ADR-010/ADR-007). Escopo: plataforma inteira, com foco no que é específico de agentes de IA com voz, tools e multi-tenancy.

## 1. Princípios
1. **Tenant é a fronteira de segurança nº 1.** Tudo (dados, índices RAG, memórias, chaves, filas) é escopado por `tenant_id`; RLS no Postgres em 100% das tabelas; nunca confiar em filtro de aplicação sozinho.
2. **O LLM é um usuário não confiável.** Toda saída do modelo que vira ação (tool call, texto exibido, follow-up) passa por validação determinística. Prompt nunca define limite comercial, permissão ou preço — isso vive em política server-side.
3. **Menor privilégio por camada.** Workers realtime só leem o que a sessão precisa; Axtro Agent tem credenciais próprias e não acessa segredos de tenant diretamente; tools recebem tokens de escopo mínimo com TTL curto.
4. **Auditabilidade total.** Toda ação com efeito externo (tool write, envio de mensagem, alteração de CRM) gera registro imutável com `tenant_id, session_id, actor, input_hash, resultado, trace_id`.
5. **Fail closed para ações, fail open para conversa.** Se a política não puder ser avaliada, a ação é negada; a conversa continua (o agente diz que vai confirmar e segue).

## 2. Identidade e acesso
- **Humanos (dashboard):** Supabase Auth (e-mail+senha, Google SSO; SAML/OIDC na F6). Papéis: `owner`, `admin`, `manager`, `agent_operator`, `viewer`. ABAC adicional para gravações/PII (flag por papel + finalidade).
- **Serviços:** service tokens de curta duração emitidos pela API (JWT assinado, `aud` por serviço, TTL ≤ 15min, rotação automática). Workers LiveKit recebem token por sessão com claims `{tenant_id, session_id, agent_id}`.
- **API keys de tenant:** prefixadas (`axk_live_…`), hash armazenado (argon2id), escopos explícitos, revogação imediata, rate limit por chave.
- **M2M com Axtro Agent:** mTLS interno + JWT de serviço; daemon jamais recebe chaves de providers do tenant — pede à API que execute em seu nome (padrão broker).

## 3. Segredos e chaves
- Doppler como fonte de verdade; injeção em runtime (nunca em build); rotação trimestral ou imediata pós-incidente.
- Chaves de providers por tenant (BYOK futuro) criptografadas com envelope encryption (KMS key por ambiente + DEK por tenant), decrypt só no momento do uso, nunca logadas.
- Webhooks entrantes: verificação de assinatura + janela de timestamp 5min + nonce anti-replay (Redis SETNX).

## 4. Segurança específica de IA
| Risco | Controle |
|---|---|
| Prompt injection via fala do lead | Instruções de sistema isoladas; transcript tratado como dado; regex/classificador de injeção no texto STT antes do LLM; tools nunca autorizadas por conteúdo da conversa, só por política |
| Prompt injection via RAG (doc envenenado) | Sanitização na ingestão; chunks marcados como `data`, template separa claramente; conteúdo de doc não pode invocar tool |
| Exfiltração cross-tenant via memória/RAG | Namespaces físicos por tenant no pgvector (partição + RLS); testes automatizados de isolamento em CI (query de tenant A jamais retorna chunk de B) |
| Excesso de autoridade do agente | Tool grants por agente; risk_class com aprovação humana p/ `write_high`+ (ver TOOL_RUNTIME.md); limites de desconto/valor no SalesSessionState.limits vindos do DB |
| Voz clonada sem autorização | Clonagem só com evidência de consentimento arquivada (ver COMPLIANCE.md); voice_id vinculado a registro de consentimento; bloqueio de upload de amostra sem fluxo |
| Deepfake / uso indevido do avatar | Disclosure de IA obrigatório e configurável mas nunca desligável abaixo do mínimo legal; watermark de metadados nas gravações geradas |
| Alucinação de preço/condição | Preços e condições vêm de catálogo no DB; LLM só cita valores presentes no contexto estruturado; validador pós-geração compara números citados vs catálogo e corrige/omite |
| Jailbreak p/ conteúdo fora de escopo | Guardrail de tópico por tenant (allowlist de domínios de conversa); resposta padrão de recondução; 3 desvios ⇒ oferta de handoff |

## 5. Rede e infraestrutura
- Tudo TLS 1.2+; HSTS; mTLS entre serviços internos no Fly.io private network.
- Postgres: RLS + roles distintos (api_rw, worker_ro_session, analytics_ro); conexões via pooler; sem superuser em runtime.
- Mídia: LiveKit Cloud (SRTP/DTLS); gravações em bucket privado com URLs assinadas TTL 15min; região BR (São Paulo) para dados em repouso.
- Rate limiting em camadas: edge (por IP), API (por chave/tenant), realtime (sessões simultâneas por plano).

## 6. Logging seguro
- PII minimizada em logs (nome→hash curto, telefone→últimos 4); transcript integral só no storage de transcript com ABAC, nunca em log de aplicação.
- Áudio bruto retido conforme política de retenção do tenant (default 90d, configurável; ver COMPLIANCE.md).
- `trace_id` propagado ponta a ponta (HTTP header → job → evento → tool) para investigação sem juntar PII.

## 7. Resposta a incidentes (mínimo viável F1)
- Kill switch em 3 níveis: sessão (encerra call com mensagem de cortesia), agente (pausa novas sessões), tenant (suspende tudo). Acionável por dashboard e por Axtro Agent (com auditoria).
- Runbook: detectar → conter (kill switch) → preservar evidência (logs+gravação) → notificar tenant ≤72h se dados pessoais afetados (LGPD art. 48) → post-mortem em DECISIONS_LOG.
- Contatos e SLAs de providers registrados em PROVIDER_STRATEGY.md.
