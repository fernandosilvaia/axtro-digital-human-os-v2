# Disaster Recovery / Backup — banco de produção

**Criado 2026-08-12 (D-V2-114)**, em resposta a um achado P1 confirmado
(3/3 verificadores, onda 5 de auditoria autônoma): não existia nenhum
runbook de disaster recovery/backup pro Supabase de produção neste
repositório — o único "rollback" documentado (`docs/RELEASE_READINESS.md`,
`docs/DEPLOYMENT.md`) cobre falha de **deploy/config/schema**, nunca perda
ou corrupção de **dados** reais. `docs/adr/ADR-016-data-retention-deletion.md`
já referenciava "backups according to documented recovery windows" — um
documento que nunca existiu. Este arquivo é esse documento.

## O que está confirmado

- **Plano Supabase:** org "Axtro AI" (`rjjimqjpzkmlmcjkqqnb`) está no plano
  **Pro**, confirmado ao vivo via Supabase MCP (`get_organization` →
  `"plan":"pro"`) em 2026-08-12. O plano Pro inclui backup diário automático
  gerenciado pela Supabase por padrão.
- **Projeto:** `ovctadcrvnfpgxzplupp` ("digital-human-os"), o mesmo referenciado
  em `docs/DEPLOYMENT.md`.
- **Rollback de código/config já funciona:** Railway redeploy do commit
  anterior (`docs/RELEASE_READINESS.md`) cobre um deploy quebrado por env
  var ou bug de aplicação — não é um mecanismo de restore de dados.
- **Migrations supabase-only são aditivas** (`create or replace` / inserts
  idempotentes) — reverter uma migration de schema é seguro e documentado
  por arquivo, mas isso NÃO desfaz uma escrita de dados ruim (DELETE sem
  WHERE, RLS mal escrita, bug de RPC) que já aconteceu em produção.

## O que NÃO está confirmado (precisa da sua ação, Fernando)

Nenhuma ferramenta disponível nesta sessão (Supabase MCP, código do repo)
consegue confirmar os itens abaixo — só o dashboard da Supabase tem essa
informação:

1. **Point-in-Time Recovery (PITR) está habilitado?** É um add-on pago à
   parte do plano Pro (não vem incluído). Sem PITR, o pior caso de restore
   é "o backup diário mais recente antes do incidente" — pode perder até
   ~24h de transações reais (billing, leads, conversas). Verificar em
   Project Settings → Database → Backups.
2. **Qual é a retenção real do backup diário do plano Pro** para este
   projeto específico (padrão documentado pela Supabase é geralmente 7
   dias, mas confirme no dashboard — pode ter mudado).
3. **Nunca foi feito um teste de restore.** Não há evidência (código, doc,
   log) de que um restore já foi executado, nem parcial nem completo. Sem
   isso, o RPO/RTO reais são desconhecidos até o primeiro incidente real —
   o pior momento pra descobrir que o processo não funciona.

## Playbook — perda ou corrupção de dados em produção

Faltava um caso específico pra isto em `docs/security/INCIDENT_RESPONSE.md`
(que já nomeia "perda parcial" como severidade SEV2, mas não tinha nenhum
passo de restore). Segue o mesmo formato dos outros casos daquele arquivo:

### Perda ou corrupção de dados (SEV1 se afeta billing/múltiplos tenants, SEV2 se isolado)

1. **Parar a sangria primeiro.** Se a causa for uma RPC/deploy específico
   ainda em execução, use o rollback de código (Railway → redeploy do
   commit anterior) ou o kill switch aplicável (`INCIDENT_RESPONSE.md`)
   antes de qualquer coisa — não adianta restaurar dados que continuam
   sendo corrompidos.
2. **Preservar evidência.** `query_logs` (Supabase MCP) e os logs
   estruturados do Railway (agora com alerta de taxa de erro, D-V2-114)
   pra reconstruir o que aconteceu e quando — precisa saber o instante
   exato do incidente pra escolher o ponto de restore certo.
3. **Escopo do dano.** Quais tabelas, quais `tenant_id`, desde quando —
   RLS força tudo por `tenant_id`, então normalmente é possível isolar o
   raio de impacto a um subconjunto de tenants.
4. **Decidir a estratégia de restore com o Fernando, ANTES de agir:**
   - PITR (se habilitado): restaura pra um branch/projeto novo no instante
     exato pré-incidente, depois copia só as linhas afetadas de volta —
     não sobrescreve dados bons que chegaram depois do incidente noutros
     tenants.
   - Backup diário (sem PITR): mesma ideia, mas o ponto de restore é o
     snapshot mais recente antes do incidente — pode significar perder
     escritas legítimas de até ~24h pros tenants afetados.
   - **Nunca restaurar o banco inteiro por cima da produção sem avaliar o
     custo de perder todas as escritas legítimas que aconteceram depois do
     ponto de restore, em TODOS os tenants** — o restore geralmente deve
     ser pra um projeto/branch separado, com cópia seletiva de volta.
5. **Executar o restore** (Supabase dashboard — não há ferramenta MCP pra
   isso nesta sessão) e validar contra as tabelas afetadas antes de
   considerar resolvido.
6. **Comunicar** aos tenants afetados se dado deles foi perdido/restaurado
   parcialmente — mesma disciplina de transparência já aplicada em
   `apps/portal/src/app/privacidade/page.tsx`.
7. **Postmortem sem culpa** + regression test que teria pego a causa raiz
   (mesma disciplina do resto do `INCIDENT_RESPONSE.md`).

## Próximos passos recomendados (decisão/ação do Fernando)

1. Confirmar status de PITR no dashboard da Supabase (Project Settings →
   Database → Backups) e anotar o resultado aqui.
2. Se PITR estiver desligado e o orçamento permitir, considerar habilitar
   antes dos primeiros clientes pagantes com dados de billing reais — o
   custo de perder até 24h de dados de cobrança é maior depois que existe
   dinheiro real em jogo.
3. Fazer pelo menos um teste de restore (ideal: pra um branch separado,
   sem tocar produção) pra validar que o processo funciona e medir o RTO
   real, antes de precisar dele de verdade.
4. Depois desses dois pontos resolvidos, atualizar
   `docs/adr/ADR-016-data-retention-deletion.md` pra apontar pra este
   arquivo como o "documented recovery window" que a decisão já
   referenciava.
