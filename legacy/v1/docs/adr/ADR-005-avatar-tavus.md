# ADR-005 — Avatar de vídeo: Tavus CVI atrás de interface própria, voz-only como degradação
**Status:** Aceito · 2026-07-13
**Contexto:** Vídeo humanizado é diferencial de F2, mas é o item mais caro do custo/min (Tavus Growth US$397/1.250min; overage ~US$0,32–0,37/min, cotado 2026-07-13) e com lock-in de réplicas.
**Decisão:** Integrar Tavus CVI (líder em conversational video, latência utterance-to-utterance ~sub-1s divulgada) via interface `AvatarProvider`; fallback automático para voz-only se warm-up >2,5s ou erro; mídia-fonte das réplicas arquivada para retreinar em concorrente; avatar é opt-in por sessão/plano.
**Alternativas rejeitadas:** HeyGen Interactive (segundo colocado — fica como plano B avaliado se Tavus falhar); D-ID (qualidade inferior nos testes públicos); modelo próprio (F6+, ver BUILD_VS_BUY).
**Consequências:** + melhor qualidade disponível sem P&D próprio; degradação graciosa protege a call. − custo/min alto pressiona pricing (planos com minutos de vídeo separados — UNIT_ECONOMICS); lock-in parcial mitigado mas real.
