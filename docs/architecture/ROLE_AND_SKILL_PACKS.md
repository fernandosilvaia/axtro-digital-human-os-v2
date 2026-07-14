# Role Packs and Skill Packs

## Role Pack

Manifest versionado que define:
- role objective;
- state schema ref;
- allowed skill IDs;
- dialogue policy;
- required disclosures adicionais;
- default behavior profile;
- scene manifests;
- evaluation suites;
- domain vocabulary;
- completion and handoff criteria.

## Skill Pack

Capacidade reutilizável com:
- input/output schema;
- required tool scopes;
- preconditions;
- risk class;
- dialogue guidance;
- tests;
- fallback;
- UI/scene assets opcionais.

Exemplos: `schedule_meeting`, `qualify_lead`, `present_plan`, `create_proposal_dry_run`, `handoff_live`.

## Resolução efetiva

```text
Platform policy
  + Region/Sector policy
  + Tenant policy
  + Agent grants
  + Role Pack
  + Skill Pack
  = EffectiveCapabilities
```

Interseção, não união irrestrita. Role Pack não amplia policy do tenant.

## Versionamento

Sessão pinada à versão de Role e Skill Packs no início. Atualização durante call não muda comportamento da sessão corrente.

## Instalação

1. validar manifest e signatures;
2. verificar dependências;
3. executar eval suite;
4. instalar em disabled;
5. habilitar em tenant de teste;
6. promover com `deployment_promotion`.
