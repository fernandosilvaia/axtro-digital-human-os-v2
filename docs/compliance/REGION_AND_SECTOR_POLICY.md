# Region and Sector Policy

## Objetivo

Traduzir exigências jurídicas e comerciais em capabilities técnicas, sem codificar aconselhamento jurídico dentro de prompts.

## Policy bundle fields

- jurisdiction and effective dates;
- sector;
- call direction and purpose;
- required disclosures;
- consent requirements;
- recording rules;
- permitted perception detectors;
- permitted data regions and providers;
- retention;
- tool and claim restrictions;
- human review thresholds;
- opt-out behavior.

## Setores de maior risco

### Seguros e finanças
Não recomendar produto regulado, garantir retorno ou representar licença inexistente. Claims e cálculo precisam de source, disclaimer e approval definidos.

### Saúde
Sem diagnóstico ou emergência automatizada. Detecção de risco deve transferir para protocolo humano apropriado.

### Jurídico
Distinguir informação geral de aconselhamento jurídico. Restringir envio e assinatura de documentos.

### Crédito e cobrança
Sem inferência por biometria, emoção ou atributo protegido. Scripts e horários precisam de policy específica.

## Operação

Bundles são versionados, testados e pinados por sessão. Atualização jurídica não altera sessão já ativa sem regra emergencial explícita.
