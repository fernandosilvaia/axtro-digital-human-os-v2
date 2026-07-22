# Checklist para o próximo agente (ou próxima sessão)

**Superado por `docs/HANDOFF.md` e `TASKS.md`** — este arquivo cobria o estado
de 2026-07-16 (portal recém-lançado) e ficou obsoleto: Auth Hook, SMTP e
deploy inicial, que ele listava como pendentes, foram resolvidos há vários
ciclos. Mantido só por histórico; **não use como checklist real**.

## Onde está o checklist atual

1. `docs/HANDOFF.md` — como operar e desenvolver o portal agora.
2. `TASKS.md` — backlog priorizado do que falta.
3. `docs/PROJECT_AUDIT.md` — auditoria viva do repositório.
4. `PROGRESS.md` — histórico completo por tarefa (fonte da verdade).
5. `docs/operations/DECISIONS_LOG.md` — toda decisão não óbvia, com ID `D-V2-NNN`.

## Regras que continuam valendo

- Nenhuma chave real de provider no código, `.env` versionado ou logs; secret scan (`python3 scripts/secret_scan.py`) precisa passar.
- Repo é público: `LICENSE` proprietária, nada de dados reais de cliente em commits.
- `database/migrations/` continua sendo o contrato portátil — nada que referencie `auth.users` entra lá.
- Toda decisão não óbvia vai para `docs/operations/DECISIONS_LOG.md` com ID `D-V2-NNN` sequencial.
