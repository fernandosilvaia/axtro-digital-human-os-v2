# Latency Budgets

## Voz modular, meta inicial

| Etapa | p50 budget | p95 budget | Observação |
|---|---:|---:|---|
| endpoint confirmation | 120 ms | 300 ms | após último frame útil |
| context compose | 20 ms | 60 ms | estado local/cache |
| model first token | 250 ms | 600 ms | provider dependent |
| TTS first audio | 180 ms | 450 ms | streaming |
| publish and jitter | 80 ms | 180 ms | channel |
| total EOT to audio | 650 ms | 1.500 ms | budget inclui overlap |

## Vídeo

Avatar pode adicionar tempo de first frame. Meta: áudio não deve esperar frame perfeito. Avatar inicia com prewarmed session e lip sync acompanha stream.

| Métrica | Ideal | Acceptable | Degraded |
|---|---:|---:|---:|
| first visible response | ≤1.2 s | ≤2.2 s | voice first, video later |
| avatar warm-up | ≤2.0 s | ≤5.0 s | voice-only |
| barge-in stop | ≤180 ms | ≤250 ms | hard mute |

## Tool calls

Read-only no turno: timeout recomendado 800 ms, com preamble curto quando necessário. Writes não bloqueiam silêncio; agente informa que está processando somente quando isso ajuda e aguarda receipt.

## Medição

- timestamp monotônico no worker;
- correlation por generation id;
- separar provider, network e local;
- não usar transcript timestamps como única fonte;
- reportar sample size e condições de rede.
