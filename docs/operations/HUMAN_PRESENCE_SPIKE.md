# M2 Human Presence Spike

## Perguntas que o spike precisa responder

1. A conversa em PT-BR parece natural por dez minutos?
2. Barge-in interrompe voz e avatar sem late output?
3. Qual componente domina a latência?
4. O avatar demonstra listening sem uncanny repetition?
5. A cena muda sem quebrar ritmo?
6. O sistema degrada para voz com elegância?
7. Quanto custa por minuto conectado e falado?
8. Especialista paralelo melhora a resposta sem bloquear?

## Cenário obrigatório

- disclosure;
- pergunta aberta;
- pausa no meio de frase;
- interrupção do usuário;
- número ou e-mail para exact capture;
- consulta de catálogo read-only;
- especialista atrasado;
- apresentação de um slide;
- avatar failure injection;
- retorno a voice-only;
- encerramento.

## Instrumentação

Spans por:
- audio ingress;
- turn candidate and commit;
- context compose;
- model first token/audio;
- TTS first byte;
- avatar first frame;
- channel publish;
- cancellation acknowledged.

## Saída

Um relatório com:
- p50/p95;
- failures;
- naturalness review;
- provider cost;
- video quality;
- decision to continue, tune or replace.
