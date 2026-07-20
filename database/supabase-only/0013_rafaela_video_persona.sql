-- Rafaela (agente 019f6de0-...-0a0001, tenant demo) ganha persona Tavus
-- própria com o Cérebro Método Silva: voz ElevenLabs pt-BR, percepção
-- raven-1 comportamental e tools de apresentação (next_slide /
-- previous_slide / go_to_slide). Persona criada via API nesta sessão:
-- p8966676f4d2. Idempotente (upsert por PK tenant+agent).

BEGIN;

insert into public.agent_video_config (tenant_id, agent_id, tavus_persona_id, language)
values (
  (select tenant_id from public.agents where id = '019f6de0-0000-7000-8000-0000000a0001'),
  '019f6de0-0000-7000-8000-0000000a0001',
  'p8966676f4d2',
  'portuguese'
)
on conflict (tenant_id, agent_id) do update
set tavus_persona_id = excluded.tavus_persona_id,
    tavus_replica_id = null,
    language = excluded.language;

COMMIT;
