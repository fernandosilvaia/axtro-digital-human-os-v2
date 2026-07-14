# ADR-011 — Handoff quente com HandoffPacket padronizado (8 campos Silva) e humano na mesma sala
**Status:** Aceito · 2026-07-13
**Contexto:** Transferência IA→humano é onde a maioria dos concorrentes falha (vira "te mando um e-mail"). O Método Silva já define os 8 campos obrigatórios de passagem SDR→Closer — adotamos como contrato universal.
**Decisão:** `handoff_packet.schema.json` normativo (lead, SILVA com evidências, dor, urgência, alçada, orçamento, observações, compromissos assumidos pela IA); modos `warm_live` (humano entra na MESMA sala LiveKit, IA apresenta e sai/assiste), `scheduled_meeting`, `async_task`; notificação ≤10s (push+Telegram F1); IA verbaliza a transição sem quebrar o rapport; humano herda os compromissos registrados.
**Alternativas rejeitadas:** Transferência por nova ligação (perde contexto e momentum); resumo por e-mail apenas (não é handoff, é abandono); deixar formato livre por tenant (perde auditabilidade e treino).
**Consequências:** + continuidade real, métrica de aceite de handoff, material de coaching. − exige presença/plantão humano configurado por tenant (SLA de aceite monitorado, fallback automático para scheduled).
