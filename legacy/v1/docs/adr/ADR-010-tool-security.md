# ADR-010 — Tools com contrato formal, risk_class e autorização server-side
**Status:** Aceito · 2026-07-13
**Contexto:** O agente executa ações reais (agendar, escrever CRM, gerar link de pagamento). O LLM não pode ser a autoridade de permissão; incidentes aqui são existenciais (T01, T13).
**Decisão:** Toda tool tem contrato versionado (`tool_contract.schema.json`): input/output schema, `risk_class` (read_low, read_pii, write_low, write_high, irreversible), timeout, idempotência obrigatória para writes, suporte a dry-run, atores permitidos. Runtime valida input, aplica policy do tenant (grants por agente), exige aprovação humana para write_high+ (fila de aprovações), executa com token de escopo mínimo, audita tudo. Prompt apenas descreve a tool; jamais concede permissão.
**Alternativas rejeitadas:** Function calling "cru" do LLM direto nos providers (sem policy/auditoria); MCP genérico para tudo já (avaliar F4 — bom padrão, mas nossa policy layer vem primeiro); aprovação humana para tudo (mata a autonomia que vendemos).
**Consequências:** + fronteira de confiança sólida e demonstrável a clientes enterprise. − atrito para adicionar tool nova (aceito: é o ponto).
