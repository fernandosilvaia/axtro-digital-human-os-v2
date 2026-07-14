# MEMORY_ARCHITECTURE — 7 Memórias, Zero Cruzamento

Regra absoluta: **nenhuma memória cruza tenants** (RLS + testes de vazamento). Cada memória tem: store, escopo, TTL/retenção, classificação de dados e política de exclusão.

| Memória | Conteúdo | Store | Retenção default | Notas |
|---|---|---|---|---|
| **Sessão** | turnos, session_facts, estado curto | Redis (`sess:{id}`) + snapshot PG | TTL 24h pós-call (Redis); transcript PG conforme tenant (default 365d) | única no caminho quente |
| **Cliente** | histórico permitido do contato, preferências, consentimentos | PG `contact_memories` | vida do contato; apagável (LGPD) | só campos com base legal; opt-out respeitado |
| **Oportunidade** | estado comercial acumulado, propostas, objeções | PG `opportunities` + revisions | vida do deal + 24m | alimenta briefing |
| **Empresa (tenant)** | produtos, regras, conhecimento, quadros de objeção | PG + knowledge-engine | versionada | fonte de RAG |
| **Agente** | persona, voz, estilo, prompts versionados | PG `agent_versions` | histórico completo | mudança = nova versão + eval gate |
| **Operacional** | falhas, métricas, eventos, custos | streams + warehouse | 13 meses métrica; eventos 90d quente | sem PII bruta |
| **Aprendizado** | padrões agregados/anonimizados (objeções que convertem, frases eficazes) | PG `learnings` (por tenant; agregação cross-tenant **somente** com anonimização k≥20 e flag contratual) | 24m | escrita só pelo Supervisor com aprovação |

## Classificação e proteção de dados sensíveis
Classes: public · internal · pii · sensitive (saúde/financeiro/biometria). PII: colunas marcadas, criptografia em repouso (PG) + campos críticos com criptografia de aplicação (chave por tenant no Vault), mascaramento em logs, TTL e job de exclusão (direitos do titular: export/delete ≤15 dias, cascata em memórias derivadas e embeddings — chunks têm `contact_refs` para permitir purge).

## Uso em runtime
Briefing lê Cliente+Oportunidade+Empresa; Realtime só recebe o **recorte** relevante (nunca dump). Memória de cliente entra no prompt como dado não confiável e apenas quando útil (nada de "vi aqui que você se divorciou" — política de tato: só fatos comerciais e preferências declaradas).
