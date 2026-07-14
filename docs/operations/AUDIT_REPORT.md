# Auditoria consolidada da documentação recebida

## Escopo auditado
- ZIP V1 com 62 arquivos.
- Retorno do Fable 5 com `MIGRATION_MAP_V1_TO_V2.md`, `ARCHITECTURE_CONSTITUTION.md` e `ARCHITECTURE_STATUS.md`.
- Workbook original de unit economics.

## Achados críticos corrigidos nesta V2

1. **Produto acoplado a vendas.** O kernel foi separado de Role Packs. Sales Closer tornou-se o primeiro pack.
2. **Falta de componentes humanlike normativos.** Foram definidos Turn Coordinator, Perception Engine, Behavior Director e Scene Director.
3. **Um único cérebro com responsabilidades conflitantes.** Foi criado Cognitive Fabric com Fast Lane, Deliberative Lane, Specialist Lane e Policy lane.
4. **Trust score simplificado.** Substituído por Interaction Quality State multidimensional, explicável e com evidências.
5. **Schemas permissivos.** A V1 possuía 22 objetos sem `additionalProperties:false`; a V2 traz 31 schemas estritos.
6. **UUID inconsistente.** A V1 prometia UUIDv7 e usava `gen_random_uuid()`. A V2 exige UUIDv7 gerado pela aplicação para IDs de domínio.
7. **Embedding fixo sem decisão.** A V2 usa coluna vetorial sem dimensão no walking skeleton, registra modelo e dimensão e adia índice ANN até o bake-off.
8. **Event bus confundido com workflow engine.** Eventos e workflows duráveis foram separados.
9. **Ausência de contratos OpenAPI e AsyncAPI.** Foram adicionadas specs machine-readable.
10. **Ausência de task graph executável.** Foram criados marcos, dependências, owners, testes e critérios de aceite.
11. **Instruções genéricas para agentes.** Foram adicionados `AGENTS.md`, skills e prompt Codex-first.
12. **Unit economics incompleto.** O novo modelo separa minuto conectado, falado, vídeo, meeting bot, storage, observabilidade, concorrência e margem.

## Pontos preservados da V1
- Axtro Agent fora do caminho crítico.
- Tool contracts e autorização server-side.
- Handoff humano quente.
- RLS e testes cross-tenant.
- Outbox transacional.
- Provider abstraction.
- Disclosure e consentimento.
- Avaliações bloqueantes.

## Evidência reproduzível
Execute:

```bash
python3 scripts/docs_qa.py
python3 scripts/validate_contracts.py
python3 scripts/validate_specs.py
```

Os scripts não dependem de credenciais externas.

## Limitações honestas
- Nenhum provider foi testado neste ambiente.
- Nenhuma credencial foi utilizada.
- Não foi executado parecer jurídico.
- Os PDFs do Método Silva não estavam presentes no ZIP disponível nesta sessão.
- Os valores de providers permanecem inputs datados e editáveis, não compromissos contratuais.
