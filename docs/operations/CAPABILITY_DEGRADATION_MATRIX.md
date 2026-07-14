# Capability and Degradation Matrix

| Failure | User experience | System action | Data action |
|---|---|---|---|
| Avatar unavailable | voice continues, visual fallback | disable avatar for session | health event and cost stop |
| TTS primary down | brief pause, fallback voice | switch adapter | record provider failure |
| STT degraded | ask repetition or use alternate | lower confidence, fallback | do not persist uncertain fact |
| S2S down | switch modular pipeline | rebuild context | new provider session ref |
| RAG down | state known limits | no unsupported claims | create incident metric |
| Tool timeout | say still pending or cannot confirm | receipt unknown and reconcile | no duplicate retry |
| Axtro daemon down | no visible impact | stop suggestions | health only |
| Meeting bot removed | explain via alternate channel if possible | terminate or offer native room | save timeline |
| Network poor | reduce video or voice-only | change mode | quality metrics |
| Budget reached | no premium features or end per policy | block new spend | budget event |
