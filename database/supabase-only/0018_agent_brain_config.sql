-- Segredo por agente para o cérebro customizado (M4-03, D-V2-08x): permite
-- que o endpoint HTTP que o Tavus chama como LLM da persona (layers.llm.base_url,
-- M4-04) resolva tenant + agente a partir de um bearer opaco, sem sessão de
-- Supabase Auth (é uma chamada servidor-a-servidor, não um usuário logado).
--
-- Mesmo padrão de agent_video_config (0009): tenant-scoped, RLS forçada,
-- RPCs SECURITY DEFINER resolvidas por auth.uid() para todo acesso do
-- portal. O segredo BRUTO nunca é gerado nem lido em SQL — o hash sha256 é
-- calculado na aplicação (crypto.randomBytes + createHash, mesma disciplina
-- de nunca gerar material aleatório sensível no banco já usada no resto do
-- projeto) e só o hash entra aqui; a rotação devolve o segredo bruto ao
-- chamador (server action) para exibição única, nunca persistido.

BEGIN;

create table if not exists public.agent_brain_config (
  tenant_id app.uuid_v7 not null,
  agent_id app.uuid_v7 not null,
  secret_hash text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now(),
  primary key (tenant_id, agent_id),
  foreign key (tenant_id, agent_id) references public.agents(tenant_id, id) on delete cascade,
  constraint agent_brain_config_secret_hash_fmt check (secret_hash ~ '^[a-f0-9]{64}$')
);

-- Lookup pelo endpoint HTTP (service role, sem RLS, sem auth.uid()): o hash
-- do bearer recebido é a única credencial — precisa ser único e indexado.
create unique index if not exists agent_brain_config_secret_hash_idx
  on public.agent_brain_config (secret_hash);

alter table public.agent_brain_config enable row level security;
alter table public.agent_brain_config force row level security;

-- Gera/rotaciona: recebe o hash já calculado na aplicação, nunca o segredo
-- bruto. Requer tenant_admin — habilitar um LLM externo na persona é uma
-- mudança de superfície de risco, não uma preferência de UI.
create or replace function public.portal_rotate_agent_brain_secret(p_agent_id app.uuid_v7, p_secret_hash text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
  v_agent_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id, role into v_tenant, v_role
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if v_role <> 'tenant_admin' then
    raise exception 'only a tenant_admin can manage the agent brain secret' using errcode = '42501';
  end if;
  if p_secret_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'secret_hash must be a lowercase hex sha256 digest' using errcode = '22023';
  end if;

  select exists(select 1 from public.agents where tenant_id = v_tenant and id = p_agent_id) into v_agent_exists;
  if not v_agent_exists then
    raise exception 'agent not found for this account' using errcode = '42501';
  end if;

  insert into public.agent_brain_config (tenant_id, agent_id, secret_hash, enabled, rotated_at)
  values (v_tenant, p_agent_id, p_secret_hash, true, now())
  on conflict (tenant_id, agent_id)
  do update set secret_hash = excluded.secret_hash, enabled = true, rotated_at = now();

  return jsonb_build_object('ok', true, 'rotated_at', now());
end;
$$;

revoke all on function public.portal_rotate_agent_brain_secret from public, anon;
grant execute on function public.portal_rotate_agent_brain_secret to authenticated;

-- Kill switch rápido, sem rotacionar o segredo.
create or replace function public.portal_set_agent_brain_enabled(p_agent_id app.uuid_v7, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id, role into v_tenant, v_role
  from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    raise exception 'no tenant provisioned' using errcode = '42501';
  end if;
  if v_role <> 'tenant_admin' then
    raise exception 'only a tenant_admin can manage the agent brain secret' using errcode = '42501';
  end if;

  update public.agent_brain_config set enabled = p_enabled
  where tenant_id = v_tenant and agent_id = p_agent_id;
  if not found then
    raise exception 'brain secret not configured for this agent yet' using errcode = '42501';
  end if;

  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end;
$$;

revoke all on function public.portal_set_agent_brain_enabled from public, anon;
grant execute on function public.portal_set_agent_brain_enabled to authenticated;

-- Status para a UI: nunca o segredo, nunca o hash.
create or replace function public.portal_agent_brain_status(p_agent_id app.uuid_v7)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  v_tenant app.uuid_v7;
  v_row public.agent_brain_config%rowtype;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id = auth.uid();
  if v_tenant is null then
    return jsonb_build_object('configured', false);
  end if;
  select * into v_row from public.agent_brain_config where tenant_id = v_tenant and agent_id = p_agent_id;
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object('configured', true, 'enabled', v_row.enabled, 'rotated_at', v_row.rotated_at);
end;
$$;

revoke all on function public.portal_agent_brain_status from public, anon;
grant execute on function public.portal_agent_brain_status to authenticated;

COMMIT;
