# ADR-006 — Meet/Zoom via Recall.ai Output Media (F3), não SDKs nativos
**Status:** Aceito · 2026-07-13
**Contexto:** Entrar em Google Meet/Zoom/Teams como participante que FALA e mostra vídeo exige bots headless por plataforma — manutenção pesada e quebradiça. Recall.ai oferece bot unificado com Output Media (áudio+vídeo de saída) por ~US$0,80/h (verificar na contratação).
**Decisão:** `ChannelAdapter` próprio com implementação Recall.ai na F3; nossa pipeline gera o áudio/vídeo, Recall transporta. Anúncio de gravação/consentimento conforme COMPLIANCE §3.
**Alternativas rejeitadas:** Bots próprios com SDKs/headless Chrome (meses de manutenção, quebra a cada update das plataformas); adiar para sempre (reuniões agendadas em Meet são caso de uso central de closers B2B).
**Consequências:** + 3 plataformas com 1 integração; time zero de manutenção de bots. − custo/h adicional; dependência de terceiro para feature-chave (mitigada: Sala Axtro própria continua sendo o canal primário).
