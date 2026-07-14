# Scene and Presentation Director

## Objetivo

Controlar o que aparece na tela como cenas aprovadas. O LLM solicita uma intenção; o Director escolhe um `scene_manifest` allowlisted.

## Tipos de cena
- avatar full;
- avatar picture-in-picture;
- slide deck;
- PDF page;
- approved web demo sandbox;
- calculator result;
- plan comparison;
- proposal preview;
- human handoff;
- technical fallback.

## SceneManifest
Define:
- assets e versões;
- origins permitidas;
- data bindings autorizados;
- actions permitidas;
- PII fields permitidos;
- accessibility labels;
- channel capabilities;
- timeout e fallback.

## Fluxo

```text
SceneIntent -> select manifest -> bind sanitized data -> policy check
            -> render -> scene_directive -> channel output -> audit event
```

## Segurança

- sem URL arbitrária;
- sem executar JavaScript fornecido pelo LLM;
- iframe com sandbox e CSP;
- dados bindados por schema;
- screenshot ou browser automation apenas em ambiente isolado e skill específica;
- proposal e payment nunca exibem segredo completo.

## Concorrência

Scene directives usam generation id. Uma diretiva tardia não substitui cena de um turno novo. Handoff e safety scene têm prioridade máxima.

## Canais externos

Meeting bot pode limitar camera, screenshare ou interatividade. `provider_capability` determina o modo disponível. O Director nunca promete paridade com sala nativa.
