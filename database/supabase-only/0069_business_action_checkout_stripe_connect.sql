-- ADR-040: cobranca do cliente final do tenant via Stripe Connect Standard,
-- cobranca direta (Direct charges). Quarta acao de negocio sob o mesmo
-- BusinessActionIntent do ADR-039 (register_lead, propose_meeting_slots,
-- confirm_meeting_slot), agora somando request_checkout.
--
-- NUMERACAO: o texto do ADR-040 (escrito 2026-08-25, revisado 2026-08-28)
-- reserva "a proxima migration livre, 0052" para este dominio. Isso ficou
-- desatualizado: 0052 ja foi tomada pela onda 1b do proprio ADR-039
-- (business_action_calendar_scheduling), e a cadeia local ja chegou a 0068
-- antes deste arquivo ser escrito. A proxima migration livre de verdade e
-- 0069; nenhum numero ja usado e reaproveitado aqui.
--
-- APROVACAO HUMANA OBRIGATORIA (decisao de Fernando Silva, 2026-08-28,
-- revisao do ADR): diferente das outras tres acoes de negocio,
-- request_checkout nunca fica pronta pra prospect dentro da propria call. A
-- admissao cria uma linha em pending_approval (nenhuma chamada a Stripe
-- acontece nesse estado); um tenant_admin aprova ou rejeita depois, quase
-- sempre fora da call. So a aprovacao abre o fence pending_approval->reserved
-- que o resto do funil (dispatch/commit) ja conhece do padrao ADR-036.
--
-- DUAS CAMADAS DE FLAG, EM CIMA DO PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED DO
-- ADR-039: PORTAL_BUSINESS_ACTION_CHECKOUT_ENABLED (variavel de ambiente,
-- checada em codigo de aplicacao, nao em SQL) e checkout_enabled (coluna por
-- agente em portal_business_action_agent_settings, tenant_admin controla,
-- default false). As duas comecam false em todo ambiente, inclusive
-- producao, e assim permanecem ate a revisao de seguranca/compliance do
-- fluxo Stripe Connect (gate de pre-lancamento do proprio ADR, nao bloqueia
-- o inicio do codigo).
--
-- ESCOPO V1 (decisao explicita do ADR): cobranca unica (mode: "payment"),
-- sem assinatura recorrente pro cliente final, sem reembolso dentro do
-- Portal, sem desconto, sem carrinho multi-produto, moeda unica (USD).
--
-- CUSTODIA: cobranca direta com conta Standard nao precisa persistir nenhuma
-- credencial da conta conectada. So o stripe_account_id (nao secreto) fica
-- guardado; o access_token que a Stripe devolve na troca OAuth e descartado
-- pela aplicacao depois de confirmar a conexao (fora do escopo desta
-- migration). Isso mantem o Portal com exatamente um segredo por tenant no
-- Supabase Vault (o do Google Calendar, ADR-039).
begin;

