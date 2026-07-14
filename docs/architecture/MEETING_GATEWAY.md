# Meeting Gateway

## Objetivo

Conectar o mesmo Interaction Kernel a canais diferentes sem alterar domínio.

## Adapters

### Native Room
LiveKit ou transport WebRTC equivalente. Suporta áudio, vídeo, data, chat, captions, scene UI e handoff com maior controle.

### Meeting Bot
Provider como Recall.ai para Google Meet, Zoom, Teams e, quando aprovado, Webex. A documentação oficial atual do Recall Output Media confirma publicação de áudio e vídeo por uma webpage controlada. Lifecycle inclui scheduled, joining, waiting room, active, removed, reconnecting e done.

### Telephony
SIP via LiveKit ou Telnyx. Sem vídeo, scene vira áudio, SMS ou link seguro.

### Web Widget
Voz e texto; avatar opcional conforme dispositivo.

## Capability negotiation

Antes da sessão, adapter publica `provider_capability`:
- audio in/out;
- video avatar;
- screenshare;
- data channel;
- participant identity;
- captions;
- recording;
- handoff semantics;
- max duration;
- region;
- known limitations.

Scene e Behavior directors trabalham apenas dentro dessa capacidade.

## Meeting Edge Page

Para output media em reunião externa, uma página controlada renderiza avatar e scenes. Requisitos:
- CSP restritiva;
- token curto por bot;
- sem secrets no browser;
- heartbeat;
- audio unlock handling;
- GPU capability detection;
- fallback static avatar ou audio-only;
- URL assinada de uso único e origem allowlisted;
- nenhum iframe, navegação livre ou conteúdo remoto não aprovado;
- bloqueio de mixed content e exfiltração;
- separação entre camera layout e screenshare layout.

## Admission e disclosure

Bot possui nome indicando agente virtual. Waiting room e host rejection são estados visíveis. Não tentar contornar admissão ou políticas da plataforma.

## Falhas

- removido: encerrar output, salvar estado e notificar;
- waiting timeout: oferecer sala nativa;
- output media falha: audio endpoint ou sala nativa;
- host desabilita camera: voice-only;
- platform change: circuit breaker por adapter version.
