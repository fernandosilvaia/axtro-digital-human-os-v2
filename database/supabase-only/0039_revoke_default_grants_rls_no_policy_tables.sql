-- Achado P2 (onda 7, D-V2-116): 6 das 7 tabelas com RLS habilitada e ZERO
-- policies (agent_brain_config, agent_video_config, conversation_transcripts,
-- meeting_bot_sessions, tenant_cost_alerts, tenant_subscriptions) nunca
-- revogaram o GRANT ALL padrão que o Supabase concede a anon/authenticated
-- na criação de qualquer tabela em public (default ACL do schema, confirmado
-- via pg_default_acl). Só tenant_invites (0006) e user_tenant_memberships
-- (0002) fizeram esse revoke explicitamente desde o início do projeto.
--
-- Hoje isto é seguro: RLS forçada + zero policies = Postgres nega toda
-- operação de anon/authenticated, com ou sem o GRANT. O acesso real sempre
-- foi via RPC SECURITY DEFINER (dono da função, não depende do grant da
-- tabela). Este é hardening de defesa-em-profundidade: se uma policy futura
-- for adicionada com uma condição errada (ex.: `USING (true)` copiada por
-- engano de outra tabela), o GRANT ALL preexistente faria essa policy valer
-- IMEDIATAMENTE para INSERT/UPDATE/DELETE também, não só o comando que a
-- policy pretendia cobrir. Revogar agora fecha essa rede de segurança sem
-- mudar nenhum comportamento observável hoje.

BEGIN;

revoke all on table public.agent_brain_config from authenticated, anon, public;
revoke all on table public.agent_video_config from authenticated, anon, public;
revoke all on table public.conversation_transcripts from authenticated, anon, public;
revoke all on table public.meeting_bot_sessions from authenticated, anon, public;
revoke all on table public.tenant_cost_alerts from authenticated, anon, public;
revoke all on table public.tenant_subscriptions from authenticated, anon, public;

COMMIT;