-- Uma linha por tenant: a conta Stripe conectada e as tres capacidades que a
-- propria Stripe expoe, sincronizadas pelo webhook account.updated (evento
-- assinado, aplicado por portal_sync_stripe_connect_capabilities_service
-- abaixo). platform_fee_bps fica nulo por padrao: o percentual em si e
-- decisao comercial pendente do Fernando (ADR-040, gate de pre-lancamento),
-- este esquema so garante que a estrutura ja suporta o valor quando for
-- decidido, sem exigir migration nova. stripe_account_id e unique (nao so
-- tenant_id): sem isso, dois tenants poderiam acabar com a mesma conta
-- conectada e portal_resolve_stripe_connect_tenant_service (usado pelo
-- webhook para resolver tenant a partir do account.updated, que nao carrega
-- tenant_id nenhum na propria Stripe) teria mais de um tenant candidato para
-- o mesmo evento assinado.
create table public.portal_business_action_checkout_connections (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  stripe_account_id text not null,
  status text not null default 'connected',
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  platform_fee_bps integer,
  connected_by_actor_id app.uuid_v7 not null,
  connected_at timestamptz not null default now(),
  disconnected_by_actor_id app.uuid_v7,
  disconnected_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,connected_by_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  foreign key (tenant_id,disconnected_by_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  constraint portal_business_action_checkout_connections_tenant_key unique (tenant_id),
  constraint portal_business_action_checkout_connections_account_key unique (stripe_account_id),
  constraint portal_business_action_checkout_connections_status_chk check (status in ('connected','restricted','disconnected')),
  constraint portal_business_action_checkout_connections_account_chk check (stripe_account_id ~ '^acct_[A-Za-z0-9]{1,255}$'),
  constraint portal_business_action_checkout_connections_fee_chk check (platform_fee_bps is null or platform_fee_bps between 0 and 10000),
  constraint portal_business_action_checkout_connections_disconnected_chk check ((status='disconnected')=(disconnected_at is not null and disconnected_by_actor_id is not null))
);
alter table public.portal_business_action_checkout_connections enable row level security;
alter table public.portal_business_action_checkout_connections force row level security;
revoke all on table public.portal_business_action_checkout_connections from public,anon,authenticated,service_role;

-- O catalogo fechado que o tenant_admin configura antes da call (tela fora
-- do escopo de codigo deste ADR, o contrato de dados e o que fixa aqui). O
-- modelo nunca informa preco, produto ou desconto por texto livre: request_checkout
-- so aceita um product_id que precisa existir e estar active aqui.
create table public.portal_business_action_checkout_products (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  product_id text not null,
  display_name text not null,
  stripe_price_id text not null,
  unit_amount_cents bigint not null,
  currency text not null default 'usd',
  max_quantity integer not null default 1,
  active boolean not null default true,
  changed_by_actor_id app.uuid_v7 not null,
  changed_at timestamptz not null default now(),
  foreign key (tenant_id,changed_by_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  constraint portal_business_action_checkout_products_key unique (tenant_id,product_id),
  constraint portal_business_action_checkout_products_id_chk check (product_id ~ '^[a-z][a-z0-9_]{1,79}$'),
  constraint portal_business_action_checkout_products_name_chk check (char_length(display_name) between 1 and 200),
  constraint portal_business_action_checkout_products_price_chk check (stripe_price_id ~ '^price_[A-Za-z0-9]{1,255}$'),
  constraint portal_business_action_checkout_products_amount_chk check (unit_amount_cents between 1 and 99999999),
  constraint portal_business_action_checkout_products_currency_chk check (currency='usd'),
  constraint portal_business_action_checkout_products_qty_chk check (max_quantity between 1 and 100)
);
alter table public.portal_business_action_checkout_products enable row level security;
alter table public.portal_business_action_checkout_products force row level security;
revoke all on table public.portal_business_action_checkout_products from public,anon,authenticated,service_role;

-- A reserva durável no padrão ADR-036, com um estado inicial que nenhuma
-- outra reserva deste repositório tem: pending_approval, anterior a
-- reserved, sem nenhuma chamada a Stripe. Todo dado que o tenant_admin vai
-- aprovar ja nasce travado aqui (product_id/display_name/unit_amount_cents/
-- currency/stripe_price_id/stripe_account_id/platform_fee_bps snapshotados
-- no momento da reserva, nunca recalculados depois: o operador aprova
-- exatamente o que o prospect pediu na call). expired e distinto de
-- approval_expired: approval_expired e o prazo de 72h em pending_approval
-- esgotado sem acao (nunca tocou a Stripe); expired e o proprio webhook
-- checkout.session.expired da Stripe, so alcancavel depois de committed.
create table public.portal_business_action_checkout_reservations (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  agent_id app.uuid_v7 not null,
  session_id app.uuid_v7 not null,
  presenter_id app.uuid_v7 not null,
  grant_id app.uuid_v7 not null,
  lead_id app.uuid_v7,
  product_id text not null,
  display_name text not null,
  quantity integer not null default 1,
  unit_amount_cents bigint not null,
  currency text not null default 'usd',
  stripe_price_id text not null,
  stripe_account_id text not null,
  platform_fee_bps integer,
  application_fee_amount_cents bigint,
  contact_email text,
  state text not null default 'pending_approval',
  approval_expires_at timestamptz not null,
  approved_by app.uuid_v7,
  approved_at timestamptz,
  rejected_by app.uuid_v7,
  rejected_at timestamptz,
  rejection_reason text,
  stripe_idempotency_key text not null,
  stripe_checkout_session_id text,
  checkout_url text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  amount_total_cents bigint,
  failure_code text,
  release_evidence text,
  released_at timestamptz,
  reconciliation_attempts integer not null default 0,
  reconciliation_evidence_fingerprint text,
  reconciliation_outcome text,
  reconciliation_settled_at timestamptz,
  created_at timestamptz not null default now(),
  provider_dispatched_at timestamptz,
  committed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id) references public.sessions(tenant_id,id) on delete restrict,
  foreign key (tenant_id,session_id,presenter_id) references public.session_participants(tenant_id,session_id,id) on delete restrict,
  foreign key (tenant_id,grant_id) references public.portal_business_action_grants(tenant_id,id) on delete restrict,
  foreign key (tenant_id,lead_id) references public.portal_business_action_leads(tenant_id,id) on delete restrict,
  foreign key (tenant_id,approved_by) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  foreign key (tenant_id,rejected_by) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,grant_id),
  unique (tenant_id,stripe_idempotency_key),
  constraint portal_business_action_checkout_reservations_state_chk check (state in ('pending_approval','reserved','provider_in_flight','committed','unknown','released','rejected','approval_expired','expired','payment_completed','payment_failed')),
  constraint portal_business_action_checkout_reservations_product_chk check (product_id ~ '^[a-z][a-z0-9_]{1,79}$'),
  constraint portal_business_action_checkout_reservations_name_chk check (char_length(display_name) between 1 and 200),
  constraint portal_business_action_checkout_reservations_qty_chk check (quantity between 1 and 100),
  constraint portal_business_action_checkout_reservations_amount_chk check (unit_amount_cents between 1 and 99999999),
  constraint portal_business_action_checkout_reservations_currency_chk check (currency='usd'),
  constraint portal_business_action_checkout_reservations_price_chk check (stripe_price_id ~ '^price_[A-Za-z0-9]{1,255}$'),
  constraint portal_business_action_checkout_reservations_account_chk check (stripe_account_id ~ '^acct_[A-Za-z0-9]{1,255}$'),
  constraint portal_business_action_checkout_reservations_fee_bps_chk check (platform_fee_bps is null or platform_fee_bps between 0 and 10000),
  constraint portal_business_action_checkout_reservations_fee_amt_chk check (application_fee_amount_cents is null or application_fee_amount_cents>=0),
  constraint portal_business_action_checkout_reservations_email_chk check (contact_email is null or contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint portal_business_action_checkout_reservations_idem_chk check (char_length(stripe_idempotency_key) between 16 and 255),
  constraint portal_business_action_checkout_reservations_session_chk check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]{1,240}$'),
  constraint portal_business_action_checkout_reservations_url_chk check (checkout_url is null or (char_length(checkout_url)<=2000 and checkout_url ~ '^https://')),
  constraint portal_business_action_checkout_reservations_pi_chk check (stripe_payment_intent_id is null or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]{1,255}$'),
  constraint portal_business_action_checkout_reservations_charge_chk check (stripe_charge_id is null or stripe_charge_id ~ '^ch_[A-Za-z0-9]{1,255}$'),
  constraint portal_business_action_checkout_reservations_total_chk check (amount_total_cents is null or amount_total_cents>=0),
  constraint portal_business_action_checkout_reservations_failure_chk check (failure_code is null or char_length(failure_code)<=80),
  constraint portal_business_action_checkout_reservations_evidence_chk check (release_evidence is null or release_evidence in ('product_deactivated','stripe_disconnected')),
  constraint portal_business_action_checkout_reservations_release_chk check ((state='released')=(released_at is not null and release_evidence is not null)),
  constraint portal_business_action_checkout_reservations_approve_chk check ((approved_by is null)=(approved_at is null)),
  constraint portal_business_action_checkout_reservations_reject_chk check ((rejected_by is null)=(rejected_at is null)),
  constraint portal_business_action_checkout_reservations_approved_state_chk check (approved_by is null or state not in ('pending_approval')),
  constraint portal_business_action_checkout_reservations_rejected_state_chk check ((state='rejected')=(rejected_by is not null)),
  constraint portal_business_action_checkout_reservations_dispatch_chk check (
    (state in ('pending_approval','reserved','rejected','approval_expired') and provider_dispatched_at is null)
    or (state in ('provider_in_flight','committed','unknown','expired','payment_completed','payment_failed') and provider_dispatched_at is not null)
    or (state='released' and provider_dispatched_at is null)
  ),
  constraint portal_business_action_checkout_reservations_commit_chk check (
    (state in ('committed','expired','payment_completed','payment_failed') and committed_at is not null)
    or (state not in ('committed','expired','payment_completed','payment_failed') and committed_at is null)
  ),
  constraint portal_business_action_checkout_reservations_completed_chk check (
    (state in ('payment_completed','payment_failed') and completed_at is not null)
    or (state not in ('payment_completed','payment_failed') and completed_at is null)
  ),
  constraint portal_business_action_checkout_reservations_recon_attempt_chk check (reconciliation_attempts between 0 and 1000),
  constraint portal_business_action_checkout_reservations_recon_settle_chk check (
    (reconciliation_outcome is null and reconciliation_evidence_fingerprint is null and reconciliation_settled_at is null)
    or (reconciliation_outcome is not null and reconciliation_evidence_fingerprint is not null and reconciliation_settled_at is not null)
  ),
  constraint portal_business_action_checkout_reservations_recon_fp_chk check (reconciliation_evidence_fingerprint is null or reconciliation_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint portal_business_action_checkout_reservations_recon_out_chk check (reconciliation_outcome is null or reconciliation_outcome in ('committed','released'))
);
-- Um Checkout Session id da Stripe e global: a mesma garantia que
-- provider_effect_reservations.provider_ref_uidx (0040) e o event_uidx do
-- calendario (0052) ja aplicam pros respectivos identificadores de provider.
create unique index portal_business_action_checkout_reservations_session_uidx
  on public.portal_business_action_checkout_reservations(stripe_checkout_session_id) where stripe_checkout_session_id is not null;
-- Hot path pro worker de expiracao de pending_approval e pra dashboards de
-- status, mesmo padrao de portal_business_action_calendar_reservations_state_idx.
create index portal_business_action_checkout_reservations_state_idx
  on public.portal_business_action_checkout_reservations(tenant_id,state,created_at);
create index portal_business_action_checkout_reservations_pending_idx
  on public.portal_business_action_checkout_reservations(approval_expires_at) where state='pending_approval';
alter table public.portal_business_action_checkout_reservations enable row level security;
alter table public.portal_business_action_checkout_reservations force row level security;
revoke all on table public.portal_business_action_checkout_reservations from public,anon,authenticated,service_role;

-- Reconciliacao dual-operator pra uma reserva presa em unknown, mesmo
-- desenho de portal_business_action_meeting_reconcile_approvals (0052): uma
-- linha por (reserva, evidencia, operador), so finaliza quando dois
-- operadores distintos concordam no mesmo (evidence_fingerprint,outcome).
create table public.portal_business_action_checkout_reconcile_approvals (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  reservation_id app.uuid_v7 not null,
  evidence_fingerprint text not null,
  outcome text not null,
  operator_actor_id app.uuid_v7 not null,
  recorded_at timestamptz not null default now(),
  foreign key (tenant_id,reservation_id) references public.portal_business_action_checkout_reservations(tenant_id,id) on delete restrict,
  foreign key (tenant_id,operator_actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  constraint portal_business_action_checkout_reconcile_approvals_key unique (tenant_id,reservation_id,evidence_fingerprint,operator_actor_id),
  constraint portal_business_action_checkout_reconcile_approvals_fp_chk check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint portal_business_action_checkout_reconcile_approvals_out_chk check (outcome in ('committed','released'))
);
alter table public.portal_business_action_checkout_reconcile_approvals enable row level security;
alter table public.portal_business_action_checkout_reconcile_approvals force row level security;
revoke all on table public.portal_business_action_checkout_reconcile_approvals from public,anon,authenticated,service_role;

-- Dedup de evento do webhook de conta conectada (endpoint novo, segredo
-- novo, fora do escopo desta migration): event_id chave primaria, mesmo
-- padrao de billing_stripe_event_receipts (0040), mas para o dominio de
-- checkout do tenant em vez de assinatura da propria Axtro.
create table public.portal_business_action_checkout_stripe_event_receipts (
  event_id text primary key,
  event_type text not null,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  reservation_id app.uuid_v7,
  connected_account_id text not null,
  payload_fingerprint text not null,
  receipt_state text,
  receipt_applied boolean not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id,reservation_id) references public.portal_business_action_checkout_reservations(tenant_id,id) on delete restrict,
  constraint portal_business_action_checkout_stripe_event_id_chk check (event_id ~ '^evt_[A-Za-z0-9_]{1,251}$'),
  constraint portal_business_action_checkout_stripe_event_type_chk check (event_type in ('checkout.session.completed','checkout.session.expired','checkout.session.async_payment_failed','account.updated')),
  constraint portal_business_action_checkout_stripe_account_chk check (connected_account_id ~ '^acct_[A-Za-z0-9]{1,255}$'),
  constraint portal_business_action_checkout_stripe_fp_chk check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint portal_business_action_checkout_stripe_state_chk check (receipt_state is null or receipt_state in ('payment_completed','payment_failed','expired','capabilities_synced','ignored_stale','ignored_account_mismatch')),
  constraint portal_business_action_checkout_stripe_shape_chk check (
    (event_type='account.updated' and reservation_id is null)
    or (event_type<>'account.updated' and reservation_id is not null)
  )
);
alter table public.portal_business_action_checkout_stripe_event_receipts enable row level security;
alter table public.portal_business_action_checkout_stripe_event_receipts force row level security;
revoke all on table public.portal_business_action_checkout_stripe_event_receipts from public,anon,authenticated,service_role;

-- checkout_enabled: terceiro degrau de rollout dark por agente, default
-- false, o mesmo padrao de auto_confirm_scheduling que esta tabela ja tem
-- desde a 0051. changed_by_actor_id/changed_at seguem compartilhados entre
-- as duas colunas (a ultima alteracao, de qualquer uma das duas, e quem
-- fica registrada) -- simplificacao deliberada (Art. 17), nao uma omissao.
alter table public.portal_business_action_agent_settings add column checkout_enabled boolean not null default false;

-- O receipt de request_checkout referencia a reserva de cobranca (mesmo
-- padrao de proposal_id/reservation_id que 0052 ja somou pro calendario). O
-- outcome deste dominio nunca sai de pending_approval (ver comentario acima
-- da tabela de reservas), entao esta coluna e escrita uma unica vez, no
-- momento da propria reserva, e nunca mais tocada.
alter table public.portal_business_action_receipts add column checkout_reservation_id app.uuid_v7;
alter table public.portal_business_action_receipts add constraint portal_business_action_receipts_checkout_reservation_fkey
  foreign key (tenant_id,checkout_reservation_id) references public.portal_business_action_checkout_reservations(tenant_id,id) on delete restrict;

-- Amplia os tres allowlists de action_kind que 0051/0052 ja vinham
-- estreitando de proposito, somando request_checkout.
alter table public.portal_business_action_grants drop constraint portal_business_action_grants_action_chk;
alter table public.portal_business_action_grants add constraint portal_business_action_grants_action_chk
  check (action_kind in ('register_lead','propose_meeting_slots','confirm_meeting_slot','request_checkout'));

alter table public.portal_business_action_receipts drop constraint portal_business_action_receipts_action_chk;
alter table public.portal_business_action_receipts add constraint portal_business_action_receipts_action_chk
  check (action_kind in ('register_lead','propose_meeting_slots','confirm_meeting_slot','request_checkout'));

alter table public.portal_business_action_kill_switches drop constraint portal_business_action_kill_switches_action_chk;
alter table public.portal_business_action_kill_switches add constraint portal_business_action_kill_switches_action_chk
  check (action_kind is null or action_kind in ('register_lead','propose_meeting_slots','confirm_meeting_slot','request_checkout'));

-- Quinto valor de outcome, aditivo, ao lado dos quatro ja existentes
-- (ADR-040 "Fluxo de confirmacao"/"Aprovacao humana do tenant"):
-- request_checkout e a primeira acao de negocio cujo receipt nunca alcanca
-- 'succeeded'. succeeded continua valido pras outras tres acoes.
alter table public.portal_business_action_receipts drop constraint portal_business_action_receipts_outcome_chk;
alter table public.portal_business_action_receipts add constraint portal_business_action_receipts_outcome_chk
  check (outcome in ('succeeded','rejected','failed','unknown','pending_approval'));

-- Re-publicado com o allowlist mais largo. Byte-identico a 0052 fora disso:
-- request_checkout nao soma nenhum purpose de consent novo (usa so
-- disclosure + consentimento essencial, ja checados aqui pras outras tres
-- acoes) -- checkout_enabled e a conta Stripe conectada sao checados no
-- passo de reserva (portal_reserve_business_checkout_service abaixo), nao
-- na admissao, o mesmo raciocinio que ja vale pra auto_confirm_scheduling.
create or replace function public.portal_admit_business_action_service(
  p_grant_id app.uuid_v7,p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_session_id app.uuid_v7,p_presenter_id app.uuid_v7,
  p_action_kind text,p_command_fingerprint text,p_generation integer default 0
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_grant public.portal_business_action_grants%rowtype; v_agent public.agents%rowtype; v_session public.sessions%rowtype;
begin
  if p_action_kind not in ('register_lead','propose_meeting_slots','confirm_meeting_slot','request_checkout') or p_command_fingerprint !~ '^[0-9a-f]{64}$' or p_generation not between 0 and 10000000 then raise exception 'invalid business action admission' using errcode='22023'; end if;
  select * into v_grant from public.portal_business_action_grants where tenant_id=p_tenant_id and id=p_grant_id for update;
  if found then
    if row(v_grant.agent_id,v_grant.session_id,v_grant.presenter_id,v_grant.action_kind,v_grant.command_fingerprint,v_grant.generation)
       is distinct from row(p_agent_id,p_session_id,p_presenter_id,p_action_kind,p_command_fingerprint,p_generation) then raise exception 'business action admission replay conflict' using errcode='23505'; end if;
    return jsonb_build_object('outcome',case when v_grant.expires_at<=now() then 'expired' else 'replayed' end,'grantId',v_grant.id,'sessionId',v_grant.session_id,'generation',v_grant.generation,'expiresAt',v_grant.expires_at);
  end if;
  select * into v_agent from public.agents where tenant_id=p_tenant_id and id=p_agent_id; if not found then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  if v_agent.status<>'active' then return jsonb_build_object('outcome','agent_inactive'); end if;
  select * into v_session from public.sessions where tenant_id=p_tenant_id and id=p_session_id and agent_id=p_agent_id; if not found then raise exception 'business action session not found for tenant/agent' using errcode='42501'; end if;
  if app.portal_business_action_switch_disabled(p_tenant_id,p_agent_id,p_action_kind) then return jsonb_build_object('outcome','blocked_kill_switch'); end if;
  if v_session.active_presenter_id is distinct from p_presenter_id then return jsonb_build_object('outcome','presenter_mismatch'); end if;
  if v_session.disclosure_status<>'delivered' then return jsonb_build_object('outcome','denied_disclosure'); end if;
  if v_session.consent_status<>'granted' then return jsonb_build_object('outcome','denied_essential_consent'); end if;
  if p_action_kind='register_lead' and not exists(select 1 from public.consent_evidence where tenant_id=p_tenant_id and session_id=p_session_id and purpose='lead_data_capture' and status='granted') then
    return jsonb_build_object('outcome','denied_purpose_consent');
  end if;
  if p_action_kind='confirm_meeting_slot' and not exists(select 1 from public.consent_evidence where tenant_id=p_tenant_id and session_id=p_session_id and purpose='meeting_scheduling' and status='granted') then
    return jsonb_build_object('outcome','denied_purpose_consent');
  end if;
  begin
    insert into public.portal_business_action_grants(id,tenant_id,agent_id,session_id,presenter_id,action_kind,command_fingerprint,generation)
      values(p_grant_id,p_tenant_id,p_agent_id,p_session_id,p_presenter_id,p_action_kind,p_command_fingerprint,p_generation);
  exception when unique_violation then
    select * into v_grant from public.portal_business_action_grants where tenant_id=p_tenant_id and session_id=p_session_id and command_fingerprint=p_command_fingerprint for update;
    if not found then raise; end if;
    if row(v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,v_grant.generation)
       is distinct from row(p_agent_id,p_presenter_id,p_action_kind,p_generation) then raise exception 'business action admission replay conflict' using errcode='23505'; end if;
    return jsonb_build_object('outcome',case when v_grant.expires_at<=now() then 'expired' else 'replayed' end,'grantId',v_grant.id,'sessionId',v_grant.session_id,'generation',v_grant.generation,'expiresAt',v_grant.expires_at);
  end;
  return jsonb_build_object('outcome','issued','grantId',p_grant_id,'sessionId',p_session_id,'generation',p_generation,'expiresAt',now()+interval '60 minutes');
end $$;

create or replace function public.portal_business_action_status_service(p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_action_kind text)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
begin
  if p_action_kind not in ('register_lead','propose_meeting_slots','confirm_meeting_slot','request_checkout') or not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then return jsonb_build_object('enabled',false); end if;
  return jsonb_build_object('enabled',not app.portal_business_action_switch_disabled(p_tenant_id,p_agent_id,p_action_kind),'actionKind',p_action_kind);
end $$;

-- Grava a conexao Stripe ja resolvida (o code exchange code->stripe_user_id
-- acontece na aplicacao, contra a API da Stripe, fora do escopo desta
-- migration -- este RPC recebe so o stripe_account_id ja obtido, mesmo
-- raciocinio de portal_connect_google_calendar_service receber o refresh
-- token ja trocado). Nao persiste o access_token OAuth de proposito
-- (ADR-040 "Alternativas consideradas" #6): cobranca direta so precisa do
-- stripe_account_id, que nao e segredo.
create or replace function public.portal_complete_stripe_connect_service(
  p_id app.uuid_v7,p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7,p_stripe_account_id text
) returns jsonb language plpgsql security definer set search_path='public' as $$
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then
    raise exception 'stripe connect requires tenant admin' using errcode='42501';
  end if;
  if p_stripe_account_id !~ '^acct_[A-Za-z0-9]{1,255}$' then raise exception 'invalid stripe connected account id' using errcode='22023'; end if;

  begin
    insert into public.portal_business_action_checkout_connections(id,tenant_id,stripe_account_id,status,connected_by_actor_id,connected_at,updated_at)
      values(p_id,p_tenant_id,p_stripe_account_id,'connected',p_actor_id,now(),now())
    on conflict (tenant_id) do update set
      stripe_account_id=excluded.stripe_account_id,status='connected',charges_enabled=false,payouts_enabled=false,details_submitted=false,
      connected_by_actor_id=excluded.connected_by_actor_id,connected_at=now(),disconnected_by_actor_id=null,disconnected_at=null,updated_at=now();
  exception when unique_violation then
    -- stripe_account_id ja pertence a outro tenant (a mesma conta Stripe
    -- nao pode ficar conectada a dois tenants ao mesmo tempo: quebraria a
    -- resolucao de tenant por account.updated). Falha fechado com um
    -- outcome legivel em vez de deixar a excecao crua subir ate a aplicacao.
    return jsonb_build_object('outcome','account_already_connected_elsewhere');
  end;

  return jsonb_build_object('outcome','connected','tenantId',p_tenant_id,'stripeAccountId',p_stripe_account_id,'status','connected');
end $$;

-- Marca desconectado. Chamar o endpoint de desautorizacao da propria
-- Stripe e trabalho da aplicacao, fora do escopo aqui (mesmo padrao do
-- disconnect do Google Calendar). Nao invalida nenhuma reserva ja
-- committed: ela continua existindo do lado da Stripe independente desta
-- linha.
create or replace function public.portal_disconnect_stripe_service(p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_checkout_connections%rowtype;
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then
    raise exception 'stripe disconnect requires tenant admin' using errcode='42501';
  end if;
  select * into v_row from public.portal_business_action_checkout_connections where tenant_id=p_tenant_id for update;
  if not found then return jsonb_build_object('outcome','not_connected'); end if;
  if v_row.status='disconnected' then return jsonb_build_object('outcome','disconnected'); end if;

  update public.portal_business_action_checkout_connections
    set status='disconnected',disconnected_by_actor_id=p_actor_id,disconnected_at=now(),updated_at=now()
    where tenant_id=p_tenant_id;

  return jsonb_build_object('outcome','disconnected');
end $$;

-- Aplica o evento assinado account.updated: sincroniza as tres capacidades
-- que a Stripe expoe. Se charges_enabled virar falso depois de ter sido
-- verdadeiro, o status vira restricted e nenhuma reserva nova de cobranca e
-- admitida ate o tenant resolver a pendencia do lado da Stripe (checado em
-- portal_reserve_business_checkout_service abaixo). Reclama event_id antes
-- de aplicar qualquer efeito, mesmo padrao de billing_stripe_event_receipts.
create or replace function public.portal_sync_stripe_connect_capabilities_service(
  p_event_id text,p_tenant_id app.uuid_v7,p_stripe_account_id text,p_payload_fingerprint text,
  p_charges_enabled boolean,p_payouts_enabled boolean,p_details_submitted boolean
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_checkout_connections%rowtype; v_new_status text;
begin
  if p_event_id !~ '^evt_[A-Za-z0-9_]{1,251}$' or p_stripe_account_id !~ '^acct_[A-Za-z0-9]{1,255}$' or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid stripe connect capability sync payload' using errcode='22023';
  end if;

  begin
    insert into public.portal_business_action_checkout_stripe_event_receipts(event_id,event_type,tenant_id,connected_account_id,payload_fingerprint,receipt_applied)
      values(p_event_id,'account.updated',p_tenant_id,p_stripe_account_id,p_payload_fingerprint,false);
  exception when unique_violation then
    return jsonb_build_object('outcome','duplicate_event');
  end;

  select * into v_row from public.portal_business_action_checkout_connections where tenant_id=p_tenant_id and stripe_account_id=p_stripe_account_id for update;
  if not found then
    update public.portal_business_action_checkout_stripe_event_receipts set receipt_state='ignored_stale' where event_id=p_event_id;
    return jsonb_build_object('outcome','ignored_unknown_account');
  end if;

  v_new_status:=case when v_row.status='connected' and v_row.charges_enabled and not p_charges_enabled then 'restricted' else v_row.status end;
  update public.portal_business_action_checkout_connections
    set charges_enabled=p_charges_enabled,payouts_enabled=p_payouts_enabled,details_submitted=p_details_submitted,status=v_new_status,updated_at=now()
    where tenant_id=p_tenant_id and stripe_account_id=p_stripe_account_id;

  update public.portal_business_action_checkout_stripe_event_receipts set receipt_state='capabilities_synced',receipt_applied=true where event_id=p_event_id;
  return jsonb_build_object('outcome','synced','status',v_new_status);
end $$;

create or replace function public.portal_stripe_connect_status_service(p_tenant_id app.uuid_v7)
returns jsonb language sql stable security definer set search_path='public' as $$
  select coalesce(
    (select jsonb_build_object('outcome','found','stripeAccountId',stripe_account_id,'status',status,'chargesEnabled',charges_enabled,'payoutsEnabled',payouts_enabled,'detailsSubmitted',details_submitted,'platformFeeBps',platform_fee_bps)
     from public.portal_business_action_checkout_connections where tenant_id=p_tenant_id),
    jsonb_build_object('outcome','not_connected')
  )
$$;

-- O evento assinado account.updated da Stripe carrega o Account inteiro,
-- nunca metadata nossa: nao ha tenant_id nenhum no payload (diferente do
-- evento de checkout, que carrega metadata.tenant_id gravado por nos mesmos
-- na criacao da Checkout Session). O webhook precisa resolver o tenant a
-- partir so do stripe_account_id que a propria Stripe manda em event.account,
-- e so pode fazer isso com seguranca porque stripe_account_id e unique nesta
-- tabela (constraint acima). service_role-only, nunca exposto a authenticated.
create or replace function public.portal_resolve_stripe_connect_tenant_service(p_stripe_account_id text)
returns jsonb language sql stable security definer set search_path='public' as $$
  select coalesce(
    (select jsonb_build_object('outcome','found','tenantId',tenant_id)
     from public.portal_business_action_checkout_connections where stripe_account_id=p_stripe_account_id),
    jsonb_build_object('outcome','not_found')
  )
$$;

-- Re-publicado (mesmo raciocinio do widening de portal_admit_business_action_service
-- acima): checkout_enabled e o terceiro degrau de rollout dark por agente
-- que o ADR-040 pede, mas nenhum RPC deste repositorio ainda sabia gravar
-- essa coluna nova. Assinatura widened; a nova coluna pode ser omitida
-- (default null preserva o valor atual) pra nao forcar todo chamador
-- existente a passar um quinto argumento. DROP explicito primeiro: um
-- CREATE OR REPLACE que so acrescenta um parametro com default cria um
-- SEGUNDO overload em vez de substituir o antigo (Postgres identifica
-- funcao por nome+tipos dos parametros), mesma licao ja aplicada em 0068
-- pro portal_set_agent_video_config.
drop function if exists public.portal_set_business_action_agent_settings_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean);
create or replace function public.portal_set_business_action_agent_settings_service(
  p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7,p_agent_id app.uuid_v7,p_auto_confirm_scheduling boolean,p_checkout_enabled boolean default null
) returns boolean language plpgsql security definer set search_path='public' as $$
declare v_existing public.portal_business_action_agent_settings%rowtype;
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then raise exception 'business action agent settings requires tenant admin' using errcode='42501'; end if;
  if not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  select * into v_existing from public.portal_business_action_agent_settings where tenant_id=p_tenant_id and agent_id=p_agent_id;
  insert into public.portal_business_action_agent_settings(tenant_id,agent_id,auto_confirm_scheduling,checkout_enabled,changed_by_actor_id,changed_at)
    values(p_tenant_id,p_agent_id,p_auto_confirm_scheduling,coalesce(p_checkout_enabled,coalesce(v_existing.checkout_enabled,false)),p_actor_id,now())
  on conflict (tenant_id,agent_id) do update set
    auto_confirm_scheduling=excluded.auto_confirm_scheduling,
    checkout_enabled=coalesce(p_checkout_enabled,portal_business_action_agent_settings.checkout_enabled),
    changed_by_actor_id=excluded.changed_by_actor_id,changed_at=excluded.changed_at;
  return true;
end $$;

-- Cadastro/atualizacao do catalogo pelo tenant_admin. A verificacao do
-- preco vivo contra a conta conectada no momento do cadastro (ADR-040) e
-- uma chamada de rede: acontece na aplicacao antes de chamar este RPC, que
-- so persiste o que ja foi confirmado.
create or replace function public.portal_upsert_business_checkout_product_service(
  p_id app.uuid_v7,p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7,p_product_id text,
  p_display_name text,p_stripe_price_id text,p_unit_amount_cents bigint,p_max_quantity integer default 1
) returns jsonb language plpgsql security definer set search_path='public' as $$
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then
    raise exception 'checkout catalog requires tenant admin' using errcode='42501';
  end if;
  if p_product_id !~ '^[a-z][a-z0-9_]{1,79}$' then raise exception 'invalid checkout product id' using errcode='22023'; end if;
  if char_length(coalesce(p_display_name,'')) not between 1 and 200 then raise exception 'invalid checkout product display name' using errcode='22023'; end if;
  if p_stripe_price_id !~ '^price_[A-Za-z0-9]{1,255}$' then raise exception 'invalid stripe price id' using errcode='22023'; end if;
  if p_unit_amount_cents not between 1 and 99999999 then raise exception 'invalid checkout product amount' using errcode='22023'; end if;
  if p_max_quantity not between 1 and 100 then raise exception 'invalid checkout product max quantity' using errcode='22023'; end if;

  insert into public.portal_business_action_checkout_products(id,tenant_id,product_id,display_name,stripe_price_id,unit_amount_cents,currency,max_quantity,active,changed_by_actor_id,changed_at)
    values(p_id,p_tenant_id,p_product_id,p_display_name,p_stripe_price_id,p_unit_amount_cents,'usd',p_max_quantity,true,p_actor_id,now())
  on conflict (tenant_id,product_id) do update set
    display_name=excluded.display_name,stripe_price_id=excluded.stripe_price_id,unit_amount_cents=excluded.unit_amount_cents,
    max_quantity=excluded.max_quantity,active=true,changed_by_actor_id=excluded.changed_by_actor_id,changed_at=now();

  return jsonb_build_object('outcome','saved','productId',p_product_id);
end $$;

create or replace function public.portal_deactivate_business_checkout_product_service(p_tenant_id app.uuid_v7,p_actor_id app.uuid_v7,p_product_id text)
returns jsonb language plpgsql security definer set search_path='public' as $$
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then
    raise exception 'checkout catalog requires tenant admin' using errcode='42501';
  end if;
  update public.portal_business_action_checkout_products
    set active=false,changed_by_actor_id=p_actor_id,changed_at=now()
    where tenant_id=p_tenant_id and product_id=p_product_id;
  if not found then return jsonb_build_object('outcome','not_found'); end if;
  return jsonb_build_object('outcome','deactivated','productId',p_product_id);
end $$;

-- Admissao ja aconteceu (portal_admit_business_action_service). Este passo
-- decide se a oferta de cobranca chega a existir como pending_approval:
-- checkout_enabled do agente e conta Stripe conectada/ativa sao checados
-- AQUI, nao na admissao generica (mesmo raciocinio de auto_confirm_scheduling
-- em 0052). p_contact_email pode vir vazio: se a sessao ja capturou e-mail
-- via register_lead ou confirm_meeting_slot antes, reaproveita o mais
-- recente entre os dois; se nenhum existir, a reserva nasce sem contact_email
-- e so passa a importar na aprovacao (ver portal_approve_business_checkout_service).
create or replace function public.portal_reserve_business_checkout_service(
  p_reservation_id app.uuid_v7,p_receipt_id app.uuid_v7,p_grant_id app.uuid_v7,
  p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_session_id app.uuid_v7,p_presenter_id app.uuid_v7,
  p_product_id text,p_stripe_idempotency_key text,p_quantity integer default 1,p_contact_email text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_grant public.portal_business_action_grants%rowtype; v_receipt public.portal_business_action_receipts%rowtype;
  v_settings public.portal_business_action_agent_settings%rowtype; v_connection public.portal_business_action_checkout_connections%rowtype;
  v_product public.portal_business_action_checkout_products%rowtype; v_reason text; v_contact_email text; v_lead_id app.uuid_v7;
begin
  if p_stripe_idempotency_key is null or char_length(p_stripe_idempotency_key) not between 16 and 255 then raise exception 'invalid stripe idempotency key' using errcode='22023'; end if;
  if p_quantity not between 1 and 100 then raise exception 'invalid checkout quantity' using errcode='22023'; end if;
  if p_contact_email is not null and p_contact_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid checkout contact email' using errcode='22023'; end if;

  select * into v_grant from public.portal_business_action_grants where tenant_id=p_tenant_id and id=p_grant_id for update;
  if not found or v_grant.action_kind<>'request_checkout' then raise exception 'business action grant not found for request_checkout' using errcode='42501'; end if;

  select * into v_receipt from public.portal_business_action_receipts where tenant_id=v_grant.tenant_id and grant_id=v_grant.id;
  if found then return jsonb_build_object('outcome',v_receipt.outcome,'reservationId',v_receipt.checkout_reservation_id,'receiptId',v_receipt.id); end if;

  select * into v_settings from public.portal_business_action_agent_settings where tenant_id=v_grant.tenant_id and agent_id=v_grant.agent_id;

  if app.portal_business_action_switch_disabled(v_grant.tenant_id,v_grant.agent_id,v_grant.action_kind) then v_reason:='kill_switch_active';
  elsif v_grant.expires_at<=now() then v_reason:='grant_expired';
  elsif v_grant.state<>'issued' then v_reason:='grant_invalid';
  elsif v_grant.agent_id<>p_agent_id or v_grant.session_id<>p_session_id or v_grant.presenter_id<>p_presenter_id then v_reason:='grant_scope_mismatch';
  elsif not coalesce(v_settings.checkout_enabled,false) then v_reason:='checkout_disabled_for_agent';
  else v_reason:=null; end if;

  if v_reason is null then
    select * into v_connection from public.portal_business_action_checkout_connections where tenant_id=v_grant.tenant_id for update;
    if not found or v_connection.status<>'connected' then v_reason:='stripe_not_connected'; end if;
  end if;

  if v_reason is null then
    select * into v_product from public.portal_business_action_checkout_products where tenant_id=v_grant.tenant_id and product_id=p_product_id and active;
    if not found then v_reason:='product_not_found';
    elsif p_quantity>v_product.max_quantity then v_reason:='quantity_out_of_range'; end if;
  end if;

  if v_reason is not null then
    insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome)
      values(p_receipt_id,v_grant.tenant_id,v_grant.id,v_grant.session_id,v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,'deny','rejected')
    on conflict (tenant_id,grant_id) do nothing;
    return jsonb_build_object('outcome','rejected','reason',v_reason);
  end if;

  v_contact_email:=p_contact_email;
  if v_contact_email is null then
    select l.contact_email into v_contact_email from public.portal_business_action_leads l
      where l.tenant_id=v_grant.tenant_id and l.session_id=v_grant.session_id and l.contact_email is not null
      order by l.created_at desc limit 1;
  end if;
  if v_contact_email is null then
    select r.contact_email into v_contact_email from public.portal_business_action_calendar_reservations r
      where r.tenant_id=v_grant.tenant_id and r.session_id=v_grant.session_id
      order by r.created_at desc limit 1;
  end if;
  select l.id into v_lead_id from public.portal_business_action_leads l
    where l.tenant_id=v_grant.tenant_id and l.session_id=v_grant.session_id
    order by l.created_at desc limit 1;

  insert into public.portal_business_action_checkout_reservations(
    id,tenant_id,agent_id,session_id,presenter_id,grant_id,lead_id,product_id,display_name,quantity,
    unit_amount_cents,currency,stripe_price_id,stripe_account_id,platform_fee_bps,application_fee_amount_cents,
    contact_email,state,approval_expires_at,stripe_idempotency_key
  ) values (
    p_reservation_id,v_grant.tenant_id,v_grant.agent_id,v_grant.session_id,v_grant.presenter_id,v_grant.id,v_lead_id,
    v_product.product_id,v_product.display_name,p_quantity,v_product.unit_amount_cents,v_product.currency,
    v_product.stripe_price_id,v_connection.stripe_account_id,v_connection.platform_fee_bps,
    case when v_connection.platform_fee_bps is not null then (v_product.unit_amount_cents*p_quantity*v_connection.platform_fee_bps)/10000 else null end,
    v_contact_email,'pending_approval',now()+interval '72 hours',p_stripe_idempotency_key
  );

  insert into public.portal_business_action_receipts(id,tenant_id,grant_id,session_id,agent_id,presenter_id,action_kind,policy_decision,outcome,checkout_reservation_id)
    values(p_receipt_id,v_grant.tenant_id,v_grant.id,v_grant.session_id,v_grant.agent_id,v_grant.presenter_id,v_grant.action_kind,'require_approval','pending_approval',p_reservation_id)
  on conflict (tenant_id,grant_id) do nothing;

  return jsonb_build_object('outcome','pending_approval','reservationId',p_reservation_id,'receiptId',p_receipt_id,'approvalExpiresAt',now()+interval '72 hours');
end $$;

-- tenant_admin aprova: pending_approval -> reserved. Nunca chama a Stripe.
-- Se a reserva nao capturou nenhum contact_email durante a call,
-- p_contact_email passa a ser obrigatorio aqui (ADR-040 "Entrega do link
-- depois da aprovacao"): sem endereco nenhum pra mandar o link depois de
-- committed, a aprovacao fica declarada como pendente desse dado em vez de
-- silenciosamente aprovar uma reserva sem destino.
create or replace function public.portal_approve_business_checkout_service(
  p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_actor_id app.uuid_v7,p_contact_email text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_checkout_reservations%rowtype; v_contact_email text;
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then
    raise exception 'checkout approval requires tenant admin' using errcode='42501';
  end if;
  if p_contact_email is not null and p_contact_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'invalid checkout approval contact email' using errcode='22023'; end if;

  select * into v_row from public.portal_business_action_checkout_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then raise exception 'checkout reservation not found for tenant' using errcode='P0002'; end if;

  if v_row.state='reserved' then return jsonb_build_object('outcome','already_approved','reservationId',v_row.id,'state',v_row.state); end if;
  if v_row.state='rejected' then return jsonb_build_object('outcome','already_rejected','reservationId',v_row.id,'state',v_row.state); end if;
  if v_row.state='approval_expired' then return jsonb_build_object('outcome','approval_expired','reservationId',v_row.id,'state',v_row.state); end if;
  if v_row.state<>'pending_approval' then return jsonb_build_object('outcome','not_found','reservationId',v_row.id,'state',v_row.state); end if;

  v_contact_email:=coalesce(v_row.contact_email,p_contact_email);
  if v_contact_email is null then return jsonb_build_object('outcome','contact_email_required','reservationId',v_row.id); end if;

  update public.portal_business_action_checkout_reservations
    set state='reserved',approved_by=p_actor_id,approved_at=now(),contact_email=v_contact_email,updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id and state='pending_approval';
  if not found then raise exception 'checkout reservation approval lost its fence' using errcode='55000'; end if;

  return jsonb_build_object('outcome','approved','reservationId',v_row.id,'state','reserved');
end $$;

-- tenant_admin rejeita: pending_approval -> rejected (terminal). Nunca
-- chama a Stripe. O receipt deste grant ja foi gravado como pending_approval
-- na reserva (Art. 7, ADR-040) e nao e reescrito aqui.
create or replace function public.portal_reject_business_checkout_service(
  p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_actor_id app.uuid_v7,p_rejection_reason text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_checkout_reservations%rowtype;
begin
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_actor_id and role='tenant_admin') then
    raise exception 'checkout rejection requires tenant admin' using errcode='42501';
  end if;
  if p_rejection_reason is not null and char_length(p_rejection_reason)>500 then raise exception 'checkout rejection reason too long' using errcode='22023'; end if;

  select * into v_row from public.portal_business_action_checkout_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then raise exception 'checkout reservation not found for tenant' using errcode='P0002'; end if;

  if v_row.state='rejected' then return jsonb_build_object('outcome','already_rejected','reservationId',v_row.id,'state',v_row.state); end if;
  if v_row.state='reserved' then return jsonb_build_object('outcome','already_approved','reservationId',v_row.id,'state',v_row.state); end if;
  if v_row.state='approval_expired' then return jsonb_build_object('outcome','approval_expired','reservationId',v_row.id,'state',v_row.state); end if;
  if v_row.state<>'pending_approval' then return jsonb_build_object('outcome','not_found','reservationId',v_row.id,'state',v_row.state); end if;

  update public.portal_business_action_checkout_reservations
    set state='rejected',rejected_by=p_actor_id,rejected_at=now(),rejection_reason=p_rejection_reason,updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id and state='pending_approval';
  if not found then raise exception 'checkout reservation rejection lost its fence' using errcode='55000'; end if;

  return jsonb_build_object('outcome','rejected','reservationId',v_row.id,'state','rejected');
end $$;

-- Worker de varredura periodica (mesmo ADR-036 sweep que o calendario ja
-- usa, extensao fora do escopo de codigo deste ADR): pending_approval com
-- approval_expires_at no passado vira approval_expired. Nunca chama a
-- Stripe neste caminho.
create or replace function public.portal_expire_pending_business_checkout_reservations_service(p_limit integer default 500)
returns integer language plpgsql security definer set search_path='public' as $$
declare v_count integer;
begin
  if p_limit not between 1 and 5000 then raise exception 'invalid checkout expiry sweep limit' using errcode='22023'; end if;
  with expired as (
    update public.portal_business_action_checkout_reservations
      set state='approval_expired',updated_at=now()
      where id in (
        select id from public.portal_business_action_checkout_reservations
        where state='pending_approval' and approval_expires_at<=now()
        order by approval_expires_at limit p_limit
        for update skip locked
      )
    returning id
  )
  select count(*) into v_count from expired;
  return v_count;
end $$;

create or replace function public.portal_dispatch_business_checkout_reservation_service(p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_checkout_reservations%rowtype;
begin
  select * into v_row from public.portal_business_action_checkout_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then raise exception 'checkout reservation not found for tenant' using errcode='P0002'; end if;
  if v_row.state='reserved' then
    update public.portal_business_action_checkout_reservations set state='provider_in_flight',provider_dispatched_at=now(),updated_at=now() where tenant_id=p_tenant_id and id=p_reservation_id;
    return jsonb_build_object('acquired',true,'state','provider_in_flight','stripeAccountId',v_row.stripe_account_id,'stripeIdempotencyKey',v_row.stripe_idempotency_key);
  end if;
  return jsonb_build_object('acquired',false,'state',v_row.state,'stripeAccountId',v_row.stripe_account_id,'stripeIdempotencyKey',v_row.stripe_idempotency_key);
end $$;

-- provider_in_flight -> committed. Nao grava receipt novo (o unico receipt
-- deste grant ja foi gravado como pending_approval na reserva, ADR-040) --
-- so a aplicacao, no mesmo fluxo do dispatch, dispara em seguida o e-mail
-- do link pra contact_email.
create or replace function public.portal_commit_business_checkout_reservation_service(
  p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_stripe_checkout_session_id text,p_checkout_url text
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_checkout_reservations%rowtype;
begin
  if p_stripe_checkout_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]{1,240}$' then raise exception 'invalid stripe checkout session id' using errcode='22023'; end if;
  if p_checkout_url is null or char_length(p_checkout_url)>2000 or p_checkout_url !~ '^https://' then raise exception 'invalid checkout url' using errcode='22023'; end if;

  select * into v_row from public.portal_business_action_checkout_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then raise exception 'checkout reservation not found for tenant' using errcode='P0002'; end if;

  if v_row.state='committed' then return jsonb_build_object('outcome','succeeded','reservationId',v_row.id,'state',v_row.state,'checkoutUrl',v_row.checkout_url); end if;
  if v_row.state<>'provider_in_flight' then raise exception 'checkout reservation must be provider_in_flight to commit' using errcode='55000'; end if;

  update public.portal_business_action_checkout_reservations
    set state='committed',committed_at=now(),stripe_checkout_session_id=p_stripe_checkout_session_id,checkout_url=p_checkout_url,updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id;

  return jsonb_build_object('outcome','succeeded','reservationId',v_row.id,'state','committed','checkoutUrl',p_checkout_url);
end $$;

-- Libera so falha comprovada pre-dispatch DEPOIS da aprovacao (produto
-- desativado, conta Stripe desconectada entre a aprovacao e o dispatch),
-- nunca depois do dispatch: requer state='reserved' explicitamente. Nunca
-- chama a Stripe.
create or replace function public.portal_release_business_checkout_reservation_service(
  p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_evidence text
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_checkout_reservations%rowtype;
begin
  if p_evidence not in ('product_deactivated','stripe_disconnected') then raise exception 'checkout release requires post-approval pre-dispatch evidence' using errcode='22023'; end if;
  select * into v_row from public.portal_business_action_checkout_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then raise exception 'checkout reservation not found for tenant' using errcode='P0002'; end if;

  if v_row.state='released' then return jsonb_build_object('outcome','released','reservationId',v_row.id,'state',v_row.state); end if;
  if v_row.state<>'reserved' then return jsonb_build_object('outcome','not_releasable','state',v_row.state); end if;

  update public.portal_business_action_checkout_reservations
    set state='released',release_evidence=p_evidence,released_at=now(),updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id and state='reserved';

  return jsonb_build_object('outcome','released','reservationId',v_row.id,'state','released');
end $$;

-- provider_in_flight -> unknown apos falha ambigua pos-dispatch. Mesma
-- disciplina de portal_mark_business_meeting_reservation_unknown_service:
-- nao grava receipt (ja foi gravado como pending_approval na reserva).
create or replace function public.portal_mark_business_checkout_reservation_unknown_service(p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_failure_code text)
returns boolean language plpgsql security definer set search_path='public' as $$
begin
  update public.portal_business_action_checkout_reservations
    set state='unknown',failure_code=left(coalesce(p_failure_code,'unknown'),80),updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id and state='provider_in_flight';
  return found;
end $$;

-- unknown -> committed|released via dois operadores tenant_admin distintos
-- concordando na mesma (evidence_fingerprint,outcome). A primeira tentativa
-- de reconciliacao (repetir a mesma chamada de criacao com a mesma chave de
-- idempotencia, que a propria Stripe deduplica) acontece na aplicacao,
-- antes de qualquer chamada a este RPC: ele so cobre o caminho manual pra
-- quando essa repeticao tambem falha ou fica inconclusiva.
create or replace function public.portal_reconcile_business_checkout_reservation_service(
  p_approval_id app.uuid_v7,p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_operator_actor_id app.uuid_v7,
  p_evidence_fingerprint text,p_outcome text,p_stripe_checkout_session_id text default null,p_checkout_url text default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_checkout_reservations%rowtype; v_agree_count integer;
begin
  if p_evidence_fingerprint !~ '^[0-9a-f]{64}$' or p_outcome not in ('committed','released') then raise exception 'invalid checkout reconciliation request' using errcode='22023'; end if;
  if p_outcome='committed' and (p_stripe_checkout_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]{1,240}$' or p_checkout_url is null or char_length(p_checkout_url)>2000 or p_checkout_url !~ '^https://') then
    raise exception 'committed checkout reconciliation requires a valid session and url' using errcode='22023';
  end if;
  if not exists(select 1 from public.user_tenant_memberships where tenant_id=p_tenant_id and actor_id=p_operator_actor_id and role='tenant_admin') then raise exception 'checkout reconciliation requires a tenant admin operator' using errcode='42501'; end if;

  select * into v_row from public.portal_business_action_checkout_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then raise exception 'checkout reservation not found for tenant' using errcode='P0002'; end if;

  if v_row.state in ('committed','released') then
    if v_row.reconciliation_evidence_fingerprint is distinct from p_evidence_fingerprint or v_row.reconciliation_outcome is distinct from p_outcome then
      return jsonb_build_object('outcome','already_settled','state',v_row.state);
    end if;
    return jsonb_build_object('outcome',v_row.state,'reservationId',v_row.id,'state',v_row.state);
  end if;

  if v_row.state<>'unknown' then
    return jsonb_build_object('outcome','not_reconcilable','state',v_row.state);
  end if;

  insert into public.portal_business_action_checkout_reconcile_approvals(id,tenant_id,reservation_id,evidence_fingerprint,outcome,operator_actor_id)
    values(p_approval_id,p_tenant_id,p_reservation_id,p_evidence_fingerprint,p_outcome,p_operator_actor_id)
  on conflict (tenant_id,reservation_id,evidence_fingerprint,operator_actor_id) do nothing;

  select count(distinct operator_actor_id) into v_agree_count
    from public.portal_business_action_checkout_reconcile_approvals
    where tenant_id=p_tenant_id and reservation_id=p_reservation_id and evidence_fingerprint=p_evidence_fingerprint and outcome=p_outcome;

  if v_agree_count<2 then
    return jsonb_build_object('outcome','awaiting_second_operator','approvals',v_agree_count);
  end if;

  update public.portal_business_action_checkout_reservations set
    state=p_outcome,
    reconciliation_evidence_fingerprint=p_evidence_fingerprint,
    reconciliation_outcome=p_outcome,
    reconciliation_settled_at=now(),
    committed_at=case when p_outcome='committed' then now() else committed_at end,
    stripe_checkout_session_id=case when p_outcome='committed' then coalesce(p_stripe_checkout_session_id,stripe_checkout_session_id) else stripe_checkout_session_id end,
    checkout_url=case when p_outcome='committed' then coalesce(p_checkout_url,checkout_url) else checkout_url end,
    released_at=case when p_outcome='released' then now() else released_at end,
    release_evidence=case when p_outcome='released' then 'stripe_disconnected' else release_evidence end,
    updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id and state='unknown';
  if not found then raise exception 'checkout reservation reconciliation lost its fence' using errcode='55000'; end if;

  return jsonb_build_object('outcome',p_outcome,'reservationId',v_row.id,'state',p_outcome,'approvals',v_agree_count);
end $$;

-- O writer do webhook de conta conectada (checkout.session.completed/
-- expired/async_payment_failed): reclama event_id, transiciona committed ->
-- payment_completed/payment_failed/expired. amount_total_cents/
-- stripe_payment_intent_id/stripe_charge_id so entram aqui, nunca pelo
-- redirect de sucesso do navegador (mesmo principio que billing.ts ja
-- aplica ao proprio checkout de assinatura da Axtro).
create or replace function public.portal_apply_business_checkout_connect_event_service(
  p_event_id text,p_event_type text,p_tenant_id app.uuid_v7,p_reservation_id app.uuid_v7,p_connected_account_id text,p_payload_fingerprint text,
  p_stripe_payment_intent_id text default null,p_stripe_charge_id text default null,p_amount_total_cents bigint default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.portal_business_action_checkout_reservations%rowtype; v_new_state text; v_receipt_state text;
begin
  if p_event_id !~ '^evt_[A-Za-z0-9_]{1,251}$' or p_connected_account_id !~ '^acct_[A-Za-z0-9]{1,255}$' or p_payload_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid checkout connect event payload' using errcode='22023';
  end if;
  if p_event_type not in ('checkout.session.completed','checkout.session.expired','checkout.session.async_payment_failed') then
    raise exception 'unsupported checkout connect event type' using errcode='22023';
  end if;
  if p_stripe_payment_intent_id is not null and p_stripe_payment_intent_id !~ '^pi_[A-Za-z0-9]{1,255}$' then raise exception 'invalid stripe payment intent id' using errcode='22023'; end if;
  if p_stripe_charge_id is not null and p_stripe_charge_id !~ '^ch_[A-Za-z0-9]{1,255}$' then raise exception 'invalid stripe charge id' using errcode='22023'; end if;
  if p_amount_total_cents is not null and p_amount_total_cents<0 then raise exception 'invalid checkout amount total' using errcode='22023'; end if;

  begin
    insert into public.portal_business_action_checkout_stripe_event_receipts(event_id,event_type,tenant_id,reservation_id,connected_account_id,payload_fingerprint,receipt_applied)
      values(p_event_id,p_event_type,p_tenant_id,p_reservation_id,p_connected_account_id,p_payload_fingerprint,false);
  exception when unique_violation then
    return jsonb_build_object('outcome','duplicate_event');
  end;

  select * into v_row from public.portal_business_action_checkout_reservations where tenant_id=p_tenant_id and id=p_reservation_id for update;
  if not found then
    update public.portal_business_action_checkout_stripe_event_receipts set receipt_state='ignored_stale' where event_id=p_event_id;
    return jsonb_build_object('outcome','ignored_unknown_reservation');
  end if;

  -- ADR-040: o account que a Stripe inclui no evento precisa bater com o
  -- stripe_account_id snapshotado na propria reserva no momento em que ela
  -- foi despachada, ou o evento e rejeitado. Sem este cruzamento, uma conta
  -- conectada Standard (que tem acesso ao proprio dashboard Stripe) poderia
  -- fabricar uma Checkout Session com metadata.tenant_id/reservation_id de
  -- OUTRO tenant e aplicar o desfecho a uma reserva que nao e dela: a
  -- assinatura HMAC do webhook sozinha nao impede isso, porque o mesmo
  -- segredo de endpoint assina eventos de qualquer conta conectada.
  if v_row.stripe_account_id<>p_connected_account_id then
    update public.portal_business_action_checkout_stripe_event_receipts set receipt_state='ignored_account_mismatch' where event_id=p_event_id;
    return jsonb_build_object('outcome','ignored_account_mismatch');
  end if;

  if v_row.state not in ('committed','payment_completed','payment_failed','expired') then
    update public.portal_business_action_checkout_stripe_event_receipts set receipt_state='ignored_stale' where event_id=p_event_id;
    return jsonb_build_object('outcome','ignored_state','state',v_row.state);
  end if;

  if v_row.state in ('payment_completed','payment_failed','expired') then
    update public.portal_business_action_checkout_stripe_event_receipts set receipt_state=v_row.state,receipt_applied=true where event_id=p_event_id;
    return jsonb_build_object('outcome',v_row.state,'reservationId',v_row.id,'state',v_row.state);
  end if;

  v_new_state:=case p_event_type
    when 'checkout.session.completed' then 'payment_completed'
    when 'checkout.session.async_payment_failed' then 'payment_failed'
    when 'checkout.session.expired' then 'expired'
  end;
  v_receipt_state:=v_new_state;

  update public.portal_business_action_checkout_reservations
    set state=v_new_state,completed_at=now(),
      stripe_payment_intent_id=coalesce(p_stripe_payment_intent_id,stripe_payment_intent_id),
      stripe_charge_id=coalesce(p_stripe_charge_id,stripe_charge_id),
      amount_total_cents=coalesce(p_amount_total_cents,amount_total_cents),
      updated_at=now()
    where tenant_id=p_tenant_id and id=p_reservation_id and state='committed';
  if not found then raise exception 'checkout connect event application lost its fence' using errcode='55000'; end if;

  update public.portal_business_action_checkout_stripe_event_receipts set receipt_state=v_receipt_state,receipt_applied=true where event_id=p_event_id;
  return jsonb_build_object('outcome',v_new_state,'reservationId',v_row.id,'state',v_new_state);
end $$;

revoke all on function public.portal_admit_business_action_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer) from public,anon,authenticated;
revoke all on function public.portal_business_action_status_service(app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_set_business_action_agent_settings_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean) from public,anon,authenticated;
revoke all on function public.portal_complete_stripe_connect_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_disconnect_stripe_service(app.uuid_v7,app.uuid_v7) from public,anon,authenticated;
revoke all on function public.portal_sync_stripe_connect_capabilities_service(text,app.uuid_v7,text,text,boolean,boolean,boolean) from public,anon,authenticated;
revoke all on function public.portal_stripe_connect_status_service(app.uuid_v7) from public,anon,authenticated;
revoke all on function public.portal_resolve_stripe_connect_tenant_service(text) from public,anon,authenticated;
revoke all on function public.portal_upsert_business_checkout_product_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.portal_deactivate_business_checkout_product_service(app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_reserve_business_checkout_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.portal_approve_business_checkout_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_reject_business_checkout_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_expire_pending_business_checkout_reservations_service(integer) from public,anon,authenticated;
revoke all on function public.portal_dispatch_business_checkout_reservation_service(app.uuid_v7,app.uuid_v7) from public,anon,authenticated;
revoke all on function public.portal_commit_business_checkout_reservation_service(app.uuid_v7,app.uuid_v7,text,text) from public,anon,authenticated;
revoke all on function public.portal_release_business_checkout_reservation_service(app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_mark_business_checkout_reservation_unknown_service(app.uuid_v7,app.uuid_v7,text) from public,anon,authenticated;
revoke all on function public.portal_reconcile_business_checkout_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) from public,anon,authenticated;
revoke all on function public.portal_apply_business_checkout_connect_event_service(text,text,app.uuid_v7,app.uuid_v7,text,text,text,text,bigint) from public,anon,authenticated;

grant execute on function public.portal_admit_business_action_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer) to service_role;
grant execute on function public.portal_business_action_status_service(app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_set_business_action_agent_settings_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,boolean,boolean) to service_role;
grant execute on function public.portal_complete_stripe_connect_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_disconnect_stripe_service(app.uuid_v7,app.uuid_v7) to service_role;
grant execute on function public.portal_sync_stripe_connect_capabilities_service(text,app.uuid_v7,text,text,boolean,boolean,boolean) to service_role;
grant execute on function public.portal_stripe_connect_status_service(app.uuid_v7) to service_role;
grant execute on function public.portal_resolve_stripe_connect_tenant_service(text) to service_role;
grant execute on function public.portal_upsert_business_checkout_product_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,bigint,integer) to service_role;
grant execute on function public.portal_deactivate_business_checkout_product_service(app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_reserve_business_checkout_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,text) to service_role;
grant execute on function public.portal_approve_business_checkout_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_reject_business_checkout_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_expire_pending_business_checkout_reservations_service(integer) to service_role;
grant execute on function public.portal_dispatch_business_checkout_reservation_service(app.uuid_v7,app.uuid_v7) to service_role;
grant execute on function public.portal_commit_business_checkout_reservation_service(app.uuid_v7,app.uuid_v7,text,text) to service_role;
grant execute on function public.portal_release_business_checkout_reservation_service(app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_mark_business_checkout_reservation_unknown_service(app.uuid_v7,app.uuid_v7,text) to service_role;
grant execute on function public.portal_reconcile_business_checkout_reservation_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,text) to service_role;
grant execute on function public.portal_apply_business_checkout_connect_event_service(text,text,app.uuid_v7,app.uuid_v7,text,text,text,text,bigint) to service_role;

alter function public.portal_schema_capabilities_service() set schema app;
alter function app.portal_schema_capabilities_service() rename to portal_schema_capabilities_v59;
revoke all on function app.portal_schema_capabilities_v59() from public,anon,authenticated,service_role;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='' as $$
  select (app.portal_schema_capabilities_v59()-'version')||jsonb_build_object(
    'version',69,
    'businessActionCheckoutConnections',to_regclass('public.portal_business_action_checkout_connections') is not null and to_regprocedure('public.portal_complete_stripe_connect_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text)') is not null and to_regprocedure('public.portal_disconnect_stripe_service(app.uuid_v7,app.uuid_v7)') is not null and to_regprocedure('public.portal_sync_stripe_connect_capabilities_service(text,app.uuid_v7,text,text,boolean,boolean,boolean)') is not null and to_regprocedure('public.portal_resolve_stripe_connect_tenant_service(text)') is not null,
    'businessActionCheckoutProducts',to_regclass('public.portal_business_action_checkout_products') is not null and to_regprocedure('public.portal_upsert_business_checkout_product_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,bigint,integer)') is not null,
    'businessActionCheckoutReservations',to_regclass('public.portal_business_action_checkout_reservations') is not null and to_regprocedure('public.portal_reserve_business_checkout_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,integer,text)') is not null and to_regprocedure('public.portal_approve_business_checkout_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text)') is not null and to_regprocedure('public.portal_reject_business_checkout_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text)') is not null,
    'businessActionCheckoutStripeEventReceipts',to_regclass('public.portal_business_action_checkout_stripe_event_receipts') is not null and to_regprocedure('public.portal_apply_business_checkout_connect_event_service(text,text,app.uuid_v7,app.uuid_v7,text,text,text,text,bigint)') is not null
  )
$$;
revoke all on function public.portal_schema_capabilities_service() from public,anon,authenticated;
grant execute on function public.portal_schema_capabilities_service() to service_role;

commit;
