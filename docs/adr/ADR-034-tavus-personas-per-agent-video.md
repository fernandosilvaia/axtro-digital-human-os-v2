# ADR-034: Persona Tavus por agente (voz, percepção, interrupção) e config de vídeo tenant-scoped

**Status:** aceito (2026-07-16) · **Relacionados:** ADR-033, D-V2-064, D-V2-065

## Contexto

O primeiro agente de vídeo (Rafaela) usava o modo réplica do Tavus: um rosto
stock + contexto por chamada, herdando a voz padrão da réplica — que tem
sotaque americano ao falar português. O usuário pediu um agente institucional
da Axtro com voz brasileira natural, excelente lip sync, análise de
comportamento do interlocutor, baixa latência e sensibilidade a interrupção.

No Tavus, essas qualidades vivem na **persona** (bundle de camadas: TTS/voz,
`raven-1` de percepção, STT com `smart_turn_detection` e sensibilidade a
interrupção), separada da réplica (o rosto). Uma persona também carrega seu
próprio `system_prompt`/`context`.

## Decisão

1. Persona "Aurora — Axtro AI Institucional" criada no Tavus (`pdd6c8593976`)
   com: percepção `raven-1` (análise de comportamento), STT `tavus-advanced`
   com `participant_interrupt_sensitivity: high` + `smart_turn_detection`, e
   TTS Cartesia falando português (idioma forçado na conversa). O prompt
   apresenta a Axtro e conduz para o agendamento de um diagnóstico gratuito.
2. O adapter `@axtro/provider-tavus` ganhou **modo persona**: `createConversation`
   aceita `personaId` (envia `persona_id` + `language`, dispensa contexto) OU
   `replicaId` (modo antigo da Rafaela, intacto). Mesmos guardrails.
3. Nova tabela tenant-scoped `agent_video_config(tenant_id, agent_id,
   tavus_persona_id, tavus_replica_id, language)` (supabase-only 0009) + RPC
   `portal_agent_video_config`. A action de vídeo lê a config do agente: se
   houver persona, usa modo persona; senão cai no replica-padrão global.

## Consequências e limites honestos

- **Sotaque:** Azure `pt-BR-*Neural` (locale-travado, garantia de BR) retorna
  HTTP 500 nesta conta Tavus — só Cartesia funciona aqui. Cartesia falando
  português produz um resultado decente, mas eu **não consigo ouvir/julgar o
  áudio nem o lip sync deste ambiente** — quem valida o feel humano é o
  Fernando. Se o sotaque não soar nativo, o upgrade garantido é uma voz
  brasileira do ElevenLabs (engine suportado pelo Tavus), o que exige uma
  `ELEVENLABS_API_KEY` no Doppler — próximo "pegar uma chave".
- Latência, lip sync e qualidade de imagem são propriedades do Tavus + rede;
  ajustáveis na persona, não no nosso código.
- A troca de voz/rosto é uma atualização de persona no Tavus (ou uma linha em
  `agent_video_config`), sem deploy de código.
