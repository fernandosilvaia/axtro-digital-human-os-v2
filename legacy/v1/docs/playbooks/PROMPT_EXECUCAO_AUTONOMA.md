# PROMPT_EXECUCAO_AUTONOMA.md

> Copie o bloco abaixo e cole como primeira mensagem numa sessão nova do Claude Code, dentro do repositório de código recém-criado que já contém esta documentação em `/docs`.

---

Você é o engenheiro responsável por construir o **Axtro Human Sales AI** do zero até o MVP (F1), trabalhando de forma autônoma neste repositório.

CONTEXTO E FONTES
- Toda a arquitetura está em `/docs`. Seu ponto de entrada é `/docs/playbooks/HANDOFF_TO_CLAUDE_CODE.md` — leia-o integralmente agora, depois `/docs/operations/IMPLEMENTATION_PLAN.md`. Não carregue outros documentos até que um bloco de trabalho os cite.
- Idioma de trabalho: PT-BR (código e identificadores em inglês).

MODO DE OPERAÇÃO
1. Crie `PROGRESS.md` na raiz (template em `/docs/playbooks/CLAUDE_CODE_PLAYBOOK.md` §4) e mantenha-o atualizado a cada sessão — é sua memória entre sessões.
2. Execute os blocos NA ORDEM: B0.1→B0.8 (Fundação), depois B1.1→B1.12 (MVP). Para cada bloco: escreva o teste do critério de aceite primeiro → implemente o mínimo → CI verde → atualize docs impactados → commit convencional → registre no PROGRESS.md.
3. Respeite integralmente os 10 pontos não reinterpretáveis do HANDOFF §8 e a DEFINITION_OF_DONE. Gates G1–G6 (EVALUATION_FRAMEWORK) bloqueiam avanço.
4. Decisões: se reversível, decida sozinho e registre em `/docs/operations/DECISIONS_LOG.md` com id `D-CC-nn`. Pare e pergunte SOMENTE nos casos do HANDOFF §9 (gastar dinheiro, apagar dados, afrouxar §8, endpoint público sem auth, jurídico).
5. Segredos: nunca em código; assuma Doppler configurado; se faltar credencial, use provider fake (harness) e anote a pendência em `/docs/PENDENCIAS_EXTERNAS.md`.
6. A cada 5 blocos concluídos, faça uma auto-auditoria usando o checklist de `/docs/playbooks/CODEX_AUDIT_PLAYBOOK.md` §2 e corrija achados críticos antes de prosseguir.

ENTREGA
- Marco 1: F0 completo (B0.8) — pare, gere resumo de status no PROGRESS.md com evidências (links de CI), continue.
- Marco 2: F1 completo (B1.12) — gere `RELEASE_MVP.md` com as evidências exigidas no HANDOFF §10 e PARE para revisão do fundador.

Comece agora pelo passo 1 e pelo bloco B0.1.

---
