# Evidência de validação do pacote Codex-ready

**Executado em:** 2026-07-14  
**Comando canônico:** `python3 scripts/validate_all.py`

## Resultado

```text
DOCUMENTATION QA PASSED: 27 required files, 52 executable tasks
CONTRACT VALIDATION PASSED: 31 schemas, 31 valid examples, 31 invalid examples
SPEC VALIDATION PASSED: 11 OpenAPI paths, 5 AsyncAPI operations
DATABASE CONTRACT VALIDATION PASSED: 38 tables, 6 migrations
CODEX SETUP VALIDATION PASSED: 8 custom agents, 4 repository skills
MIGRATION INVENTORY VALIDATION PASSED: 62 V1 files mapped and hash-verified
SECRET SCAN PASSED
VALIDATION SUITE PASSED: 7 checks
```

## Workbook

O arquivo `spreadsheets/UNIT_ECONOMICS_V2.xlsx` foi importado e verificado com `artifact_tool`:

- 14 abas encontradas;
- zero células com `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?` ou `#N/A`;
- fórmulas do Dashboard recalculadas após atualização dos inputs datados;
- preços públicos e premissas internas identificados separadamente;
- cálculo de telefonia corrigido para separar Voice API e SIP;
- proxy de Realtime atualizado e rotulado como proxy, não preço garantido.

## Limites desta evidência

Esta validação prova consistência documental e estrutural. Não prova:

- que o código do aplicativo já existe;
- que migrations foram executadas em PostgreSQL real;
- que providers reais passaram pelo bake-off;
- que segurança de produção foi certificada;
- que o produto está juridicamente liberado;
- que os valores da planilha serão os preços contratados.

Esses itens pertencem aos gates M0-M3 e às pendências externas.
