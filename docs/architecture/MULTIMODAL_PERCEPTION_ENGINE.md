# Multimodal Perception Engine

## Objetivo

Produzir sinais úteis para turn-taking, acessibilidade, qualidade técnica e adaptação da conversa sem afirmar conhecer emoções ou intenções ocultas.

## Pipeline

```text
Authorized input -> Detector -> PerceptionSignal -> Policy filter
                 -> Optional hypothesis combiner -> DerivedHypothesis
                 -> Context Composer with TTL
```

## Categorias permitidas no M2

### Dialogue signals
- repeated question;
- explicit uncertainty words;
- long silence;
- interruption frequency;
- speaker change;
- explicit positive or negative statement.

### Technical signals
- packet loss;
- low audio level;
- echo;
- frozen video;
- reconnect count.

### Visual presence signals, opt-in
- face currently visible, sem identificação;
- participant away from camera;
- presentation focus event quando fornecido pela UI;
- hand raised ou explicit UI cue.

## Não permitido
- mentira ou honestidade;
- diagnóstico psicológico ou médico;
- raça, religião, orientação, saúde ou outros atributos protegidos;
- inferência de solvência ou risco por rosto e voz;
- reconhecimento facial ou voiceprint sem fluxo específico e base legal;
- emoção tratada como verdade.

## Confidence e TTL

| Sinal | TTL típico | Uso |
|---|---|---|
| áudio muito baixo | 10 s | pedir ajuste técnico |
| possível confusão por repetição | 2 turnos | explicar de outra forma |
| silêncio longo | turno atual | esperar ou checar presença |
| video frozen | 5 s | degradar para voz |
| speaker changed | sessão | atualizar participante ativo |

## Policy enforcement

Detector é registrado com:
- purposes;
- regions_allowed;
- sectors_allowed;
- input modalities;
- retained artifacts;
- model version;
- prohibited decisions.

Sem consentimento correspondente, o detector não recebe frames.

## Privacidade

Por default, sinais derivados são persistidos, não frames crus. Persistência de amostras para debugging exige sampling explícito, redaction e retenção curta.
