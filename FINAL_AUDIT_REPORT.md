# Auditoria final para início da implementação no Codex

**Data:** 2026-07-14  
**Veredito:** `READY FOR CODEX M0-M2`  
**Escopo excluído:** lançamento em produção, certificação de segurança, aprovação jurídica ou provider definitivo.

## Resposta executiva

O pacote parcial do Fable 5 foi convertido em uma especificação implementável. O Codex pode começar hoje por `M0-01` e avançar autonomamente por M0, M1 e M2, respeitando o task graph, os contratos e os gates.

Não existe bloqueio arquitetural para M0 ou M1. M2 também pode ser implementado com provider fakes. Credenciais reais são opcionais para benchmark e não podem bloquear a correção da arquitetura.

## O que foi auditado e corrigido

- 62 arquivos da V1 preservados, hash-verificados e mapeados individualmente;
- retorno parcial do Fable preservado como evidência;
- Digital Human OS separado do Sales Closer Role Pack;
- Axtro Agent mantido fora do caminho crítico de áudio;
- One Mouth Rule e handoff atômico;
- Session Actor, Turn Coordinator e generation fencing;
- Perception, Behavior, Scene e Specialist Fabric definidos como subsistemas;
- 31 contratos estritos, exemplos positivos e negativos;
- OpenAPI 3.1 e AsyncAPI 3;
- data model de referência com UUIDv7, RLS, tenant FKs e append-only evidence;
- ActionIntent, PolicyDecision e ToolExecutionReceipt;
- event outbox separado de durable workflows;
- provider adapters, fakes, capability registry, fallback e circuit breakers;
- provider-session renewal para limites como 60 minutos do Realtime;
- segurança, privacidade, disclosure e consentimento por finalidade;
- task graph com 52 tarefas e dependências acíclicas;
- setup nativo do Codex com oito subagentes e quatro skills;
- unit economics com 14 abas, inputs datados e fórmulas validadas;
- sete gates automatizados e CI documental.

## Provas reproduzíveis

Execute na raiz:

```bash
python3 scripts/validate_all.py
```

Resultado esperado:

```text
DOCUMENTATION QA PASSED
CONTRACT VALIDATION PASSED
SPEC VALIDATION PASSED
DATABASE CONTRACT VALIDATION PASSED
CODEX SETUP VALIDATION PASSED
MIGRATION INVENTORY VALIDATION PASSED
SECRET SCAN PASSED
VALIDATION SUITE PASSED
```

Ver detalhes em `docs/operations/VALIDATION_EVIDENCE.md`.

## Primeira execução no Codex

1. Abrir esta pasta como projeto confiável.
2. Manter `workspace-write`, approvals `on-request` e rede desabilitada por padrão.
3. Rodar `python3 scripts/validate_all.py`.
4. Colar `docs/playbooks/PROMPT_EXECUCAO_AUTONOMA_CODEX.md`.
5. Começar em `M0-01`.
6. Não iniciar M3 antes dos gates M0-M2.

## Riscos que continuam reais

- provider real pode não atingir naturalidade, custo ou latência esperados;
- avatar pode falhar em PT-BR, calls longas ou interrupções;
- Google Meet e Zoom podem mudar admission, bot e mídia;
- regras de gravação, biometria, telemarketing e setor regulado variam por mercado;
- um produto humano na aparência não pode ocultar que é IA;
- custo de vídeo e concorrência podem reduzir margem;
- segurança de produção exige threat testing sobre código real.

Esses riscos estão registrados e possuem gates. Eles não justificam atrasar Foundation e Walking Skeleton.

## Ordem recomendada

- Hoje: M0 Foundation.
- Depois: M1 Walking Skeleton por texto e fakes.
- Em seguida: M2 Human Presence Spike com voz, turnos, avatar substituível e cena.
- Somente após M2-13: escolher providers e reestimar M3.

## Decisão final

Enviar a pasta inteira ao Codex. Não enviar apenas o prompt. Contratos, migrations, task graph, AGENTS, subagentes, skills, unit economics e scripts fazem parte da especificação executável.
