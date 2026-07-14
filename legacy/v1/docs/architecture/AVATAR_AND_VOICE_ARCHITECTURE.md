# AVATAR_AND_VOICE_ARCHITECTURE

## A. Avatar Provider Layer (`packages/avatar-gateway`, Fase 2)
Interface normalizada (nenhuma regra comercial acoplada ao fornecedor):
```ts
interface AvatarProvider {
  createSession(cfg: AvatarSessionCfg): Promise<AvatarSession> // persona_id, resolucao, idioma
  warmup(persona_id: string): Promise<void>                    // pool pre-cliente
  sendAudio(s, frame): void                                     // audio -> labial
  onVideo(s, cb): void
  interrupt(s): Promise<void>                                   // corte <=250ms
  setExpression(s, e: Expression): void                         // neutro|sorriso|atencao|preocupado|entusiasmo
  setIdle(s, m: IdleMode): void                                 // listening|thinking|presenting
  gesture(s, g: Gesture): void
  end(s): Promise<Metrics>                                      // custo, drift labial, erros
}
```
- **Primário: Tavus CVI** (Phoenix-4; preços públicos: overage US$0,32–0,37/min, Starter US$59/100min, Growth US$397/1.250min; mesmo pipeline serve áudio-only — tavus.io/pricing, acesso 2026-07-13). Motivos: latência WebRTC, perception, white-label enterprise. Nota técnica: CVI usa Daily por baixo; nossa ponte injeta o áudio do nosso pipeline e recebe o vídeo, publicando na sala LiveKit — o Sales Engine permanece nosso.
- **Candidatos avaliados p/ 2º provider**: Beyond Presence (foco em agentes ao vivo), HeyGen Interactive/LiveAvatar (biblioteca grande), Hedra (qualidade emergente), D-ID (custo). Bench trimestral com métricas: TVFB, drift labial, custo/min, expressividade, PT-BR.
- **Fallback universal**: modo somente-voz com card visual do agente (nome+foto estática) — sempre disponível.
- **Warm-up**: pool por tenant/persona aquecido T-2min do horário agendado; inbound usa pool global pequeno. Meta: avatar visível ≤2.5s (budget em REALTIME §4).
- Clonagem de rosto/voz de pessoa real: somente com evidência de autorização arquivada (COMPLIANCE §biometria); revogação remove persona em ≤72h.

## B. Voice Gateway (`packages/voice-gateway`, Fase 1)
Separação estrita de capacidades, cada uma com registry+fallback:
| Capacidade | Primário | Fallbacks | Notas |
|---|---|---|---|
| STT streaming | Deepgram (PT-BR) | OpenAI transcribe → Google | interim results p/ classificadores |
| TTS streaming | ElevenLabs Flash (qualidade PT-BR) | Cartesia Sonic (latência/custo) → Azure | seleção por tenant/estilo |
| S2S | OpenAI Realtime | Gemini Live (avaliar) | atrás de flag |
| VAD | Silero local | webrtc-vad | adaptativo |
| Turn detection | modelo semântico leve (LiveKit turn-detector) | heurística de pausa | ver REALTIME §3 |
| Noise suppression | LiveKit/Krisp opcional | — | por canal |
| Diarização | Deepgram diarize (Meet/Zoom multi-falante) | — | mapeia roster |
| Language detection | Deepgram/fasttext | — | troca voz/idioma mid-call só com confirmação |

### Normalização e pronúncia (obrigatório pré-TTS)
Pipeline: números→extenso (moeda, %, telefone soletrado em blocos), datas→fala natural, e-mails→"nome, arroba, dominio, ponto com", siglas→dicionário, **glossário por tenant** (termo→IPA/alias, ex.: nomes próprios, marcas), remoção de qualquer marcação interna (nunca "abrir parênteses", nunca tags). Estilo: `SpeechStyle{emotion, rate 0.9–1.15, pitch ±2st, pausas}` mapeado do contexto (HUMANLIKE §2). Proteção: lista de bloqueio impede síntese de segredos/IDs internos.
