# Turn Coordinator

## Função

Decidir quando ouvir, esperar, responder, interromper e recuperar uma falsa interrupção. Não decide conteúdo comercial.

## Sinais de entrada
- VAD start/stop;
- turn detector confidence;
- partial e final transcript;
- audio energy e noise floor;
- active speaker identity;
- agent playback position;
- channel jitter e packet loss;
- user UI signals, como push-to-talk.

## Estados

```text
idle -> user_speaking -> endpoint_candidate -> committed
  ^          |                 |                  |
  |          +-- pause -------+                  v
  +-- recovered_false_interrupt <--- agent_interrupted
```

## Política de endpoint

Um endpoint é confirmado por combinação configurável de:
- silêncio mínimo;
- probabilidade semântica/acústica de fim;
- pontuação e frase completa no transcript;
- max utterance timeout;
- canal e idioma.

VAD isolado não deve ser o único sinal no default de produção.

## Barge-in

Quando fala do participante ultrapassa threshold:
1. marcar `interruption_candidate`;
2. pausar ou reduzir output em poucos frames;
3. confirmar fala real;
4. cancelar generation e scene quando confirmado;
5. recuperar playback se falso positivo e provider suportar;
6. emitir métricas.

## Preemptive generation

Pode iniciar LLM antes do endpoint confirmado, mas:
- usa generation especulativa;
- não publica fala antes de commit;
- cancela sem side effects se o usuário continuar;
- custo especulativo é registrado;
- pode ser desativado por budget ou provider.

## Config por perfil

| Perfil | Endpoint | Interruption | Uso |
|---|---|---|---|
| conversational | médio | sensível | discovery |
| presentation | mais longo | sensível | explicação |
| noisy_phone | conservador | confirmação maior | telefonia |
| accessibility | configurável | push-to-talk opcional | necessidades específicas |

## Test harness obrigatório

Fixtures de áudio ou eventos para:
- pausas no meio da frase;
- “hum”, “aham” e backchannel;
- crosstalk;
- ruído e música;
- sotaques PT-BR;
- números e e-mails;
- falso início;
- interrupção durante tool preamble;
- rede lenta;
- agente falando demais.

Cada replay produz timeline e métricas determinísticas.
