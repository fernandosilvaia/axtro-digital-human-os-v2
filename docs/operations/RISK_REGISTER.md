# Risk Register

| ID | Risco | Prob. | Impacto | Mitigação | Trigger |
|---|---|---:|---:|---|---|
| R01 | naturalidade insuficiente | M | H | Human Presence Spike, blind review, short replies | score <3.5 |
| R02 | avatar uncanny or repetitive | H | M | Behavior Director, provider bake-off, voice fallback | repetition threshold |
| R03 | custo de vídeo destrói margem | H | H | separate video allowance, budgets, warm-pool accounting | cost > target 2 weeks |
| R04 | provider lock-in | M | H | adapters, asset provenance, fallback | capability gap or price hike |
| R05 | cross-tenant leakage | L | Critical | RLS, composite integrity, negative CI | any test or incident |
| R06 | tool executes wrong action | M | Critical | contracts, policy, receipts, approval | write anomaly |
| R07 | disclosure or consent failure | L | H | hard state gate, policy bundles | missing record |
| R08 | perception regulatory exposure | M | H | opt-in, detector registry, default off | new jurisdiction or feature |
| R09 | daemon destabilizes calls | L | H | async bridge, TTL and kill switch | sync dependency found |
| R10 | meeting platform changes | M | H | Recall adapter, native room fallback | join failure rate |
| R11 | long-session memory drift | M | M | structured state, summaries, context budget | contradiction rate |
| R12 | excessive agent verbosity | H | M | style rules, turn metrics, eval | >3 sentences rate |
| R13 | false action completion | M | Critical | receipt-gated claims | eval failure |
| R14 | denial of wallet | M | H | per-session and tenant budgets | spend spike |
| R15 | insufficient engineering focus | H | H | task graph, small PRs, two-track gates | tasks exceed size |
| R16 | legal advice assumed from architecture | M | H | counsel gate and disclaimers | regulated pilot |
| R17 | provenance de evidence ID ainda não é verificável no reducer em memória | M | H | bloquear `derived_hypothesis` como fato confirmado e vincular lineage de evidência antes da primeira persistência de timeline | tentativa de promover hipótese como fato |
| R18 | perda/corrupção de dados de produção sem plano de restore validado | L | Critical | plano Supabase Pro (backup diário automático, confirmado via MCP 2026-08-12) + runbook `docs/operations/DISASTER_RECOVERY.md` (D-V2-114); status de PITR e teste de restore real ainda pendentes de confirmação do Fernando | incidente de dados, ou decisão de habilitar PITR antes de escala |
