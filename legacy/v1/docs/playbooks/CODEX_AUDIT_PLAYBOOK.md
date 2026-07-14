# CODEX_AUDIT_PLAYBOOK.md — auditoria por segunda IA (revisor independente)

> Papel: uma IA revisora (ex.: Codex/GPT) audita periodicamente o trabalho do Claude Code. Objetivo: pegar o que o autor não vê. O revisor NÃO refatora; produz relatório.

## 1. Cadência e escopo
- **Por PR crítico** (labels: `security`, `realtime`, `schema`, `tools`): revisão obrigatória antes do merge.
- **Semanal:** auditoria horizontal de um tema rotativo: (1) isolamento multi-tenant, (2) budgets de latência, (3) contratos de tools/auditoria, (4) drift docs↔código, (5) custos (queries de custo vs UNIT_ECONOMICS), (6) segurança de segredos/logs.

## 2. Checklist do revisor (responder com evidência: arquivo:linha)
- [ ] Alguma tabela/consulta escapa de RLS/tenant context?
- [ ] Algum tipo foi editado à mão em vez de gerado do schema?
- [ ] Alguma tool executa sem passar por policy/risk_class/auditoria?
- [ ] Algum caminho realtime ganhou I/O síncrono novo (rede/disco) sem budget?
- [ ] Prompt contém preço, limite, permissão ou segredo?
- [ ] Teste de aceite do bloco realmente prova o critério (ou é teste-teatro)?
- [ ] Docs normativos citados no PR foram atualizados?
- [ ] Logs novos vazam PII além do permitido?
- [ ] Dependência nova: licença ok? mantida? justificada?

## 3. Formato do relatório
`AUDIT-YYYYMMDD.md` em `/audits`: resumo (aprovado | aprovado com ressalvas | reprovado), achados numerados com severidade (crítico/alto/médio/baixo), evidência, recomendação de 1 linha. Críticos abrem issue bloqueante automaticamente.

## 4. Regras do jogo
Revisor não tem autoridade de design (ADRs mandam); se discordar de um ADR, registra "objeção de arquitetura" para o fundador — não bloqueia por gosto. Autor responde a cada achado no PR (fix, won't-fix com racional, ou issue futura). Won't-fix em achado crítico exige aprovação do fundador.
