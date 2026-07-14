# Catálogo inicial de Role Packs

## Conceito

Role Pack define objetivo, estado específico, políticas, skills permitidas, métricas, evals e conteúdo. Não controla transporte, turn-taking, tenancy ou execução de tools.

## Packs planejados

| Pack | Estado | Objetivo principal | Skills típicas |
|---|---|---|---|
| Sales Closer | M3 | discovery, demo, objeções, próximo passo | qualify, present, schedule, proposal, handoff |
| SDR | posterior | contato inicial e qualificação | outreach, qualify, schedule |
| Onboarding | posterior | ativar novo cliente | verify, configure, educate, escalate |
| Customer Success | posterior | adoção e expansão | review, recommend, task, handoff |
| Support | posterior | resolver incidentes | diagnose, retrieve, apply-safe-fix, escalate |
| Receptionist | posterior | receber, direcionar e agendar | identify, route, schedule |

## Restrições

- Um Role Pack não concede scopes de tool por si só. Policy do tenant concede.
- Um pack não pode remover disclosure ou consentimento.
- Um pack pode fornecer BehaviorProfile e SceneManifest defaults, mas não comandos livres.
- Packs são versionados e promovidos como deployment artifacts.
