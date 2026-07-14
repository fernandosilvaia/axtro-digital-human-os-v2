# Avatar and Voice Architecture

## Provider layers

- `SpeechToTextProvider`;
- `TextToSpeechProvider`;
- `SpeechToSpeechProvider`;
- `TurnDetectionProvider`;
- `VoiceActivityProvider`;
- `AvatarProvider`;
- `NoiseSuppressionProvider`.

## Modos

### Modular pipeline
Audio → VAD/turn → STT → Fast Lane → TTS → avatar/channel.

Vantagens: interceptação, state/tool control, mix de providers. Desvantagens: mais estágios e latência.

### Speech-to-speech
Audio → realtime model → audio, com server controls e events.

Vantagens: prosódia e baixa complexidade. Desvantagens: custo e menor ponto de interceptação. Toda tool ainda passa pelo server-side Action Runtime.

## Turn detection strategy

VAD alone is insufficient for natural conversation. The Turn Coordinator may combine:

- provider-native VAD;
- semantic or audio turn detector;
- live transcript partials;
- acoustic cues;
- configurable endpointing;
- explicit barge-in and false-interruption recovery.

The current LiveKit turn detector is a candidate because its official documentation describes semantic plus acoustic processing and multilingual support including Portuguese. When used beside a speech-to-speech provider, any extra STT required by the detector must be measured as latency and cost, and conflicting provider turn detection must be disabled.

## Long-session behavior

Voice, avatar and room sessions can have different maximum durations. `InteractionSessionState` outlives each provider connection. Adapters must publish duration capability, support pre-expiry warning and either renew or degrade. Audio must not wait for avatar renewal, and any late media from the old provider epoch is discarded.

## Voice profiles

Profile contém provider-neutral settings:
- voice identity reference;
- locale;
- speaking rate range;
- warmth and energy presets;
- pronunciation lexicon;
- number, currency and email normalization;
- fallback chain.

## Avatar session

Adapter deve suportar:
- create/warm session;
- attach audio source;
- start/stop output;
- interrupt;
- canonical behavior state;
- health metrics;
- close and cleanup.

Provider-specific features não vazam para domínio; entram em capability metadata.

## Bake-off obrigatório

Testar pelo menos dois providers e audio-only baseline em:
- lip sync;
- listening behavior;
- interruption;
- PT-BR;
- warm-up;
- 10/30/60 min stability;
- concurrency;
- cost;
- data terms;
- fallback.

Nenhum provider é declarado vencedor neste documento.
