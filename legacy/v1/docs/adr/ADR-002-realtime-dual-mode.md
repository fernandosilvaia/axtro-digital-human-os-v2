# ADR-002 — Conversação realtime dual-mode: pipeline STT→LLM→TTS default, S2S atrás de flag
**Status:** Aceito · 2026-07-13
**Contexto:** Precisamos de latência humana (EOT→áudio p50 ≤0,8s) com controle fino (guardrails, injeção de estado, validador de preço) e custo previsível. Modelos speech-to-speech (OpenAI Realtime) são impressionantes mas caros (~US$0,10+/min, cotado 2026-07-13), menos controláveis (difícil interceptar entre "pensar" e "falar") e com PT-BR variável.
**Decisão:** Pipeline componível como default (Deepgram → Model Gateway/Haiku → ElevenLabs Flash, tudo streaming, com classificadores paralelos), interface `ConversationPipeline` que também aceita implementação S2S habilitável por flag por tenant/agente para A/B.
**Alternativas rejeitadas:** S2S como default (custo+controle); pipeline sem abstração (impede A/B futuro); construir ASR/TTS próprios (absurdo no estágio).
**Consequências:** + interceptação total (estado, guardrails, preço) entre estágios; custo ~3-5x menor; troca de provider por estágio. − mais partes móveis; engenharia de latência é nossa responsabilidade (budgets por estágio, hedging).
