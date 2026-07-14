# Verificação de capacidades de providers em 2026-07-14

Este documento congela o que foi confirmado em documentação oficial durante a auditoria. Não escolhe vencedor e não substitui benchmark.

## Decisões confirmadas

### OpenAI Realtime

- suporta streaming de áudio e tool calling;
- pode ser conectado por WebRTC ou WebSocket;
- server-side controls permitem manter tools, políticas e segredos no servidor;
- a sessão Realtime possui duração máxima documentada de 60 minutos.

**Ação de arquitetura:** cada adapter realtime declara `max_session_duration`. O Session Runtime cria uma nova lease antes do limite, transfere contexto canônico e troca a geração de forma cercada por epoch. Se o rollover falhar, degrada para pipeline modular sem perder o estado de domínio.

### LiveKit

- funciona como transport e participant boundary para agents;
- o turn detector atual combina conteúdo e sinais acústicos como entonação, pitch e ritmo;
- existe suporte multilíngue, inclusive português;
- há múltiplos plugins de avatar;
- Hedra aparece como deprecated na documentação atual.

**Ação de arquitetura:** o Turn Coordinator não depende apenas de silêncio. Avatar é adapter substituível e Hedra não entra na shortlist atual.

### Recall.ai Output Media

- permite que uma webpage controlada publique áudio e vídeo;
- suporta Zoom, Google Meet, Microsoft Teams e Cisco Webex;
- a página pode sair como câmera ou screenshare.

**Ação de arquitetura:** a Meeting Edge Page é um runtime não confiável e efêmero. Usa CSP restritiva, URL assinada, token curto, sem segredo, heartbeat, capability detection e fallback.

### Custos públicos datados

- LiveKit publica componentes separados para agent session, WebRTC, gravação, observabilidade e inferência;
- Recall publica pay-as-you-go por hora;
- Tavus publica minutos incluídos e concorrência por plano;
- Deepgram publica preços por minuto e modelo;
- ElevenLabs publica preços por caracteres ou minuto conforme produto;
- Telnyx separa Voice API e tarifa SIP.

**Ação de arquitetura:** o Cost Event Ledger registra quantidade, unidade, rate card, fonte, data, estimado versus medido e invoice reconciliation.

## O que ainda não está confirmado

- naturalidade do avatar em PT-BR;
- consistência de lip sync em chamadas longas;
- comportamento durante escuta e interrupção;
- latência p95 na região dos clientes;
- confiabilidade em waiting rooms e mudanças de plataforma;
- limites reais de concorrência aprovados para a conta;
- termos de uso para cada vertical;
- preço enterprise e descontos;
- segurança e retenção contratadas.

## Gate de promoção

Um provider somente pode sair de `candidate` para `approved_for_pilot` após:

1. contrato de adapter completo;
2. testes de cancelamento e fallback;
3. cenário de 10, 30 e 60 minutos, respeitando limites de sessão;
4. teste PT-BR com nomes, números, moedas e interrupções;
5. relatório de custo medido;
6. revisão de privacidade e termos;
7. decisão registrada em ADR ou `DECISIONS_LOG.md`;
8. rollback comprovado.
