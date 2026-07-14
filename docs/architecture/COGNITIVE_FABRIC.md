# Cognitive Fabric

## Objetivo

Separar velocidade, profundidade, especialização e autoridade. Nenhum modelo isolado governa a sessão.

## Lanes

### Fast Lane
- participa do loop realtime;
- produz fala curta, state patch proposto e intents;
- usa contexto mínimo e deadlines rígidos;
- pode usar modelo speech-to-speech ou LLM textual.

### Deliberative Lane
- analisa estratégia em paralelo;
- trabalha com snapshot versionado;
- produz `agent_suggestion` com TTL;
- nunca bloqueia a Fast Lane.

### Specialist Lane
- especialistas de produto, preço, compliance, pesquisa, proposta e tools;
- recebem `specialist_request` tipado;
- devolvem `specialist_result` com sources, confidence e expiry.

### Policy and Critic Lane
- motores determinísticos e classificadores de segurança;
- valida action, disclosure, price, claims, tool scope e scene;
- possui autoridade para bloquear ação, não para publicar fala livre.

## One Mouth Rule

Somente o Presenter emite resposta externa. Fast Lane produz a fala do Presenter. Deliberative e Specialist lanes só alimentam o Context Composer para turnos futuros ou provocam handoff/safety command.

## Snapshot versioning

Todo request assíncrono inclui `context_version`. Resultado retornado com versão antiga pode:
- ser descartado;
- ser aceito como informação estável;
- ser revalidado.

A política é definida por result type.

## Routing

Model Gateway escolhe provider por:
- task class;
- latency budget;
- idioma;
- data policy;
- tenant allowlist;
- model health;
- custo e budget;
- experiment assignment.

## Failure modes

| Falha | Resposta |
|---|---|
| Fast Lane timeout | fallback curto ou pedir repetição |
| Deliberative timeout | ignorar |
| Specialist timeout | responder com incerteza ou handoff |
| Policy unavailable | fail closed para writes; fail safe para conversa |
| Model degraded | trocar provider ou reduzir funcionalidade |

## Anti-patterns

- swarm de agentes conversando entre si a cada turno;
- consenso obrigatório antes de responder;
- especialista emitindo texto direto ao TTS;
- critic reescrevendo indefinidamente;
- chain-of-thought persistido em logs.
