# ADR-003 — LiveKit Cloud como infraestrutura realtime (salas, SFU, SIP, data channel)
**Status:** Aceito · 2026-07-13
**Contexto:** Precisamos de WebRTC gerenciado para a Sala Axtro, ponte SIP para telefonia (Telnyx), data channel para sugestões do Axtro Agent, e SDK de agentes server-side maduro em Python.
**Decisão:** LiveKit Cloud (~US$0,0075/participante-min cotado 2026-07-13) com LiveKit Agents (Python) no realtime-worker; SIP trunk Telnyx via LiveKit SIP; plano de saída = LiveKit OSS self-host (mesma API) avaliado na F5.
**Alternativas rejeitadas:** Daily/Agora (SDK de agentes menos maduro p/ nosso caso); Vapi/Retell (orquestração pronta = nosso diferencial terceirizado + custo/min de plataforma); WebRTC próprio (meses de infra).
**Consequências:** + velocidade, SIP e data channel resolvidos, caminho de saída real. − dependência de um vendor no coração do realtime (mitigada pela paridade OSS).
