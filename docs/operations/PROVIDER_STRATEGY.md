# Provider Strategy

## Regra

Escolher providers por benchmark reproduzível e capacidade contratual, não por demo ou marketing.

## Baseline proposto

- Media and rooms: LiveKit adapter.
- External meetings: Recall adapter.
- Realtime intelligence: modular pipeline baseline plus OpenAI Realtime adapter.
- STT: Deepgram or LiveKit Inference route as candidate.
- TTS: ElevenLabs, Cartesia or LiveKit Inference route as candidates.
- Avatar: at least two LiveKit-compatible or direct providers in bake-off.
- Telephony: Telnyx via SIP adapter.

Isso é shortlist, não seleção final.

## Adapter rules

- semantic contract first;
- no provider enum in domain state;
- capability negotiation;
- version pin;
- cost event per usage;
- provider-specific metadata isolated;
- fake and chaos adapter required.

## Procurement gates

Antes de produção:
- DPA and data terms;
- regions and subprocessors;
- retention and deletion API;
- rate and concurrency limits;
- SLA and incident process;
- pricing and minimum commitment;
- export and termination path;
- custom voice/avatar rights.
