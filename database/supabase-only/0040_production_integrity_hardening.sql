-- M5-01: durable, tenant-serialized reservations for paid Tavus/Recall
-- resources and OpenRouter usage, customer-delivery-gated Stripe usage,
-- webhook replay evidence and additive transcript/readiness hardening. Apply
-- before deploying the M5-01 application. This migration intentionally does
-- not narrow legacy RPCs.

begin;

-- pgcrypto is installed by the portable foundation migration. Supabase puts
-- extensions in `extensions`, while the local PostgreSQL harness uses
-- `public`; the explicit search path keeps one canonical digest boundary.
create or replace function app.sha256_text(p_value text)
returns text language sql immutable strict
set search_path='extensions','public','pg_catalog' as $$
  select encode(digest(convert_to(p_value,'UTF8'),'sha256'),'hex')
$$;

create or replace function app.sha256_tuple(variadic p_values text[])
returns text language sql immutable
set search_path='app','public','extensions','pg_catalog' as $$
  select app.sha256_text(coalesce((
    select string_agg(char_length(coalesce(value,''))::text||':'||coalesce(value,'')||';','' order by ordinal)
    from unnest(p_values) with ordinality as item(value,ordinal)
  ),''))
$$;

create unique index user_tenant_memberships_tenant_actor_uidx
  on public.user_tenant_memberships(tenant_id,actor_id);

create table public.provider_effect_reservations (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  agent_id app.uuid_v7 not null,
  idempotency_key text not null,
  provider_id text not null,
  effect_kind text not null,
  cap_bucket text not null,
  state text not null default 'reserved',
  cost_event_id app.uuid_v7 not null,
  provider_request_ref text not null,
  related_ref text,
  provider_ref text,
  provider_url text,
  billing_period_start timestamptz,
  billing_period_end timestamptz,
  included_quantity integer not null default 0,
  billable_overage boolean not null default false,
  stripe_customer_id text,
  meter_event_name text not null default 'axtro_conversation_overage',
  meter_event_at timestamptz,
  billing_snapshot_at timestamptz,
  max_duration_seconds integer not null,
  estimated_cost_usd numeric(20,8) not null,
  cost_rate_card_ref text not null,
  cost_rate_card_as_of timestamptz not null,
  customer_delivery_state text not null default 'held',
  customer_delivery_receipt_kind text,
  customer_delivery_receipt_ref text,
  customer_delivery_receipt_at timestamptz,
  tavus_webhook_capability_hash text,
  tavus_webhook_capability_expires_at timestamptz,
  tavus_webhook_capability_revoked_at timestamptz,
  failure_code text,
  release_evidence text,
  retry_generation integer not null default 0,
  created_at timestamptz not null default now(),
  provider_dispatched_at timestamptz,
  camera_started_at timestamptz,
  committed_at timestamptz,
  released_at timestamptz,
  completed_at timestamptz,
  customer_activated_at timestamptz,
  customer_voided_at timestamptz,
  reconciliation_attempts integer not null default 0,
  reconciliation_available_at timestamptz not null default now(),
  reconciliation_lease_token app.uuid_v7,
  reconciliation_lease_until timestamptz,
  reconciliation_last_error_code text,
  reconciliation_dead_lettered_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, agent_id) references public.agents(tenant_id, id) on delete restrict,
  unique (tenant_id, idempotency_key),
  unique (tenant_id, id),
  unique (tenant_id, cost_event_id),
  unique (tenant_id, provider_request_ref),
  constraint provider_effect_reservations_provider_chk check (provider_id in ('tavus','recall')),
  constraint provider_effect_reservations_kind_chk check (effect_kind in ('tavus_conversation','recall_bot')),
  constraint provider_effect_reservations_bucket_chk check (cap_bucket in ('tavus_video_daily','recall_bot_active')),
  constraint provider_effect_reservations_state_chk check (state in ('reserved','provider_in_flight','committed','released','unknown','cleanup_pending','completed')),
  constraint provider_effect_reservations_idem_chk check (idempotency_key ~ '^[a-z0-9][a-z0-9:._/-]{7,199}$'),
  constraint provider_effect_reservations_request_ref_chk check (provider_request_ref ~ '^ppr_[a-z0-9]{6,64}$'),
  constraint provider_effect_reservations_meter_event_chk check (meter_event_name ~ '^[a-z][a-z0-9_]{2,99}$'),
  constraint provider_effect_reservations_meter_event_at_chk check ((meter_event_at is null) = (billing_snapshot_at is null)),
  constraint provider_effect_reservations_included_quantity_chk check (included_quantity between 0 and 1000000),
  constraint provider_effect_reservations_duration_chk check (max_duration_seconds between 60 and 2400),
  constraint provider_effect_reservations_estimated_cost_chk check (estimated_cost_usd > 0),
  constraint provider_effect_reservations_customer_delivery_state_chk check (customer_delivery_state in ('held','activated','voided')),
  constraint provider_effect_reservations_customer_delivery_time_chk check (
    (customer_delivery_state='held' and customer_activated_at is null and customer_voided_at is null)
    or (customer_delivery_state='activated' and customer_activated_at is not null and customer_voided_at is null)
    or (customer_delivery_state='voided' and customer_voided_at is not null)
  ),
  constraint provider_effect_reservations_provider_ref_chk check (provider_ref is null or char_length(provider_ref) between 1 and 255),
  constraint provider_effect_reservations_provider_url_chk check (
    provider_url is null or (
      char_length(provider_url) <= 2000 and provider_url ~ '^https://'
      and (provider_id<>'tavus' or provider_url ~ '^https://tavus[.]daily[.]co/')
    )
  ),
  constraint provider_effect_reservations_related_ref_chk check (
    related_ref is null or (
      char_length(related_ref) between 1 and 255
      and related_ref ~ '^[a-z0-9][a-z0-9:._/-]{0,254}$'
      and related_ref !~ '://'
    )
  ),
  constraint provider_effect_reservations_state_ref_chk check (
    (state in ('committed','completed','cleanup_pending') and provider_ref is not null)
    or (state not in ('committed','completed','cleanup_pending'))
  ),
  constraint provider_effect_reservations_release_chk check (
    (state = 'released' and released_at is not null and release_evidence is not null)
    or state <> 'released'
  ),
  constraint provider_effect_reservations_retry_generation_chk check (retry_generation between 0 and 1000)
  ,constraint provider_effect_reservations_delivery_receipt_chk check (
    (customer_delivery_state='held' and customer_delivery_receipt_kind is null and customer_delivery_receipt_ref is null and customer_delivery_receipt_at is null)
    or (customer_delivery_state in ('activated','voided') and customer_delivery_receipt_kind is not null and customer_delivery_receipt_ref is not null and customer_delivery_receipt_at is not null)
  )
  ,constraint provider_effect_reservations_capability_hash_chk check (
    (tavus_webhook_capability_hash is null and tavus_webhook_capability_expires_at is null and tavus_webhook_capability_revoked_at is null)
    or (
      tavus_webhook_capability_hash ~ '^[0-9a-f]{64}$'
      and provider_id='tavus'
      and provider_dispatched_at is not null
      and tavus_webhook_capability_expires_at=provider_dispatched_at+make_interval(secs=>max_duration_seconds+900)
      and (tavus_webhook_capability_revoked_at is null or tavus_webhook_capability_revoked_at>=provider_dispatched_at)
    )
  )
  ,constraint provider_effect_reservations_reconciliation_attempts_chk check (reconciliation_attempts between 0 and 1000)
  ,constraint provider_effect_reservations_reconciliation_lease_chk check ((reconciliation_lease_token is null) = (reconciliation_lease_until is null))
);

create index provider_effect_reservations_cap_idx
  on public.provider_effect_reservations (tenant_id, cap_bucket, created_at, state);
-- Provider effect identifiers are global within a provider. Two tenants must
-- never be able to claim the same Tavus conversation or Recall bot and later
-- compensate each other's resource.
create unique index provider_effect_reservations_provider_ref_uidx
  on public.provider_effect_reservations (provider_id, provider_ref)
  where provider_ref is not null;
alter table public.provider_effect_reservations enable row level security;
alter table public.provider_effect_reservations force row level security;
revoke all on table public.provider_effect_reservations from public, anon, authenticated, service_role;

create table public.provider_effect_reconciliation_receipts (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  reservation_id app.uuid_v7 not null,
  evidence text not null,
  provider_receipt_ref text not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id,reservation_id) references public.provider_effect_reservations(tenant_id,id) on delete restrict,
  unique (tenant_id,reservation_id),
  constraint provider_effect_reconciliation_evidence_chk check (evidence in ('provider_rejected','reconciliation_absent','compensation_confirmed')),
  constraint provider_effect_reconciliation_ref_chk check (provider_receipt_ref ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{7,254}$')
);
create unique index provider_effect_reconciliation_provider_receipt_uidx
  on public.provider_effect_reconciliation_receipts(provider_receipt_ref);
alter table public.provider_effect_reconciliation_receipts enable row level security;
alter table public.provider_effect_reconciliation_receipts force row level security;
revoke all on table public.provider_effect_reconciliation_receipts from public, anon, authenticated, service_role;

create table public.billing_usage_outbox (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  reservation_id app.uuid_v7 not null,
  cost_event_id app.uuid_v7 not null,
  stripe_customer_id text not null,
  meter_event_name text not null,
  quantity integer not null default 1,
  idempotency_key text not null,
  billing_period_start timestamptz not null,
  billing_period_end timestamptz,
  meter_event_at timestamptz not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token app.uuid_v7,
  lease_until timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  terminal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, reservation_id) references public.provider_effect_reservations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, cost_event_id) references public.cost_events(tenant_id, id) on delete restrict,
  unique (tenant_id, cost_event_id),
  unique (idempotency_key),
  constraint billing_usage_outbox_customer_chk check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,255}$'),
  constraint billing_usage_outbox_event_chk check (meter_event_name ~ '^[a-z][a-z0-9_]{2,99}$'),
  constraint billing_usage_outbox_idem_chk check (char_length(idempotency_key) between 8 and 255),
  constraint billing_usage_outbox_status_chk check (status in ('pending','delivering','delivered','failed','dead_letter','voided')),
  constraint billing_usage_outbox_quantity_chk check (quantity between 1 and 1000),
  constraint billing_usage_outbox_lease_chk check ((status = 'delivering') = (lease_token is not null and lease_until is not null))
);
create index billing_usage_outbox_dispatch_idx on public.billing_usage_outbox (status, available_at);
alter table public.billing_usage_outbox enable row level security;
alter table public.billing_usage_outbox force row level security;
revoke all on table public.billing_usage_outbox from public, anon, authenticated, service_role;

-- Checkout creation is a paid-provider effect too. The immutable request and
-- catalog snapshots are committed before the Stripe dispatch fence. There is
-- exactly one unresolved checkout per tenant and no browser/table DML path.
create table public.billing_checkout_intents (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  actor_id app.uuid_v7 not null,
  plan_id text not null,
  base_price_id text not null,
  overage_price_id text not null,
  stripe_livemode boolean not null,
  base_unit_amount_cents integer not null,
  overage_unit_amount_cents integer not null,
  meter_event_name text not null,
  existing_stripe_customer_id text,
  success_url text not null,
  cancel_url text not null,
  expires_at timestamptz not null,
  stripe_idempotency_key text not null unique,
  catalog_fingerprint text not null,
  request_fingerprint text not null,
  state text not null default 'reserved',
  stripe_session_id text,
  checkout_url text,
  stripe_customer_id text,
  stripe_subscription_id text,
  last_event_id text,
  last_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  catalog_verified_at timestamptz,
  dispatched_at timestamptz,
  bound_at timestamptz,
  completed_at timestamptz,
  expired_at timestamptz,
  released_at timestamptz,
  release_evidence text,
  updated_at timestamptz not null default now(),
  foreign key(tenant_id,actor_id) references public.user_tenant_memberships(tenant_id,actor_id) on delete restrict,
  unique(tenant_id,id),
  constraint billing_checkout_plan_chk check(plan_id in ('piloto','crescimento','escala')),
  constraint billing_checkout_base_price_chk check(base_price_id ~ '^price_[A-Za-z0-9]{1,255}$'),
  constraint billing_checkout_overage_price_chk check(overage_price_id ~ '^price_[A-Za-z0-9]{1,255}$'),
  constraint billing_checkout_base_amount_chk check(base_unit_amount_cents between 1 and 100000000),
  constraint billing_checkout_overage_amount_chk check(overage_unit_amount_cents between 1 and 100000000),
  constraint billing_checkout_meter_event_chk check(meter_event_name ~ '^[a-z][a-z0-9_]{2,99}$'),
  constraint billing_checkout_existing_customer_chk check(existing_stripe_customer_id is null or existing_stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,255}$'),
  constraint billing_checkout_customer_chk check(stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]{1,255}$'),
  constraint billing_checkout_subscription_chk check(stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,255}$'),
  constraint billing_checkout_session_chk check(stripe_session_id is null or stripe_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]{1,240}$'),
  constraint billing_checkout_redirect_urls_chk check(
    (success_url='https://closer.axtroai.com/configuracoes?billing_success=1'
      and cancel_url='https://closer.axtroai.com/configuracoes?billing_error=cancelado')
    or
    (success_url='https://portal-production-b43e.up.railway.app/configuracoes?billing_success=1'
      and cancel_url='https://portal-production-b43e.up.railway.app/configuracoes?billing_error=cancelado')
  ),
  constraint billing_checkout_url_chk check(checkout_url is null or (char_length(checkout_url) between 9 and 2000 and checkout_url ~ '^https://[^/@?#]+(?::[0-9]{1,5})?(/[^#]*)?$')),
  constraint billing_checkout_idempotency_chk check(stripe_idempotency_key=('billing:checkout:'||replace(id::text,'-',''))),
  constraint billing_checkout_catalog_fingerprint_chk check(catalog_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint billing_checkout_request_fingerprint_chk check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint billing_checkout_state_chk check(state in ('reserved','dispatched','bound','completed','expired','released','unknown','conflict')),
  constraint billing_checkout_release_chk check((state='released' and released_at is not null and release_evidence in ('catalog_preflight_failed','not_dispatched')) or state<>'released'),
  constraint billing_checkout_dispatch_chk check((state='reserved' and dispatched_at is null) or state<>'reserved'),
  constraint billing_checkout_bound_chk check((state in ('bound','completed','expired') and stripe_session_id is not null) or state not in ('bound','completed','expired')),
  constraint billing_checkout_last_event_pair_chk check((last_event_id is null)=(last_event_created_at is null))
);
create unique index billing_checkout_intents_one_open_tenant_uidx
  on public.billing_checkout_intents(tenant_id)
  where state in ('reserved','dispatched','bound','unknown');
create unique index billing_checkout_intents_session_uidx
  on public.billing_checkout_intents(stripe_session_id) where stripe_session_id is not null;
create unique index billing_checkout_intents_subscription_uidx
  on public.billing_checkout_intents(stripe_subscription_id) where stripe_subscription_id is not null;
alter table public.billing_checkout_intents enable row level security;
alter table public.billing_checkout_intents force row level security;
revoke all on table public.billing_checkout_intents from public,anon,authenticated,service_role;

create or replace function app.prevent_billing_checkout_snapshot_mutation()
returns trigger language plpgsql set search_path='public' as $$
begin
  if row(old.id,old.tenant_id,old.actor_id,old.plan_id,old.base_price_id,old.overage_price_id,
      old.stripe_livemode,old.base_unit_amount_cents,old.overage_unit_amount_cents,old.meter_event_name,
      old.existing_stripe_customer_id,old.success_url,old.cancel_url,old.expires_at,
      old.stripe_idempotency_key,old.catalog_fingerprint,old.request_fingerprint,old.created_at)
    is distinct from
    row(new.id,new.tenant_id,new.actor_id,new.plan_id,new.base_price_id,new.overage_price_id,
      new.stripe_livemode,new.base_unit_amount_cents,new.overage_unit_amount_cents,new.meter_event_name,
      new.existing_stripe_customer_id,new.success_url,new.cancel_url,new.expires_at,
      new.stripe_idempotency_key,new.catalog_fingerprint,new.request_fingerprint,new.created_at)
  then raise exception 'billing checkout immutable snapshot cannot change' using errcode='55000'; end if;
  return new;
end $$;
create trigger billing_checkout_intents_immutable_snapshot
before update on public.billing_checkout_intents for each row
execute function app.prevent_billing_checkout_snapshot_mutation();

alter table public.tenant_subscriptions
  add column checkout_intent_id app.uuid_v7,
  add column last_event_id text;
alter table public.tenant_subscriptions
  add constraint tenant_subscriptions_checkout_intent_fk
  foreign key(tenant_id,checkout_intent_id) references public.billing_checkout_intents(tenant_id,id) on delete restrict;
revoke all on table public.tenant_subscriptions from service_role;

-- One global Stripe event ledger prevents the same signed event id from being
-- interpreted once as checkout state and again as subscription state.
create table public.billing_stripe_event_receipts (
  event_id text primary key,
  event_type text not null,
  event_created_at timestamptz not null,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  checkout_intent_id app.uuid_v7,
  stripe_session_id text,
  stripe_subscription_id text,
  payload_fingerprint text not null,
  receipt_kind text not null,
  receipt_outcome text,
  receipt_state text,
  receipt_applied boolean not null,
  created_at timestamptz not null default now(),
  foreign key(tenant_id,checkout_intent_id) references public.billing_checkout_intents(tenant_id,id) on delete restrict,
  constraint billing_stripe_event_id_chk check(event_id ~ '^evt_[A-Za-z0-9_]{1,251}$'),
  constraint billing_stripe_event_session_chk check(stripe_session_id is null or stripe_session_id ~ '^cs_(test|live)_[A-Za-z0-9_]{1,240}$'),
  constraint billing_stripe_event_subscription_chk check(stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]{1,255}$'),
  constraint billing_stripe_event_fingerprint_chk check(payload_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint billing_stripe_event_kind_chk check(receipt_kind in ('checkout','subscription')),
  constraint billing_stripe_event_state_chk check(receipt_state is null or receipt_state in ('completed','expired','unknown')),
  constraint billing_stripe_event_outcome_chk check(receipt_outcome is null or receipt_outcome in ('applied','ignored_stale','ignored_superseded_subscription','duplicate_subscription_conflict')),
  constraint billing_stripe_event_checkout_shape_chk check(
    receipt_kind<>'checkout' or (
      event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','checkout.session.async_payment_failed')
      and checkout_intent_id is not null and stripe_session_id is not null
      and receipt_state is not null and receipt_outcome is null
    )
  ),
  constraint billing_stripe_event_subscription_shape_chk check(
    receipt_kind<>'subscription' or (
      event_type in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted')
      and stripe_session_id is null and stripe_subscription_id is not null
      and receipt_state is null and receipt_outcome is not null
      and receipt_applied=(receipt_outcome='applied')
    )
  )
);
alter table public.billing_stripe_event_receipts enable row level security;
alter table public.billing_stripe_event_receipts force row level security;
revoke all on table public.billing_stripe_event_receipts from public,anon,authenticated,service_role;
create trigger billing_stripe_event_receipts_append_only
before update or delete on public.billing_stripe_event_receipts for each row execute function app.prevent_mutation();

create table public.recall_webhook_deliveries (
  delivery_id text primary key,
  tenant_id app.uuid_v7 references public.tenants(id) on delete restrict,
  payload_digest text not null,
  status text not null default 'processing',
  claim_token app.uuid_v7 not null,
  lease_until timestamptz not null default (now() + interval '300 seconds'),
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  provider_bot_id text,
  terminal_status text,
  constraint recall_webhook_delivery_id_chk check (char_length(delivery_id) between 8 and 255),
  constraint recall_webhook_digest_chk check (payload_digest ~ '^[0-9a-f]{64}$'),
  constraint recall_webhook_status_chk check (status in ('processing','completed')),
  constraint recall_webhook_attempts_chk check (attempts between 1 and 1000),
  constraint recall_webhook_bot_ref_chk check (provider_bot_id is null or char_length(provider_bot_id) between 1 and 255),
  constraint recall_webhook_terminal_status_chk check (terminal_status is null or terminal_status in ('ended','failed')),
  constraint recall_webhook_terminal_pair_chk check ((provider_bot_id is null) = (terminal_status is null))
);
create index recall_webhook_terminal_bot_idx on public.recall_webhook_deliveries(provider_bot_id,created_at) where terminal_status is not null;
alter table public.recall_webhook_deliveries enable row level security;
alter table public.recall_webhook_deliveries force row level security;
revoke all on table public.recall_webhook_deliveries from public, anon, authenticated, service_role;

create table public.tavus_webhook_deliveries (
  reservation_id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null,
  provider_ref text not null,
  observed_at timestamptz not null,
  payload_digest text not null,
  status text not null default 'processing',
  claim_token app.uuid_v7 not null,
  lease_until timestamptz not null default (now() + interval '300 seconds'),
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (tenant_id,reservation_id) references public.provider_effect_reservations(tenant_id,id) on delete restrict,
  constraint tavus_webhook_provider_ref_chk check (char_length(provider_ref) between 1 and 255),
  constraint tavus_webhook_digest_chk check (payload_digest ~ '^[0-9a-f]{64}$'),
  constraint tavus_webhook_status_chk check (status in ('processing','completed')),
  constraint tavus_webhook_attempts_chk check (attempts between 1 and 1000)
);
alter table public.tavus_webhook_deliveries enable row level security;
alter table public.tavus_webhook_deliveries force row level security;
revoke all on table public.tavus_webhook_deliveries from public, anon, authenticated, service_role;

create table public.tavus_customer_delivery_receipts (
  reservation_id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null,
  provider_ref text not null,
  payload_digest text not null,
  receipt_kind text not null,
  event_type text not null,
  reason text,
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id,reservation_id) references public.provider_effect_reservations(tenant_id,id) on delete restrict,
  constraint tavus_delivery_digest_chk check (payload_digest ~ '^[0-9a-f]{64}$'),
  constraint tavus_delivery_kind_chk check (receipt_kind in ('delivered','never_joined')),
  constraint tavus_delivery_reason_chk check ((receipt_kind='delivered' and reason is null) or (receipt_kind='never_joined' and reason is not null))
);
alter table public.tavus_customer_delivery_receipts enable row level security;
alter table public.tavus_customer_delivery_receipts force row level security;
revoke all on table public.tavus_customer_delivery_receipts from public,anon,authenticated,service_role;

create table public.tavus_stage_capabilities (
  reservation_id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null,
  agent_id app.uuid_v7 not null,
  token_hash text not null unique,
  room_url text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  resolve_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,reservation_id) references public.provider_effect_reservations(tenant_id,id) on delete restrict,
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  constraint tavus_stage_hash_chk check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint tavus_stage_room_chk check (char_length(room_url)<=2000 and room_url ~ '^https://tavus[.]daily[.]co/'),
  constraint tavus_stage_expiry_chk check (expires_at<=updated_at+interval '45 minutes'),
  constraint tavus_stage_resolve_chk check (resolve_count between 0 and 8)
);
alter table public.tavus_stage_capabilities enable row level security;
alter table public.tavus_stage_capabilities force row level security;
revoke all on table public.tavus_stage_capabilities from public,anon,authenticated,service_role;

create table public.worker_heartbeats (
  worker_name text primary key,
  run_id app.uuid_v7 not null,
  version text not null,
  deployment_id text not null,
  config_fingerprint text not null,
  status text not null,
  started_at timestamptz not null,
  succeeded_at timestamptz,
  last_succeeded_at timestamptz,
  last_succeeded_version text,
  last_succeeded_deployment_id text,
  last_succeeded_config_fingerprint text,
  counters jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint worker_heartbeat_name_chk check (worker_name in ('billing_usage','provider_effect_reconciler')),
  constraint worker_heartbeat_version_chk check (version ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$'),
  constraint worker_heartbeat_deployment_chk check (deployment_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$'),
  constraint worker_heartbeat_fingerprint_chk check (config_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint worker_heartbeat_status_chk check (status in ('started','succeeded','failed')),
  constraint worker_heartbeat_success_chk check ((status='succeeded')=(succeeded_at is not null)),
  constraint worker_heartbeat_last_success_chk check (
    (last_succeeded_at is null)=(last_succeeded_version is null)
    and (last_succeeded_at is null)=(last_succeeded_deployment_id is null)
    and (last_succeeded_at is null)=(last_succeeded_config_fingerprint is null)
  ),
  constraint worker_heartbeat_last_version_chk check (last_succeeded_version is null or last_succeeded_version ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$'),
  constraint worker_heartbeat_last_deployment_chk check (last_succeeded_deployment_id is null or last_succeeded_deployment_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$'),
  constraint worker_heartbeat_last_fingerprint_chk check (last_succeeded_config_fingerprint is null or last_succeeded_config_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint worker_heartbeat_counters_chk check (jsonb_typeof(counters)='object')
);
alter table public.worker_heartbeats enable row level security;
alter table public.worker_heartbeats force row level security;
revoke all on table public.worker_heartbeats from public,anon,authenticated,service_role;

create table public.ai_usage_reservations (
  id app.uuid_v7 primary key,
  cost_event_id app.uuid_v7 not null,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  agent_id app.uuid_v7,
  source_id app.uuid_v7,
  idempotency_key text not null,
  operation text not null,
  state text not null default 'reserved',
  max_input_tokens integer not null,
  max_output_tokens integer not null,
  max_cost_usd numeric(20,8) not null,
  actual_input_tokens integer,
  actual_output_tokens integer,
  reported_cost_usd numeric(20,8),
  provider_request_ref text not null,
  failure_code text,
  release_evidence text,
  created_at timestamptz not null default now(),
  provider_dispatched_at timestamptz,
  committed_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id,agent_id) references public.agents(tenant_id,id) on delete restrict,
  foreign key (tenant_id,source_id) references public.knowledge_sources(tenant_id,id) on delete set null (source_id),
  unique (tenant_id,id), unique (tenant_id,idempotency_key), unique (tenant_id,cost_event_id), unique (tenant_id,provider_request_ref),
  constraint ai_usage_operation_chk check (operation in ('chat_generation','brain_generation','knowledge_query_embedding','knowledge_ingestion_embedding')),
  constraint ai_usage_state_chk check (state in ('reserved','provider_in_flight','committed','unknown','released')),
  constraint ai_usage_tokens_chk check (max_input_tokens between 0 and 2000000 and max_output_tokens between 0 and 2000000 and max_input_tokens+max_output_tokens>0),
  constraint ai_usage_cost_chk check (max_cost_usd>0),
  constraint ai_usage_request_ref_chk check (provider_request_ref ~ '^ppr_[a-z0-9]{6,64}$')
);
alter table public.ai_usage_reservations enable row level security;
alter table public.ai_usage_reservations force row level security;
revoke all on table public.ai_usage_reservations from public,anon,authenticated,service_role;

create table public.ai_usage_reconciliation_receipts (
  id app.uuid_v7 primary key,
  tenant_id app.uuid_v7 not null references public.tenants(id) on delete restrict,
  reservation_id app.uuid_v7 not null,
  evidence text not null,
  provider_receipt_ref text not null,
  actual_input_tokens integer,
  actual_output_tokens integer,
  reported_cost_usd numeric(20,8),
  created_at timestamptz not null default now(),
  foreign key (tenant_id,reservation_id) references public.ai_usage_reservations(tenant_id,id) on delete restrict,
  unique (tenant_id,reservation_id),
  constraint ai_usage_reconciliation_evidence_chk check (evidence in ('provider_invoice_no_charge','provider_invoice_usage_confirmed')),
  constraint ai_usage_reconciliation_ref_chk check (provider_receipt_ref ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{7,254}$'),
  constraint ai_usage_reconciliation_usage_chk check (
    (evidence='provider_invoice_no_charge' and actual_input_tokens is null and actual_output_tokens is null and reported_cost_usd is null)
    or (evidence='provider_invoice_usage_confirmed' and actual_input_tokens is not null and actual_output_tokens is not null and reported_cost_usd is not null
      and actual_input_tokens>=0 and actual_output_tokens>=0 and reported_cost_usd>=0)
  )
);
create unique index ai_usage_reconciliation_provider_receipt_uidx
  on public.ai_usage_reconciliation_receipts(provider_receipt_ref);
alter table public.ai_usage_reconciliation_receipts enable row level security;
alter table public.ai_usage_reconciliation_receipts force row level security;
revoke all on table public.ai_usage_reconciliation_receipts from public,anon,authenticated,service_role;

alter table public.meeting_bot_sessions
  alter column meeting_url drop not null,
  add column meeting_ref text,
  add column recall_reservation_id app.uuid_v7,
  add column tavus_reservation_id app.uuid_v7,
  add column sentinel_camera_state text not null default 'not_requested',
  add column sentinel_camera_started_at timestamptz,
  add constraint meeting_bot_sessions_sentinel_camera_state_chk
    check (sentinel_camera_state in ('not_requested','conversation_created','camera_started','cleanup_pending')),
  add constraint meeting_bot_sessions_camera_receipt_chk
    check ((sentinel_camera_state = 'camera_started') = (sentinel_camera_started_at is not null)),
  add constraint meeting_bot_sessions_meeting_ref_chk
    check (meeting_ref is null or (char_length(meeting_ref) between 8 and 255 and meeting_ref ~ '^[a-z0-9][a-z0-9:._/-]{7,254}$' and meeting_ref !~ '://')),
  add constraint meeting_bot_sessions_recall_reservation_fk foreign key(tenant_id,recall_reservation_id) references public.provider_effect_reservations(tenant_id,id) on delete restrict,
  add constraint meeting_bot_sessions_tavus_reservation_fk foreign key(tenant_id,tavus_reservation_id) references public.provider_effect_reservations(tenant_id,id) on delete restrict;

create or replace function public.portal_begin_ai_usage_reservation_service(
  p_id app.uuid_v7,p_cost_event_id app.uuid_v7,p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_source_id app.uuid_v7,
  p_idempotency_key text,p_operation text,p_max_input_tokens integer,p_max_output_tokens integer,p_max_cost_usd numeric
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_existing public.ai_usage_reservations%rowtype; v_tokens bigint; v_ingestions bigint; v_ref text;
begin
  if p_idempotency_key !~ '^[a-z0-9][a-z0-9:._/-]{7,199}$' or not (
    (p_operation='chat_generation' and p_max_input_tokens=20000 and p_max_output_tokens=512 and p_max_cost_usd=0.05)
    or (p_operation='brain_generation' and p_max_input_tokens=20000 and p_max_output_tokens=512 and p_max_cost_usd=0.05)
    or (p_operation='knowledge_query_embedding' and p_max_input_tokens=1000 and p_max_output_tokens=0 and p_max_cost_usd=0.001)
    or (p_operation='knowledge_ingestion_embedding' and p_max_input_tokens=20000 and p_max_output_tokens=0 and p_max_cost_usd=0.01)
  ) then raise exception 'AI reservation envelope does not match operation contract' using errcode='22023'; end if;
  if p_agent_id is not null and not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  if p_source_id is not null and not exists(select 1 from public.knowledge_sources where tenant_id=p_tenant_id and id=p_source_id) then raise exception 'source not found for tenant' using errcode='42501'; end if;
  if p_operation in ('chat_generation','brain_generation') and p_agent_id is null then raise exception 'agent is required' using errcode='22023'; end if;
  if p_operation='knowledge_ingestion_embedding' and p_source_id is null then raise exception 'source is required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text,0));
  select * into v_existing from public.ai_usage_reservations where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.agent_id is distinct from p_agent_id or v_existing.source_id is distinct from p_source_id or v_existing.operation is distinct from p_operation
      or v_existing.max_input_tokens is distinct from p_max_input_tokens or v_existing.max_output_tokens is distinct from p_max_output_tokens or v_existing.max_cost_usd is distinct from p_max_cost_usd then raise exception 'AI reservation replay conflict' using errcode='23505'; end if;
    return jsonb_build_object('outcome',case when v_existing.state in ('provider_in_flight','unknown') then 'blocked_unknown' else 'replayed' end,'reservationId',v_existing.id,'state',v_existing.state,'providerRequestRef',v_existing.provider_request_ref);
  end if;
  -- Uma resposta ambigua fecha TODO o budget de IA do tenant. Contar apenas
  -- o envelope ate o fim do dia permitiria novo gasto no dia seguinte sem
  -- evidencia de que a chamada anterior nao foi faturada.
  if exists(select 1 from public.ai_usage_reservations where tenant_id=p_tenant_id and state in ('provider_in_flight','unknown')) then
    return jsonb_build_object('outcome','blocked_unknown','bucket','ai_unknown_outcome');
  end if;
  select coalesce(sum(quantity),0)::bigint into v_tokens from public.cost_events c where c.tenant_id=p_tenant_id and c.unit_type='token' and c.occurred_at>=date_trunc('day',now(),'UTC')
    and not exists(select 1 from public.ai_usage_reservations r where r.tenant_id=c.tenant_id and r.cost_event_id=c.id);
  -- Reserved rows consume their envelope in the creation bucket. Committed
  -- rows consume the linked ledger quantity in the occurred_at bucket, so a
  -- dispatch before midnight and commit after midnight cannot disappear from
  -- either day. Ambiguous rows are already blocked tenant-wide above.
  select v_tokens+coalesce(sum(case
    when r.state='committed' then c.quantity
    else r.max_input_tokens+r.max_output_tokens
  end),0)::bigint into v_tokens
  from public.ai_usage_reservations r
  left join public.cost_events c on c.tenant_id=r.tenant_id and c.id=r.cost_event_id
  where r.tenant_id=p_tenant_id and r.state<>'released'
    and (
      (r.state='reserved' and r.created_at>=date_trunc('day',now(),'UTC'))
      or (r.state='committed' and c.occurred_at>=date_trunc('day',now(),'UTC'))
      or r.state in ('provider_in_flight','unknown')
    );
  if v_tokens+p_max_input_tokens+p_max_output_tokens>500000 then return jsonb_build_object('outcome','capped','bucket','ai_tokens_daily','usage',v_tokens,'cap',500000); end if;
  if p_operation='knowledge_ingestion_embedding' then
    select count(*) into v_ingestions from public.ai_usage_reservations where tenant_id=p_tenant_id and operation='knowledge_ingestion_embedding' and created_at>=date_trunc('day',now(),'UTC') and state<>'released';
    if v_ingestions>=30 then return jsonb_build_object('outcome','capped','bucket','knowledge_ingestions_daily','usage',v_ingestions,'cap',30); end if;
  end if;
  v_ref:='ppr_'||replace(p_id::text,'-','');
  insert into public.ai_usage_reservations(id,cost_event_id,tenant_id,agent_id,source_id,idempotency_key,operation,max_input_tokens,max_output_tokens,max_cost_usd,provider_request_ref)
    values(p_id,p_cost_event_id,p_tenant_id,p_agent_id,p_source_id,p_idempotency_key,p_operation,p_max_input_tokens,p_max_output_tokens,p_max_cost_usd,v_ref);
  return jsonb_build_object('outcome','reserved','reservationId',p_id,'state','reserved','providerRequestRef',v_ref);
end; $$;

create or replace function public.portal_mark_ai_usage_in_flight_service(p_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='public' as $$ declare v_state text; v_tenant app.uuid_v7; v_acquired boolean; begin
  select tenant_id into v_tenant from public.ai_usage_reservations where id=p_id;
  if not found then raise exception 'reservation not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text,0));
  update public.ai_usage_reservations r set state='provider_in_flight',provider_dispatched_at=now(),updated_at=now()
  where r.id=p_id and r.state='reserved' and r.created_at>=now()-interval '10 minutes'
    and not exists(select 1 from public.ai_usage_reservations u where u.tenant_id=r.tenant_id and u.id<>r.id and u.state in ('provider_in_flight','unknown'));
  v_acquired:=found;
  select state into v_state from public.ai_usage_reservations where id=p_id; return jsonb_build_object('acquired',v_acquired,'state',v_state);
end; $$;

create or replace function public.portal_commit_ai_usage_service(p_id app.uuid_v7,p_actual_input_tokens integer,p_actual_output_tokens integer,p_reported_cost_usd numeric default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v public.ai_usage_reservations%rowtype; v_total integer; v_source text; v_ref text; v_unit numeric(20,10); v_amount numeric(20,8);
begin
  select * into v from public.ai_usage_reservations where id=p_id for update; if not found then raise exception 'reservation not found' using errcode='P0002'; end if;
  if p_actual_input_tokens+p_actual_output_tokens=0 and p_reported_cost_usd is null then
    -- Normalize missing provider usage before both first commit and replay so
    -- the same raw caller tuple is idempotent against the persisted worst-case
    -- evidence.
    p_actual_input_tokens:=v.max_input_tokens; p_actual_output_tokens:=v.max_output_tokens;
  end if;
  if v.state='committed' then
    if v.actual_input_tokens is distinct from p_actual_input_tokens
      or v.actual_output_tokens is distinct from p_actual_output_tokens
      or v.reported_cost_usd is distinct from p_reported_cost_usd then
      raise exception 'AI usage commit replay conflict' using errcode='23505';
    end if;
    return jsonb_build_object('committed',true,'replayed',true,'costEventId',v.cost_event_id);
  end if;
  if v.state<>'provider_in_flight' or p_actual_input_tokens not between 0 and v.max_input_tokens or p_actual_output_tokens not between 0 and v.max_output_tokens then raise exception 'AI usage exceeds reservation' using errcode='55000'; end if;
  if p_reported_cost_usd is not null and (p_reported_cost_usd<0 or p_reported_cost_usd>v.max_cost_usd) then raise exception 'reported cost exceeds reservation' using errcode='22023'; end if;
  v_total:=p_actual_input_tokens+p_actual_output_tokens; v_source:=case when p_reported_cost_usd is null then 'estimated' else 'provider_reported' end; v_ref:=case when p_reported_cost_usd is null then 'openrouter.reservation.max_cost' else 'openrouter.usage.reported' end;
  if v_total=0 then v_unit:=0; v_amount:=0; else v_unit:=round(coalesce(p_reported_cost_usd,v.max_cost_usd)/v_total,10); v_amount:=round(v_total*v_unit,8); end if;
  insert into public.cost_events(tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at,rate_card_ref,rate_card_as_of,provider_request_ref)
    values(v.tenant_id,v.cost_event_id,'openrouter','portal.'||v.operation,'token',v_total,v_unit,v_amount,v_source,now(),v_ref,'2026-08-13T00:00:00Z',v.provider_request_ref);
  update public.ai_usage_reservations set state='committed',actual_input_tokens=p_actual_input_tokens,actual_output_tokens=p_actual_output_tokens,reported_cost_usd=p_reported_cost_usd,committed_at=now(),updated_at=now() where id=v.id;
  return jsonb_build_object('committed',true,'replayed',false,'costEventId',v.cost_event_id);
end; $$;

create or replace function public.portal_reconcile_ai_usage_service(
  p_receipt_id app.uuid_v7,p_reservation_id app.uuid_v7,p_evidence text,p_provider_receipt_ref text,
  p_actual_input_tokens integer default null,p_actual_output_tokens integer default null,p_reported_cost_usd numeric default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v public.ai_usage_reservations%rowtype; v_receipt public.ai_usage_reconciliation_receipts%rowtype; v_total integer; v_unit numeric(20,10); v_amount numeric(20,8);
begin
  if p_evidence not in ('provider_invoice_no_charge','provider_invoice_usage_confirmed')
    or p_provider_receipt_ref is null or p_provider_receipt_ref !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{7,254}$' then
    raise exception 'invalid AI reconciliation evidence' using errcode='22023';
  end if;
  select * into v from public.ai_usage_reservations where id=p_reservation_id for update;
  if not found then raise exception 'AI reservation not found' using errcode='P0002'; end if;
  select * into v_receipt from public.ai_usage_reconciliation_receipts where tenant_id=v.tenant_id and reservation_id=v.id;
  if found then
    if v_receipt.id is distinct from p_receipt_id or v_receipt.evidence is distinct from p_evidence
      or v_receipt.provider_receipt_ref is distinct from p_provider_receipt_ref
      or v_receipt.actual_input_tokens is distinct from p_actual_input_tokens
      or v_receipt.actual_output_tokens is distinct from p_actual_output_tokens
      or v_receipt.reported_cost_usd is distinct from p_reported_cost_usd then
      raise exception 'AI reconciliation receipt conflict' using errcode='23505';
    end if;
    return jsonb_build_object('reconciled',true,'replayed',true,'state',v.state,'costEventId',case when v.state='committed' then v.cost_event_id else null end);
  end if;
  if v.state not in ('provider_in_flight','unknown') then raise exception 'AI reconciliation requires ambiguous state' using errcode='55000'; end if;
  if p_evidence='provider_invoice_no_charge' then
    if p_actual_input_tokens is not null or p_actual_output_tokens is not null or p_reported_cost_usd is not null then raise exception 'no-charge receipt cannot carry usage' using errcode='22023'; end if;
    insert into public.ai_usage_reconciliation_receipts(id,tenant_id,reservation_id,evidence,provider_receipt_ref)
      values(p_receipt_id,v.tenant_id,v.id,p_evidence,p_provider_receipt_ref);
    update public.ai_usage_reservations set state='released',release_evidence=p_evidence,released_at=now(),updated_at=now() where id=v.id;
    return jsonb_build_object('reconciled',true,'replayed',false,'state','released','costEventId',null);
  end if;
  if p_actual_input_tokens is null or p_actual_output_tokens is null or p_reported_cost_usd is null
    or p_actual_input_tokens not between 0 and v.max_input_tokens or p_actual_output_tokens not between 0 and v.max_output_tokens
    or p_actual_input_tokens+p_actual_output_tokens<=0 or p_reported_cost_usd<0 or p_reported_cost_usd>v.max_cost_usd then
    raise exception 'confirmed AI invoice usage exceeds reservation' using errcode='22023';
  end if;
  v_total:=p_actual_input_tokens+p_actual_output_tokens;
  v_unit:=round(p_reported_cost_usd/v_total,10); v_amount:=round(v_total*v_unit,8);
  insert into public.ai_usage_reconciliation_receipts(id,tenant_id,reservation_id,evidence,provider_receipt_ref,actual_input_tokens,actual_output_tokens,reported_cost_usd)
    values(p_receipt_id,v.tenant_id,v.id,p_evidence,p_provider_receipt_ref,p_actual_input_tokens,p_actual_output_tokens,p_reported_cost_usd);
  insert into public.cost_events(tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at,rate_card_ref,rate_card_as_of,provider_request_ref)
    values(v.tenant_id,v.cost_event_id,'openrouter','portal.'||v.operation,'token',v_total,v_unit,v_amount,'provider_reported',now(),'openrouter.invoice.reconciled','2026-08-13T00:00:00Z',v.provider_request_ref);
  update public.ai_usage_reservations set state='committed',actual_input_tokens=p_actual_input_tokens,actual_output_tokens=p_actual_output_tokens,
    reported_cost_usd=p_reported_cost_usd,committed_at=now(),updated_at=now() where id=v.id;
  return jsonb_build_object('reconciled',true,'replayed',false,'state','committed','costEventId',v.cost_event_id);
end; $$;

create or replace function public.portal_ai_usage_reconciliation_backlog_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'reserved',count(*) filter(where state='reserved'),
    'providerInFlight',count(*) filter(where state='provider_in_flight'),
    'unknown',count(*) filter(where state='unknown'),
    'unknownMaxTokens',coalesce(sum(max_input_tokens+max_output_tokens) filter(where state='unknown'),0),
    'unknownMaxCostUsd',coalesce(sum(max_cost_usd) filter(where state='unknown'),0),
    'oldestProviderInFlightAgeSeconds',coalesce(floor(extract(epoch from now()-min(provider_dispatched_at) filter(where state='provider_in_flight')))::bigint,0),
    'oldestUnknownAgeSeconds',coalesce(floor(extract(epoch from now()-min(updated_at) filter(where state='unknown')))::bigint,0),
    'receiptCount',(select count(*) from public.ai_usage_reconciliation_receipts)
  ) from public.ai_usage_reservations where state in ('reserved','provider_in_flight','unknown')
$$;

create or replace function public.portal_mark_ai_usage_unknown_service(p_id app.uuid_v7,p_failure_code text) returns boolean language plpgsql security definer set search_path='public' as $$
declare v_state text; begin
  select state into v_state from public.ai_usage_reservations where id=p_id for update;
  if not found then return false; end if;
  if v_state='unknown' then return true; end if;
  if v_state<>'provider_in_flight' then return false; end if;
  update public.ai_usage_reservations set state='unknown',failure_code=left(coalesce(p_failure_code,'unknown'),80),updated_at=now() where id=p_id;
  return true;
end; $$;
create or replace function public.portal_release_ai_usage_service(p_id app.uuid_v7,p_evidence text) returns boolean language plpgsql security definer set search_path='public' as $$
declare v_state text; v_release_evidence text; begin
  -- M5-01 has no provider-side inference lookup receipt. Consequently only a
  -- reservation that never crossed the dispatch fence may be released. An
  -- ambiguous/HTTP-rejected OpenRouter request stays unknown until a future
  -- audited reconciliation contract exists.
  if p_evidence is distinct from 'not_dispatched' then raise exception 'AI release requires pre-dispatch evidence' using errcode='22023'; end if;
  select state,release_evidence into v_state,v_release_evidence from public.ai_usage_reservations where id=p_id for update;
  if not found then return false; end if;
  if v_state='released' then return v_release_evidence=p_evidence; end if;
  if v_state<>'reserved' then return false; end if;
  update public.ai_usage_reservations set state='released',release_evidence=p_evidence,released_at=now(),updated_at=now() where id=p_id;
  return true;
end; $$;

create or replace function public.portal_begin_provider_effect_service(
  p_reservation_id app.uuid_v7,
  p_cost_event_id app.uuid_v7,
  p_tenant_id app.uuid_v7,
  p_agent_id app.uuid_v7,
  p_idempotency_key text,
  p_provider_id text,
  p_effect_kind text,
  p_cap_bucket text,
  p_related_ref text default null,
  p_meter_event_name text default 'axtro_conversation_overage',
  p_max_duration_seconds integer default null
) returns jsonb
language plpgsql security definer set search_path = 'public'
as $$
declare
  v_existing public.provider_effect_reservations%rowtype;
  v_sub public.tenant_subscriptions%rowtype;
  v_count bigint;
  v_month_count bigint;
  v_pending_delivery_count bigint;
  v_no_delivery_count bigint;
  v_included integer := 0;
  v_trial_period_start timestamptz;
  v_max_duration integer;
  v_estimated_cost numeric(20,8);
  v_rate_card_ref text;
  v_request_ref text;
begin
  if not exists (select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then
    raise exception 'agent not found for tenant' using errcode='42501';
  end if;
  if p_provider_id not in ('tavus','recall')
    or p_effect_kind not in ('tavus_conversation','recall_bot')
    or p_cap_bucket not in ('tavus_video_daily','recall_bot_active')
    or (p_provider_id='tavus') is distinct from (p_effect_kind='tavus_conversation')
    or (p_provider_id='tavus') is distinct from (p_cap_bucket='tavus_video_daily') then
    raise exception 'invalid provider effect tuple' using errcode='22023';
  end if;
  if p_idempotency_key !~ '^[a-z0-9][a-z0-9:._/-]{7,199}$' then
    raise exception 'invalid idempotency key' using errcode='22023';
  end if;
  if p_related_ref is not null and (
    char_length(p_related_ref) not between 1 and 255
    or p_related_ref !~ '^[a-z0-9][a-z0-9:._/-]{0,254}$'
    or p_related_ref ~ '://'
  ) then
    raise exception 'related_ref must be a bounded opaque reference' using errcode='22023';
  end if;
  if p_meter_event_name is null or p_meter_event_name !~ '^[a-z][a-z0-9_]{2,99}$' then
    raise exception 'invalid meter event name' using errcode='22023';
  end if;
  if p_provider_id='tavus' then
    if p_max_duration_seconds is null or p_max_duration_seconds not between 60 and 1800 then
      raise exception 'Tavus max duration must be 60..1800 seconds' using errcode='22023';
    end if;
    v_max_duration := p_max_duration_seconds;
    -- Conservative published CVI overage as of 2026-08-13: USD .37/min.
    -- Tavus' public pricing page is internally inconsistent; the actual
    -- account rate remains pending dashboard/invoice reconciliation.
    v_estimated_cost := round(ceil(v_max_duration / 60.0) * 0.37, 8);
    v_rate_card_ref := 'tavus.cvi_overage.max_published_0_37_per_minute_2026_08_13';
  else
    if p_max_duration_seconds is not null then
      raise exception 'Recall duration is fixed server-side' using errcode='22023';
    end if;
    v_max_duration := 2400;
    -- Public PAYG reference as of 2026-08-13: web_4_core total USD .60/h
    -- plus Recall transcription USD .15/h, reserved for the hard 40m cap.
    v_estimated_cost := round((0.75 / 60.0) * 40, 8);
    v_rate_card_ref := 'recall.web_4_core_plus_transcript.max_40m';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text, 0));
  select * into v_existing from public.provider_effect_reservations
    where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.agent_id is distinct from p_agent_id
      or v_existing.provider_id is distinct from p_provider_id
      or v_existing.effect_kind is distinct from p_effect_kind
      or v_existing.cap_bucket is distinct from p_cap_bucket
      or v_existing.related_ref is distinct from p_related_ref
      or v_existing.meter_event_name is distinct from p_meter_event_name
      or v_existing.max_duration_seconds is distinct from v_max_duration then
      raise exception 'provider effect replay tuple conflict' using errcode='23505';
    end if;
    if v_existing.state in ('unknown','cleanup_pending','provider_in_flight') then
      return jsonb_build_object('outcome','blocked_unknown','reservationId',v_existing.id,'state',v_existing.state);
    end if;
    return jsonb_build_object('outcome','replayed','reservationId',v_existing.id,'state',v_existing.state,
      'costEventId',v_existing.cost_event_id,'providerRequestRef',v_existing.provider_request_ref,
      'providerRef',v_existing.provider_ref,'providerUrl',v_existing.provider_url,'billableOverage',v_existing.billable_overage,
      'customerDeliveryState',v_existing.customer_delivery_state,'retryGeneration',v_existing.retry_generation,
      'maxDurationSeconds',v_existing.max_duration_seconds,'estimatedCostUsd',v_existing.estimated_cost_usd);
  end if;

  if exists (
    select 1 from public.provider_effect_reservations r
    where r.tenant_id=p_tenant_id and r.agent_id=p_agent_id
      and r.provider_id=p_provider_id and r.effect_kind=p_effect_kind
      and r.related_ref is not distinct from p_related_ref
      and r.state in ('provider_in_flight','unknown','cleanup_pending')
  ) then
    return jsonb_build_object('outcome','blocked_unknown');
  end if;

  select * into v_sub from public.tenant_subscriptions where tenant_id=p_tenant_id;
  if not found then return jsonb_build_object('outcome','capped','bucket','billing_status','status','no_subscription'); end if;
  if v_sub.status not in ('active','trialing') then return jsonb_build_object('outcome','capped','bucket','billing_status','status',v_sub.status); end if;

  if p_cap_bucket='tavus_video_daily' then
    select count(*) into v_count from public.cost_events c
      where c.tenant_id=p_tenant_id and c.unit_type='conversation' and c.occurred_at>=date_trunc('day',now(),'UTC')
      and not exists (select 1 from public.provider_effect_reservations r where r.tenant_id=c.tenant_id and r.cost_event_id=c.id);
    select v_count + count(*) into v_count from public.provider_effect_reservations r
      where r.tenant_id=p_tenant_id and r.cap_bucket=p_cap_bucket and r.state<>'released'
        and (
          r.state in ('provider_in_flight','unknown','cleanup_pending')
          or (r.state='reserved' and r.created_at>=date_trunc('day',now(),'UTC'))
          or (r.state in ('committed','completed') and exists (
            select 1 from public.cost_events c where c.tenant_id=r.tenant_id and c.id=r.cost_event_id
              and c.occurred_at>=date_trunc('day',now(),'UTC')
          ))
        );
    if v_count>=20 then return jsonb_build_object('outcome','capped','bucket',p_cap_bucket,'usage',v_count,'cap',20); end if;
  else
    select count(*) into v_count from public.meeting_bot_sessions s where s.tenant_id=p_tenant_id and s.status not in ('ended','failed')
      and not exists (select 1 from public.provider_effect_reservations r where r.id=s.recall_reservation_id);
    select v_count + count(*) into v_count from public.provider_effect_reservations r
      where r.tenant_id=p_tenant_id and r.cap_bucket=p_cap_bucket and r.state not in ('released','completed');
    if v_count>=20 then return jsonb_build_object('outcome','capped','bucket',p_cap_bucket,'usage',v_count,'cap',20); end if;

    -- Active concurrency is not a financial budget: short or compensated
    -- bots would otherwise leave that bucket and permit unbounded sequential
    -- Recall spend. Count committed evidence by ledger time and retain only
    -- uncommitted envelopes that can still represent spend.
    select count(*) into v_month_count from public.cost_events c
      where c.tenant_id=p_tenant_id and c.provider_id='recall'
        and c.service='portal.meeting_bot_session'
        and c.occurred_at>=date_trunc('day',now(),'UTC')
        and not exists (
          select 1 from public.provider_effect_reservations r
          where r.tenant_id=c.tenant_id and r.cost_event_id=c.id
        );
    select v_month_count + count(*) into v_month_count
    from public.provider_effect_reservations r
    left join public.cost_events c on c.tenant_id=r.tenant_id and c.id=r.cost_event_id
    where r.tenant_id=p_tenant_id and r.provider_id='recall'
      and (
        (c.id is not null and c.occurred_at>=date_trunc('day',now(),'UTC'))
        or (c.id is null and r.state='reserved' and r.created_at>=date_trunc('day',now(),'UTC'))
        or (c.id is null and r.state in ('provider_in_flight','unknown','cleanup_pending'))
      );
    if v_month_count>=20 then
      return jsonb_build_object('outcome','capped','bucket','recall_bot_daily','usage',v_month_count,'cap',20);
    end if;
  end if;

  v_trial_period_start := case when v_sub.status in ('active','trialing') then coalesce(v_sub.current_period_start,date_trunc('month',now())) else date_trunc('month',now()) end;
  if p_provider_id='tavus' then
    -- A room starts accruing Tavus cost at creation, before customer delivery
    -- is proven. Bound both the concurrent unproven exposure and the number of
    -- provider-paid conversations that ended without delivery in one billing
    -- period. Activated overage remains unaffected.
    select count(*) into v_pending_delivery_count
    from public.provider_effect_reservations r
    where r.tenant_id=p_tenant_id and r.provider_id='tavus'
      and r.customer_delivery_state='held'
      and r.state in ('reserved','provider_in_flight','committed','unknown','cleanup_pending','completed');
    select count(*) into v_no_delivery_count
    from public.provider_effect_reservations r
    where r.tenant_id=p_tenant_id and r.provider_id='tavus'
      and r.provider_dispatched_at is not null
      and r.provider_dispatched_at>=v_trial_period_start
      and (v_sub.current_period_end is null or r.provider_dispatched_at<v_sub.current_period_end)
      and (r.customer_delivery_state='voided' or (r.state='released' and r.customer_delivery_state<>'activated'));
    if v_pending_delivery_count+v_no_delivery_count>=3 then
      return jsonb_build_object(
        'outcome','capped','bucket','tavus_no_delivery_period',
        'usage',v_pending_delivery_count+v_no_delivery_count,'cap',3,
        'pending',v_pending_delivery_count,'noDelivery',v_no_delivery_count
      );
    end if;
  end if;
  if p_cap_bucket='tavus_video_daily' then
    v_included := case v_sub.plan_id when 'piloto' then 7 when 'crescimento' then 30 when 'escala' then 85 else 5 end;
    select count(*) into v_month_count from public.cost_events c where c.tenant_id=p_tenant_id and c.unit_type='conversation' and c.occurred_at>=v_trial_period_start
      and not exists (select 1 from public.provider_effect_reservations r where r.tenant_id=c.tenant_id and r.cost_event_id=c.id);
    select v_month_count + count(*) into v_month_count from public.provider_effect_reservations r
      where r.tenant_id=p_tenant_id and r.cap_bucket='tavus_video_daily' and r.state<>'released'
        and (
          r.state in ('provider_in_flight','unknown','cleanup_pending')
          or (r.state='reserved' and r.created_at>=v_trial_period_start)
          or (r.state in ('committed','completed') and exists (
            select 1 from public.cost_events c where c.tenant_id=r.tenant_id and c.id=r.cost_event_id
              and c.occurred_at>=v_trial_period_start
              and (v_sub.current_period_end is null or c.occurred_at<v_sub.current_period_end)
          ))
        );
    if v_month_count>=v_included and v_sub.status is distinct from 'active' then
      return jsonb_build_object('outcome','capped','bucket','tavus_monthly_trial','usage',v_month_count,'cap',v_included);
    end if;
  end if;
  v_request_ref := 'ppr_'||replace(p_reservation_id::text,'-','');
  insert into public.provider_effect_reservations(id,tenant_id,agent_id,idempotency_key,provider_id,effect_kind,cap_bucket,cost_event_id,provider_request_ref,related_ref,meter_event_name,max_duration_seconds,estimated_cost_usd,cost_rate_card_ref,cost_rate_card_as_of)
  values(p_reservation_id,p_tenant_id,p_agent_id,p_idempotency_key,p_provider_id,p_effect_kind,p_cap_bucket,p_cost_event_id,v_request_ref,p_related_ref,p_meter_event_name,v_max_duration,v_estimated_cost,v_rate_card_ref,'2026-08-13T00:00:00Z');
  return jsonb_build_object('outcome','reserved','reservationId',p_reservation_id,'state','reserved','providerRequestRef',v_request_ref,'billableOverage',false,'customerDeliveryState','held','retryGeneration',0,'maxDurationSeconds',v_max_duration,'estimatedCostUsd',v_estimated_cost);
end; $$;

create or replace function public.portal_mark_provider_effect_in_flight_service(p_reservation_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.provider_effect_reservations%rowtype;
begin
  select * into v_row from public.provider_effect_reservations where id=p_reservation_id for update;
  if not found then raise exception 'reservation not found' using errcode='P0002'; end if;
  if v_row.state='reserved' and v_row.created_at>=now()-interval '10 minutes' then
    update public.provider_effect_reservations set state='provider_in_flight',provider_dispatched_at=now(),updated_at=now() where id=p_reservation_id;
    return jsonb_build_object('acquired',true,'state','provider_in_flight');
  end if;
  return jsonb_build_object('acquired',false,'state',v_row.state,'providerRef',v_row.provider_ref,'providerUrl',v_row.provider_url);
end; $$;

create or replace function public.portal_mark_provider_effect_unknown_service(p_reservation_id app.uuid_v7,p_failure_code text)
returns boolean language plpgsql security definer set search_path='public' as $$
begin
  update public.provider_effect_reservations set state='unknown',failure_code=left(coalesce(p_failure_code,'unknown'),80),updated_at=now()
    where id=p_reservation_id and state='provider_in_flight';
  return found;
end; $$;

create or replace function public.portal_release_provider_effect_service(p_reservation_id app.uuid_v7,p_evidence text)
returns boolean language plpgsql security definer set search_path='public' as $$
begin
  if p_evidence<>'not_dispatched' then raise exception 'request-path release requires pre-dispatch evidence' using errcode='22023'; end if;
  update public.provider_effect_reservations set state='released',release_evidence=p_evidence,released_at=now(),retry_generation=retry_generation+1,updated_at=now()
    where id=p_reservation_id and state='reserved';
  return found;
end; $$;

create or replace function public.portal_reconcile_provider_effect_service(p_receipt_id app.uuid_v7,p_reservation_id app.uuid_v7,p_evidence text,p_provider_receipt_ref text)
returns boolean language plpgsql security definer set search_path='public' as $$
declare v_row public.provider_effect_reservations%rowtype; v_receipt public.provider_effect_reconciliation_receipts%rowtype;
begin
  if p_evidence not in ('provider_rejected','reconciliation_absent','compensation_confirmed') or p_provider_receipt_ref is null or p_provider_receipt_ref !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{7,254}$' then
    raise exception 'invalid reconciliation receipt' using errcode='22023';
  end if;
  select * into v_row from public.provider_effect_reservations where id=p_reservation_id for update;
  if not found then return false; end if;
  select * into v_receipt from public.provider_effect_reconciliation_receipts where tenant_id=v_row.tenant_id and reservation_id=v_row.id;
  if found then
    if v_receipt.id is distinct from p_receipt_id or v_receipt.evidence is distinct from p_evidence or v_receipt.provider_receipt_ref is distinct from p_provider_receipt_ref then
      raise exception 'reconciliation receipt conflict' using errcode='23505';
    end if;
    return v_row.state='released';
  end if;
  if v_row.state not in ('provider_in_flight','unknown','cleanup_pending') then return false; end if;
  insert into public.provider_effect_reconciliation_receipts(id,tenant_id,reservation_id,evidence,provider_receipt_ref)
  values(p_receipt_id,v_row.tenant_id,v_row.id,p_evidence,p_provider_receipt_ref);
  update public.provider_effect_reservations set state='released',release_evidence=p_evidence,released_at=now(),retry_generation=retry_generation+1,
    reconciliation_lease_token=null,reconciliation_lease_until=null,
    tavus_webhook_capability_revoked_at=case when provider_id='tavus' and tavus_webhook_capability_hash is not null then coalesce(tavus_webhook_capability_revoked_at,now()) else tavus_webhook_capability_revoked_at end,
    updated_at=now() where id=v_row.id;
  return true;
end; $$;

create or replace function public.portal_lease_provider_effect_reconciliation_service(p_lease_token app.uuid_v7,p_limit integer default 20,p_lease_seconds integer default 60)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_rows jsonb;
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 15 and 300 then raise exception 'invalid lease parameters' using errcode='22023'; end if;
  -- A row that is still `reserved` has, by contract, never crossed either
  -- provider dispatch fence. It is therefore the one state that time plus a
  -- state CAS can safely reclaim after a crashed request. Row locks serialize
  -- sweep x bind/acquire: either dispatch wins and the row is not released, or
  -- the sweep wins and the subsequent dispatch fence fails.
  with stale as (
    select id from public.provider_effect_reservations
    where state='reserved' and created_at<now()-interval '10 minutes'
    order by created_at,id for update skip locked limit 100
  ) update public.provider_effect_reservations r set state='released',release_evidence='stale_not_dispatched',
      released_at=now(),retry_generation=retry_generation+1,updated_at=now()
    from stale where r.id=stale.id and r.state='reserved';
  with stale as (
    select id from public.ai_usage_reservations
    where state='reserved' and created_at<now()-interval '10 minutes'
    order by created_at,id for update skip locked limit 100
  ) update public.ai_usage_reservations r set state='released',release_evidence='stale_not_dispatched',released_at=now(),updated_at=now()
    from stale where r.id=stale.id and r.state='reserved';
  -- A process can die after the dispatch fence and before it records the
  -- provider outcome. Promote that durable ambiguity to `unknown`; never
  -- release it automatically or let the next day reopen the tenant budget.
  with stale as (
    select id from public.ai_usage_reservations
    where state='provider_in_flight' and provider_dispatched_at<now()-interval '10 minutes'
    order by provider_dispatched_at,id for update skip locked limit 100
  ) update public.ai_usage_reservations r
    set state='unknown',failure_code=coalesce(r.failure_code,'process_lost_after_dispatch'),updated_at=now()
    from stale where r.id=stale.id and r.state='provider_in_flight';
  with claimed as (
    select id from public.provider_effect_reservations
    where state in ('provider_in_flight','unknown','cleanup_pending')
      and reconciliation_dead_lettered_at is null and reconciliation_available_at<=now()
      and (reconciliation_lease_token is null or reconciliation_lease_until<=now())
      and not exists(select 1 from public.provider_effect_reconciliation_receipts x where x.tenant_id=provider_effect_reservations.tenant_id and x.reservation_id=provider_effect_reservations.id)
    order by created_at,id for update skip locked limit p_limit
  ), updated as (
    update public.provider_effect_reservations r set reconciliation_lease_token=p_lease_token,reconciliation_lease_until=now()+make_interval(secs=>p_lease_seconds),reconciliation_attempts=reconciliation_attempts+1,updated_at=now()
    from claimed where r.id=claimed.id returning r.*
  ) select coalesce(jsonb_agg(jsonb_build_object('reservationId',id,'providerId',provider_id,'providerRef',provider_ref,'state',state,'createdAt',created_at,'attempts',reconciliation_attempts,'nextAttemptAt',reconciliation_available_at,'leaseToken',p_lease_token) order by created_at,id),'[]'::jsonb) into v_rows from updated;
  return v_rows;
end; $$;

create or replace function public.portal_ack_provider_effect_reconciliation_service(
  p_reservation_id app.uuid_v7,p_lease_token app.uuid_v7,p_receipt_id app.uuid_v7,p_evidence text,p_provider_receipt_ref text
) returns boolean language plpgsql security definer set search_path='public' as $$
declare v_row public.provider_effect_reservations%rowtype; v_receipt public.provider_effect_reconciliation_receipts%rowtype;
begin
  if p_evidence not in ('provider_rejected','reconciliation_absent','compensation_confirmed') or p_provider_receipt_ref is null or p_provider_receipt_ref !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{7,254}$' then raise exception 'invalid reconciliation receipt' using errcode='22023'; end if;
  select * into v_row from public.provider_effect_reservations where id=p_reservation_id for update; if not found then return false; end if;
  select * into v_receipt from public.provider_effect_reconciliation_receipts where tenant_id=v_row.tenant_id and reservation_id=v_row.id;
  if found then
    if v_receipt.id is distinct from p_receipt_id or v_receipt.evidence is distinct from p_evidence or v_receipt.provider_receipt_ref is distinct from p_provider_receipt_ref then raise exception 'reconciliation receipt conflict' using errcode='23505'; end if;
    return v_row.state='released';
  end if;
  if v_row.state not in ('provider_in_flight','unknown','cleanup_pending') or v_row.reconciliation_lease_token is distinct from p_lease_token or v_row.reconciliation_lease_until<=now() then return false; end if;
  insert into public.provider_effect_reconciliation_receipts(id,tenant_id,reservation_id,evidence,provider_receipt_ref) values(p_receipt_id,v_row.tenant_id,v_row.id,p_evidence,p_provider_receipt_ref);
  update public.provider_effect_reservations set state='released',release_evidence=p_evidence,released_at=now(),retry_generation=retry_generation+1,
    reconciliation_lease_token=null,reconciliation_lease_until=null,
    tavus_webhook_capability_revoked_at=case when provider_id='tavus' and tavus_webhook_capability_hash is not null then coalesce(tavus_webhook_capability_revoked_at,now()) else tavus_webhook_capability_revoked_at end,
    updated_at=now() where id=v_row.id;
  return true;
end; $$;

create or replace function public.portal_fail_provider_effect_reconciliation_service(
  p_reservation_id app.uuid_v7,p_lease_token app.uuid_v7,p_error_code text,p_retry_seconds integer,p_permanent boolean default false
) returns boolean language plpgsql security definer set search_path='public' as $$
begin
  update public.provider_effect_reservations set reconciliation_lease_token=null,reconciliation_lease_until=null,
    reconciliation_available_at=now()+make_interval(secs=>least(greatest(p_retry_seconds,5),86400)),reconciliation_last_error_code=left(coalesce(p_error_code,'provider_error'),80),
    reconciliation_dead_lettered_at=case when p_permanent or reconciliation_attempts>=8 then now() else null end,updated_at=now()
  where id=p_reservation_id and state in ('provider_in_flight','unknown','cleanup_pending') and reconciliation_lease_token=p_lease_token and reconciliation_lease_until>now();
  return found;
end; $$;

create or replace function public.portal_provider_effect_reconciliation_backlog_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'pending',count(*) filter(where reconciliation_dead_lettered_at is null and (reconciliation_lease_token is null or reconciliation_lease_until<=now())),
    'processing',count(*) filter(where reconciliation_lease_token is not null and reconciliation_lease_until>now()),
    'deadLetter',count(*) filter(where reconciliation_dead_lettered_at is not null),
    'providerInFlight',count(*) filter(where state='provider_in_flight'),
    'unknown',count(*) filter(where state='unknown'),
    'cleanupPending',count(*) filter(where state='cleanup_pending'),
    'oldestAgeSeconds',coalesce(floor(extract(epoch from now()-min(created_at)))::bigint,0),
    'oldestUnknownAgeSeconds',coalesce(floor(extract(epoch from now()-min(created_at) filter(where state='unknown')))::bigint,0)
  ) from public.provider_effect_reservations where state in ('provider_in_flight','unknown','cleanup_pending')
$$;

create or replace function public.portal_mark_provider_effect_cleanup_pending_service(p_reservation_id app.uuid_v7,p_provider_ref text,p_failure_code text)
returns boolean language plpgsql security definer set search_path='public' as $$
declare v public.provider_effect_reservations%rowtype;
begin
  select * into v from public.provider_effect_reservations where id=p_reservation_id for update;
  if not found then return false; end if;
  if v.state='cleanup_pending' then
    if v.provider_ref is distinct from p_provider_ref then raise exception 'cleanup replay provider ref conflict' using errcode='23505'; end if;
    return true;
  end if;
  if v.provider_ref is not null and v.provider_ref is distinct from p_provider_ref then raise exception 'cleanup provider ref conflict' using errcode='23505'; end if;
  update public.provider_effect_reservations set state='cleanup_pending',provider_ref=coalesce(provider_ref,p_provider_ref),failure_code=left(coalesce(p_failure_code,'cleanup_pending'),80),
    tavus_webhook_capability_revoked_at=case when provider_id='tavus' and tavus_webhook_capability_hash is not null then coalesce(tavus_webhook_capability_revoked_at,now()) else tavus_webhook_capability_revoked_at end,
    updated_at=now()
    where id=p_reservation_id and state in ('provider_in_flight','committed','unknown');
  return found;
end; $$;

create or replace function public.portal_commit_provider_effect_service(p_reservation_id app.uuid_v7,p_provider_ref text,p_provider_url text default null,p_related_ref text default null)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.provider_effect_reservations%rowtype;
begin
  select * into v_row from public.provider_effect_reservations where id=p_reservation_id for update;
  if not found then raise exception 'reservation not found' using errcode='P0002'; end if;
  if v_row.state in ('committed','completed') then
    if v_row.provider_ref is distinct from p_provider_ref
      or v_row.provider_url is distinct from p_provider_url
      or (p_related_ref is not null and v_row.related_ref is distinct from p_related_ref) then
      raise exception 'provider effect commit replay conflict' using errcode='23505';
    end if;
    return jsonb_build_object('committed',true,'replayed',true,'costEventId',v_row.cost_event_id,'billableOverage',v_row.billable_overage,'customerDeliveryState',v_row.customer_delivery_state);
  end if;
  if v_row.state<>'provider_in_flight' then raise exception 'reservation is not in flight' using errcode='55000'; end if;
  if p_provider_ref is null or char_length(p_provider_ref) not between 1 and 255 then raise exception 'invalid provider ref' using errcode='22023'; end if;
  insert into public.cost_events(tenant_id,id,provider_id,service,unit_type,quantity,unit_cost_usd,amount_usd,source,occurred_at,rate_card_ref,rate_card_as_of,provider_request_ref)
  values(v_row.tenant_id,v_row.cost_event_id,v_row.provider_id,
    case when v_row.provider_id='tavus' then 'portal.video_conversation' else 'portal.meeting_bot_session' end,
    case when v_row.provider_id='tavus' then 'conversation' else 'flat' end,1,
    v_row.estimated_cost_usd,v_row.estimated_cost_usd,'estimated',now(),
    v_row.cost_rate_card_ref,v_row.cost_rate_card_as_of,v_row.provider_request_ref);
  update public.provider_effect_reservations set state='committed',provider_ref=p_provider_ref,provider_url=p_provider_url,related_ref=coalesce(p_related_ref,related_ref),committed_at=now(),updated_at=now() where id=p_reservation_id;
  return jsonb_build_object('committed',true,'replayed',false,'costEventId',v_row.cost_event_id,'billableOverage',false,'customerDeliveryState','held');
end; $$;

-- Provider acceptance records cost. Customer-visible delivery activates the
-- billing ordinal separately so unusable calls never race the Stripe lease.
create or replace function public.portal_activate_provider_effect_billing_service(p_reservation_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare
  v_row public.provider_effect_reservations%rowtype;
  v_session public.meeting_bot_sessions%rowtype;
  v_sub public.tenant_subscriptions%rowtype;
  v_legacy_count bigint;
  v_activated_count bigint;
  v_billable boolean := false;
  v_activation_at timestamptz := clock_timestamp();
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_included integer := 0;
  v_customer text;
  v_receipt_kind text;
  v_receipt_ref text;
begin
  select * into v_row from public.provider_effect_reservations where id=p_reservation_id;
  if not found then raise exception 'reservation not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_row.tenant_id::text,0));
  -- Keep lock order aligned with terminal meeting transitions: session first,
  -- then reservation. This makes terminal x activation races deterministic.
  select * into v_session from public.meeting_bot_sessions
    where tenant_id=v_row.tenant_id and (recall_reservation_id=p_reservation_id or tavus_reservation_id=p_reservation_id)
    order by created_at desc limit 1 for update;
  select * into v_row from public.provider_effect_reservations where id=p_reservation_id for update;
  if v_row.customer_delivery_state='activated' then
    return jsonb_build_object('activated',true,'replayed',true,'customerDeliveryState','activated','billableOverage',v_row.billable_overage);
  end if;
  if v_row.customer_delivery_state='voided' then
    return jsonb_build_object('activated',false,'replayed',true,'customerDeliveryState','voided','billableOverage',false);
  end if;
  if v_row.state not in ('committed','completed') then raise exception 'committed provider effect required' using errcode='55000'; end if;

  if v_row.provider_id='recall' then
    if v_session.recall_bot_id is null or v_session.recall_reservation_id is distinct from v_row.id
      or v_session.sentinel_camera_state is distinct from 'camera_started' or v_session.sentinel_camera_started_at is null then
      raise exception 'durable camera-start receipt required' using errcode='55000';
    end if;
    v_receipt_kind := 'camera_started';
    v_receipt_ref := v_session.recall_bot_id||':'||coalesce(v_session.tavus_conversation_id,'voice_only');
  elsif v_session.tavus_reservation_id=v_row.id then
    if v_session.sentinel_camera_state is distinct from 'camera_started' or v_session.sentinel_camera_started_at is null then
      raise exception 'durable camera-start receipt required' using errcode='55000';
    end if;
    v_receipt_kind := 'camera_started';
    v_receipt_ref := v_session.recall_bot_id||':'||v_row.provider_ref;
  elsif exists(select 1 from public.tavus_customer_delivery_receipts d where d.tenant_id=v_row.tenant_id and d.reservation_id=v_row.id and d.receipt_kind='delivered') then
    v_receipt_kind := 'tavus_customer_delivery';
    v_receipt_ref := v_row.provider_ref;
  else
    raise exception 'durable customer-delivery receipt required' using errcode='55000';
  end if;

  select * into v_sub from public.tenant_subscriptions where tenant_id=v_row.tenant_id for update;
  if v_sub.status='active' then
    if v_sub.current_period_start is null or v_sub.current_period_end is null
      or not (v_activation_at>=v_sub.current_period_start and v_activation_at<v_sub.current_period_end)
      or v_sub.stripe_customer_id is null then
      raise exception 'active billing period is not current' using errcode='55000';
    end if;
    v_period_start := v_sub.current_period_start;
    v_period_end := v_sub.current_period_end;
    v_customer := v_sub.stripe_customer_id;
    v_included := case v_sub.plan_id when 'piloto' then 7 when 'crescimento' then 30 when 'escala' then 85 else 0 end;
  else
    v_period_start := date_trunc('month',v_activation_at);
    v_period_end := v_period_start+interval '1 month';
    v_customer := null;
    v_included := case v_sub.plan_id when 'piloto' then 7 when 'crescimento' then 30 when 'escala' then 85 else 5 end;
  end if;

  if v_row.cap_bucket='tavus_video_daily' then
    select count(*) into v_legacy_count from public.cost_events c
      where c.tenant_id=v_row.tenant_id and c.unit_type='conversation'
        and c.occurred_at>=v_period_start and c.occurred_at<v_period_end
        and not exists(select 1 from public.provider_effect_reservations r where r.tenant_id=c.tenant_id and r.cost_event_id=c.id);
    select count(*) into v_activated_count from public.provider_effect_reservations r
      where r.tenant_id=v_row.tenant_id and r.cap_bucket='tavus_video_daily'
        and r.customer_delivery_state='activated'
        and r.customer_activated_at>=v_period_start and r.customer_activated_at<v_period_end;
    v_billable := v_customer is not null and (v_legacy_count+v_activated_count)>=v_included;
  end if;

  update public.provider_effect_reservations set
    customer_delivery_state='activated',customer_activated_at=v_activation_at,
    customer_delivery_receipt_kind=v_receipt_kind,customer_delivery_receipt_ref=v_receipt_ref,customer_delivery_receipt_at=v_activation_at,
    billing_period_start=v_period_start,billing_period_end=v_period_end,included_quantity=v_included,
    stripe_customer_id=v_customer,meter_event_at=v_activation_at,billing_snapshot_at=v_activation_at,
    billable_overage=v_billable,updated_at=v_activation_at where id=v_row.id;
  if v_billable then
    -- One billable reservation has exactly one application-generated cost ID,
    -- so the same UUIDv7 is also the stable identity of its delivery outbox row.
    insert into public.billing_usage_outbox(id,tenant_id,reservation_id,cost_event_id,stripe_customer_id,meter_event_name,quantity,idempotency_key,billing_period_start,billing_period_end,meter_event_at)
    values(v_row.cost_event_id,v_row.tenant_id,v_row.id,v_row.cost_event_id,v_customer,v_row.meter_event_name,1,'overage:'||v_customer||':'||v_row.cost_event_id,v_period_start,v_period_end,v_activation_at);
  end if;
  return jsonb_build_object('activated',true,'replayed',false,'customerDeliveryState','activated','billableOverage',v_billable);
end; $$;

create or replace function public.portal_complete_provider_effect_service(p_reservation_id app.uuid_v7)
returns boolean language plpgsql security definer set search_path='public' as $$
begin update public.provider_effect_reservations set state='completed',completed_at=now(),updated_at=now() where id=p_reservation_id and state='committed'; return found; end; $$;

create or replace function public.portal_update_meeting_bot_session_status_service(
  p_recall_bot_id text,p_status text,p_delivery_id text default null,p_claim_token app.uuid_v7 default null
)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_session public.meeting_bot_sessions%rowtype; v_session_found boolean:=false; v_applied boolean:=false; v_terminal_bound boolean:=false;
begin
  if p_status not in ('created','joining','in_call','ended','failed') then raise exception 'invalid status' using errcode='22023'; end if;
  if p_status in ('ended','failed') and (p_delivery_id is null or p_claim_token is null) then
    raise exception 'terminal status requires delivery claim evidence' using errcode='55000';
  end if;
  if p_status not in ('ended','failed') and (p_delivery_id is not null or p_claim_token is not null) then
    raise exception 'delivery claim evidence is terminal-only' using errcode='22023';
  end if;
  -- Bot-scoped ordering closes the pre-session terminal race without relying
  -- on tenant discovery: either the signed receipt commits first and record
  -- observes it, or the session commits first and this transition observes it.
  perform pg_advisory_xact_lock(hashtextextended('recall-bot:'||p_recall_bot_id,0));
  select * into v_session from public.meeting_bot_sessions where recall_bot_id=p_recall_bot_id;
  v_session_found:=found;
  if p_status in ('ended','failed') then
    update public.recall_webhook_deliveries set provider_bot_id=p_recall_bot_id,terminal_status=p_status,updated_at=now()
      where delivery_id=p_delivery_id and claim_token=p_claim_token and status='processing' and lease_until>now()
        and (provider_bot_id is null or (provider_bot_id=p_recall_bot_id and terminal_status=p_status))
        and (tenant_id is null or (v_session.tenant_id is not null and tenant_id=v_session.tenant_id));
    if not found then raise exception 'terminal delivery claim receipt required' using errcode='55000'; end if;
    if v_session.tenant_id is not null then
      update public.recall_webhook_deliveries set tenant_id=v_session.tenant_id
        where delivery_id=p_delivery_id and tenant_id is null;
    end if;
    v_terminal_bound:=true;
  end if;
  -- Same tenant lock and row-lock order used by billing activation.
  if not v_session_found then return jsonb_build_object('found',false,'applied',v_terminal_bound,'terminalRetained',v_terminal_bound); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_session.tenant_id::text,0));
  select * into v_session from public.meeting_bot_sessions where recall_bot_id=p_recall_bot_id for update;
  if v_session.status in ('ended','failed') then
    return jsonb_build_object(
      'found',true,'applied',false,'terminalRetained',v_terminal_bound,
      'tavusReservationId',v_session.tavus_reservation_id,'tavusConversationId',v_session.tavus_conversation_id,
      'tavusCleanupRequired',v_session.tavus_reservation_id is not null and v_session.sentinel_camera_state<>'camera_started'
    );
  end if;
  if v_session.status is distinct from p_status then
    update public.meeting_bot_sessions set status=p_status,updated_at=now(),ended_at=case when p_status in ('ended','failed') then now() else ended_at end where recall_bot_id=p_recall_bot_id;
    v_applied:=true;
  end if;
  if v_applied and p_status in ('ended','failed') then
    if v_session.sentinel_camera_state<>'camera_started' then
      if exists(select 1 from public.billing_usage_outbox where reservation_id in (v_session.recall_reservation_id,v_session.tavus_reservation_id)
        and (status not in ('pending','failed') or lease_token is not null or lease_until is not null)) then
        raise exception 'terminal billing delivery is already in flight' using errcode='55000';
      end if;
      update public.billing_usage_outbox set status='voided',terminal_reason='meeting_terminal_before_delivery',updated_at=now()
        where reservation_id in (v_session.recall_reservation_id,v_session.tavus_reservation_id) and status in ('pending','failed') and lease_token is null and lease_until is null;
      update public.provider_effect_reservations set
        state=case when id=v_session.tavus_reservation_id and provider_ref is not null and customer_delivery_state='held' then 'cleanup_pending' else 'completed' end,
        completed_at=case when id=v_session.tavus_reservation_id and provider_ref is not null and customer_delivery_state='held' then completed_at else now() end,
        failure_code=case when id=v_session.tavus_reservation_id and provider_ref is not null and customer_delivery_state='held' then 'meeting_terminal_before_delivery' else failure_code end,
        customer_delivery_state=case when customer_delivery_state='held' then 'voided' else customer_delivery_state end,
        customer_voided_at=case when customer_delivery_state='held' then now() else customer_voided_at end,
        customer_delivery_receipt_kind=case when customer_delivery_state='held' then 'provider_terminal' else customer_delivery_receipt_kind end,
        customer_delivery_receipt_ref=case when customer_delivery_state='held' then 'recall:terminal:'||p_recall_bot_id else customer_delivery_receipt_ref end,
        customer_delivery_receipt_at=case when customer_delivery_state='held' then now() else customer_delivery_receipt_at end,
        billable_overage=case when customer_delivery_state='held' then false else billable_overage end,
        updated_at=now()
        where id in (v_session.recall_reservation_id,v_session.tavus_reservation_id) and tenant_id=v_session.tenant_id and state in ('committed','completed','cleanup_pending');
    else
      update public.provider_effect_reservations set state='completed',completed_at=now(),updated_at=now()
        where id in (v_session.recall_reservation_id,v_session.tavus_reservation_id) and tenant_id=v_session.tenant_id and state='committed';
    end if;
  end if;
  return jsonb_build_object(
    'found',true,'applied',v_applied,'terminalRetained',v_terminal_bound,
    'tavusReservationId',v_session.tavus_reservation_id,'tavusConversationId',v_session.tavus_conversation_id,
    'tavusCleanupRequired',p_status in ('ended','failed') and v_session.tavus_reservation_id is not null and v_session.sentinel_camera_state<>'camera_started'
  );
end; $$;

create or replace function public.portal_mark_sentinel_conversation_created_service(p_recall_bot_id text,p_reservation_id app.uuid_v7,p_conversation_id text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_session public.meeting_bot_sessions%rowtype;
begin
  select * into v_session from public.meeting_bot_sessions where recall_bot_id=p_recall_bot_id for update;
  if not found or v_session.status in ('ended','failed') then return jsonb_build_object('outcome','terminal'); end if;
  if v_session.sentinel_camera_state in ('conversation_created','camera_started') then return jsonb_build_object('outcome','replayed','conversationId',v_session.tavus_conversation_id,'state',v_session.sentinel_camera_state); end if;
  if not exists(select 1 from public.provider_effect_reservations where tenant_id=v_session.tenant_id and id=p_reservation_id and agent_id=v_session.agent_id and provider_id='tavus' and state='committed' and provider_ref=p_conversation_id) then raise exception 'committed Tavus reservation required' using errcode='23514'; end if;
  update public.meeting_bot_sessions set tavus_reservation_id=p_reservation_id,tavus_conversation_id=p_conversation_id,sentinel_camera_state='conversation_created',updated_at=now() where recall_bot_id=p_recall_bot_id;
  return jsonb_build_object('outcome','persisted','tenantId',v_session.tenant_id,'agentId',v_session.agent_id,'conversationId',p_conversation_id);
end; $$;

create or replace function public.portal_mark_sentinel_camera_started_service(p_recall_bot_id text,p_reservation_id app.uuid_v7)
returns boolean language plpgsql security definer set search_path='public' as $$
begin
  update public.meeting_bot_sessions set sentinel_camera_state='camera_started',sentinel_camera_started_at=now(),updated_at=now()
  where recall_bot_id=p_recall_bot_id and tavus_reservation_id=p_reservation_id and sentinel_camera_state='conversation_created' and status not in ('ended','failed');
  if found then update public.provider_effect_reservations set camera_started_at=now(),updated_at=now() where id=p_reservation_id; end if;
  return found;
end; $$;

create or replace function public.portal_get_sentinel_attach_service(p_recall_bot_id text)
returns jsonb language sql stable security definer set search_path='public' as $$
  select case when s.recall_bot_id is null then jsonb_build_object('outcome','not_found')
    when s.status in ('ended','failed') then jsonb_build_object('outcome','terminal')
    else jsonb_build_object('outcome','ready','tenantId',s.tenant_id,'agentId',s.agent_id,'state',s.sentinel_camera_state,'reservationId',s.tavus_reservation_id,'conversationId',s.tavus_conversation_id,'conversationUrl',r.provider_url,'billableOverage',coalesce(r.billable_overage,false),'customerDeliveryState',coalesce(r.customer_delivery_state,'held'),'recallReservationId',s.recall_reservation_id,'recallCustomerDeliveryState',coalesce(rr.customer_delivery_state,'held')) end
  from (values(1)) seed(n)
  left join public.meeting_bot_sessions s on s.recall_bot_id=p_recall_bot_id
  left join public.provider_effect_reservations r on r.tenant_id=s.tenant_id and r.id=s.tavus_reservation_id
  left join public.provider_effect_reservations rr on rr.tenant_id=s.tenant_id and rr.id=s.recall_reservation_id
$$;

create or replace function public.portal_record_meeting_bot_session_service(
  p_id app.uuid_v7,p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_recall_bot_id text,p_meeting_ref text,p_tavus_conversation_id text,p_recall_reservation_id app.uuid_v7,p_tavus_reservation_id app.uuid_v7 default null
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_existing public.meeting_bot_sessions%rowtype; v_terminal_status text; v_camera_state text;
begin
  perform pg_advisory_xact_lock(hashtextextended('recall-bot:'||p_recall_bot_id,0));
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text,0));
  if p_meeting_ref is null or p_meeting_ref !~ '^(effect|meeting):[0-9a-f]{64}$' then raise exception 'meeting_ref must be an opaque digest' using errcode='22023'; end if;
  if not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  select * into v_existing from public.meeting_bot_sessions where recall_bot_id=p_recall_bot_id for update;
  if found then
    if v_existing.id is distinct from p_id or v_existing.tenant_id is distinct from p_tenant_id or v_existing.agent_id is distinct from p_agent_id
      or v_existing.meeting_ref is distinct from p_meeting_ref or v_existing.tavus_conversation_id is distinct from p_tavus_conversation_id
      or v_existing.recall_reservation_id is distinct from p_recall_reservation_id or v_existing.tavus_reservation_id is distinct from p_tavus_reservation_id then
      raise exception 'meeting bot replay contract conflict' using errcode='23505';
    end if;
    return jsonb_build_object('ok',true,'replayed',true,'terminal',v_existing.status in ('ended','failed'),'status',v_existing.status,'cameraState',v_existing.sentinel_camera_state,
      'tavusCleanupRequired',v_existing.status in ('ended','failed') and v_existing.tavus_reservation_id is not null and v_existing.sentinel_camera_state<>'camera_started',
      'tavusConversationId',v_existing.tavus_conversation_id,'tavusReservationId',v_existing.tavus_reservation_id);
  end if;
  if not exists(select 1 from public.provider_effect_reservations where tenant_id=p_tenant_id and id=p_recall_reservation_id and agent_id=p_agent_id and provider_id='recall' and state='committed') then raise exception 'committed Recall reservation required' using errcode='23514'; end if;
  if p_tavus_reservation_id is not null and not exists(select 1 from public.provider_effect_reservations where tenant_id=p_tenant_id and id=p_tavus_reservation_id and agent_id=p_agent_id and provider_id='tavus' and state='committed' and provider_ref=p_tavus_conversation_id) then raise exception 'committed Tavus reservation mismatch' using errcode='23514'; end if;
  if exists(select 1 from public.recall_webhook_deliveries where provider_bot_id=p_recall_bot_id and tenant_id is not null and tenant_id<>p_tenant_id) then
    raise exception 'Recall webhook tenant binding conflict' using errcode='23505';
  end if;
  update public.recall_webhook_deliveries set tenant_id=p_tenant_id where provider_bot_id=p_recall_bot_id and tenant_id is null;
  select terminal_status into v_terminal_status from public.recall_webhook_deliveries
    where provider_bot_id=p_recall_bot_id and tenant_id=p_tenant_id and terminal_status is not null order by created_at,delivery_id limit 1;
  v_camera_state:=case when p_tavus_conversation_id is null then 'not_requested' else 'conversation_created' end;
  insert into public.meeting_bot_sessions(id,tenant_id,agent_id,recall_bot_id,tavus_conversation_id,meeting_url,meeting_ref,status,recall_reservation_id,tavus_reservation_id,sentinel_camera_state,sentinel_camera_started_at)
  values(p_id,p_tenant_id,p_agent_id,p_recall_bot_id,p_tavus_conversation_id,null,p_meeting_ref,coalesce(v_terminal_status,'created'),p_recall_reservation_id,p_tavus_reservation_id,v_camera_state,null);
  if v_terminal_status is not null then
    if exists(select 1 from public.billing_usage_outbox where reservation_id in (p_recall_reservation_id,p_tavus_reservation_id)
      and (status not in ('pending','failed') or lease_token is not null or lease_until is not null)) then
      raise exception 'terminal billing delivery is already in flight' using errcode='55000';
    end if;
    update public.billing_usage_outbox set status='voided',terminal_reason='meeting_terminal_before_persistence',updated_at=now()
      where reservation_id in (p_recall_reservation_id,p_tavus_reservation_id) and status in ('pending','failed') and lease_token is null and lease_until is null;
    update public.provider_effect_reservations set
      state=case when id=p_tavus_reservation_id and provider_ref is not null then 'cleanup_pending' else 'completed' end,
      completed_at=case when id=p_tavus_reservation_id and provider_ref is not null then completed_at else now() end,
      failure_code=case when id=p_tavus_reservation_id and provider_ref is not null then 'meeting_terminal_before_persistence' else failure_code end,
      customer_delivery_state='voided',customer_voided_at=now(),customer_delivery_receipt_kind='provider_terminal',
      customer_delivery_receipt_ref='recall:terminal:'||p_recall_bot_id,customer_delivery_receipt_at=now(),billable_overage=false,updated_at=now()
      where tenant_id=p_tenant_id and id in (p_recall_reservation_id,p_tavus_reservation_id) and customer_delivery_state='held';
  end if;
  return jsonb_build_object('ok',true,'replayed',false,'terminal',v_terminal_status is not null,'status',coalesce(v_terminal_status,'created'),'cameraState',v_camera_state,'tavusCleanupRequired',v_terminal_status is not null and p_tavus_reservation_id is not null,'tavusConversationId',p_tavus_conversation_id,'tavusReservationId',p_tavus_reservation_id);
end; $$;

create or replace function public.portal_list_meeting_bot_sessions()
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare v_tenant app.uuid_v7; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id=auth.uid();
  if v_tenant is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'agentId',q.agent_id,'meetingUrl',null,'meetingRef',q.meeting_ref,
    'status',q.status,'createdAt',q.created_at,'endedAt',q.ended_at
  ) order by q.created_at desc),'[]'::jsonb) into v_result
  from (select id,agent_id,meeting_ref,status,created_at,ended_at from public.meeting_bot_sessions where tenant_id=v_tenant order by created_at desc,id desc limit 100) q;
  return v_result;
end; $$;

create or replace function public.portal_lease_billing_usage_service(p_lease_token app.uuid_v7,p_limit integer default 20,p_lease_seconds integer default 60)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_rows jsonb;
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 15 and 300 then raise exception 'invalid lease parameters' using errcode='22023'; end if;
  update public.billing_usage_outbox set status='dead_letter',lease_token=null,lease_until=null,last_error_code=coalesce(last_error_code,'lease_expired'),terminal_reason='attempt_budget_exhausted',updated_at=now()
    where status='delivering' and lease_until<now() and attempts>=8;
  with claimed as (
    select id from public.billing_usage_outbox where attempts<8 and ((status in ('pending','failed') and available_at<=now()) or (status='delivering' and lease_until<now())) order by available_at,id for update skip locked limit p_limit
  ), updated as (
    update public.billing_usage_outbox o set status='delivering',lease_token=p_lease_token,lease_until=now()+make_interval(secs=>p_lease_seconds),attempts=attempts+1,updated_at=now()
    from claimed where o.id=claimed.id returning o.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'tenantId',tenant_id,'reservationId',reservation_id,'costEventId',cost_event_id,'stripeCustomerId',stripe_customer_id,'eventName',meter_event_name,'quantity',quantity,'idempotencyKey',idempotency_key,'billingPeriodStart',billing_period_start,'billingPeriodEnd',billing_period_end,'meterEventAt',meter_event_at,'attempts',attempts)),'[]'::jsonb) into v_rows from updated;
  return v_rows;
end; $$;

create or replace function public.portal_ack_billing_usage_service(p_id app.uuid_v7,p_lease_token app.uuid_v7)
returns boolean language plpgsql security definer set search_path='public' as $$
begin update public.billing_usage_outbox set status='delivered',lease_token=null,lease_until=null,delivered_at=now(),updated_at=now() where id=p_id and status='delivering' and lease_token=p_lease_token; return found; end; $$;

create or replace function public.portal_fail_billing_usage_service(p_id app.uuid_v7,p_lease_token app.uuid_v7,p_error_code text,p_retry_seconds integer,p_permanent boolean default false)
returns boolean language plpgsql security definer set search_path='public' as $$
begin
  update public.billing_usage_outbox set status=case when p_permanent or attempts>=8 then 'dead_letter' else 'failed' end,lease_token=null,lease_until=null,last_error_code=left(coalesce(p_error_code,'provider_error'),80),terminal_reason=case when p_permanent then 'permanent_failure' when attempts>=8 then 'attempt_budget_exhausted' else null end,available_at=now()+make_interval(secs=>least(greatest(p_retry_seconds,5),86400)),updated_at=now()
  where id=p_id and status='delivering' and lease_token=p_lease_token; return found;
end; $$;

create or replace function public.portal_void_unleased_billing_usage_service(p_reservation_id app.uuid_v7,p_reason text)
returns boolean language plpgsql security definer set search_path='public' as $$
declare v_reservation public.provider_effect_reservations%rowtype; v_outbox public.billing_usage_outbox%rowtype;
begin
  if p_reason is null or p_reason !~ '^[a-z][a-z0-9_]{2,79}$' then raise exception 'invalid void reason' using errcode='22023'; end if;
  select * into v_reservation from public.provider_effect_reservations where id=p_reservation_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_reservation.tenant_id::text,0));
  select * into v_reservation from public.provider_effect_reservations where id=p_reservation_id for update;
  if v_reservation.customer_delivery_state='voided' then return true; end if;
  if v_reservation.state not in ('committed','completed','cleanup_pending') then return false; end if;
  select * into v_outbox from public.billing_usage_outbox where tenant_id=v_reservation.tenant_id and reservation_id=v_reservation.id for update;
  if found and (v_outbox.status not in ('pending','failed') or v_outbox.lease_token is not null or v_outbox.lease_until is not null) then return false; end if;
  if found then update public.billing_usage_outbox set status='voided',terminal_reason=p_reason,updated_at=now() where id=v_outbox.id; end if;
  update public.provider_effect_reservations set customer_delivery_state='voided',customer_voided_at=now(),
    customer_delivery_receipt_kind='billing_voided',customer_delivery_receipt_ref=p_reason,customer_delivery_receipt_at=now(),
    billable_overage=false,
    tavus_webhook_capability_revoked_at=case when provider_id='tavus' and tavus_webhook_capability_hash is not null then coalesce(tavus_webhook_capability_revoked_at,now()) else tavus_webhook_capability_revoked_at end,
    updated_at=now() where id=v_reservation.id;
  return true;
end; $$;

create or replace function public.portal_billing_usage_backlog_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'pending',count(*) filter(where status in ('pending','failed','delivering')),
    'oldestAgeSeconds',coalesce(floor(extract(epoch from now()-min(created_at) filter(where status in ('pending','failed','delivering'))))::bigint,0),
    'deadLetter',count(*) filter(where status='dead_letter'),
    'held',(select count(*) from public.provider_effect_reservations where customer_delivery_state='held' and state in ('committed','completed','cleanup_pending')),
    'oldestHeldAgeSeconds',coalesce((select floor(extract(epoch from now()-min(committed_at)))::bigint from public.provider_effect_reservations where customer_delivery_state='held' and state in ('committed','completed','cleanup_pending')),0),
    'providerInFlight',(select count(*) from public.provider_effect_reservations where state='provider_in_flight'),
    'unknown',(select count(*) from public.provider_effect_reservations where state='unknown'),
    'cleanupPending',(select count(*) from public.provider_effect_reservations where state='cleanup_pending'),
    'oldestProviderPendingAgeSeconds',coalesce((select floor(extract(epoch from now()-min(created_at)))::bigint from public.provider_effect_reservations where state in ('provider_in_flight','unknown','cleanup_pending')),0)
  ) from public.billing_usage_outbox
$$;

-- The bind is also the Tavus dispatch fence: exactly one process owns both
-- the provider call and the unhashed callback capability kept only in memory.
create or replace function public.portal_bind_tavus_webhook_capability_service(p_reservation_id app.uuid_v7,p_capability_hash text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_acquired boolean; v_state text; v_now timestamptz:=now(); v_expiry timestamptz;
begin
  if p_capability_hash is null or p_capability_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid capability hash' using errcode='22023'; end if;
  update public.provider_effect_reservations set tavus_webhook_capability_hash=p_capability_hash,
    tavus_webhook_capability_expires_at=v_now+make_interval(secs=>max_duration_seconds+900),
    tavus_webhook_capability_revoked_at=null,state='provider_in_flight',provider_dispatched_at=v_now,updated_at=v_now
    where id=p_reservation_id and provider_id='tavus' and state='reserved'
      and created_at>=now()-interval '10 minutes' and tavus_webhook_capability_hash is null;
  v_acquired:=found;
  select state,tavus_webhook_capability_expires_at into v_state,v_expiry from public.provider_effect_reservations where id=p_reservation_id;
  return jsonb_build_object('acquired',v_acquired,'state',v_state,'capabilityExpiresAt',v_expiry);
end; $$;

create or replace function public.portal_preflight_tavus_webhook_service(p_reservation_id app.uuid_v7,p_capability_hash text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v public.provider_effect_reservations%rowtype;
begin
  if p_capability_hash is null or p_capability_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome','unauthorized');
  end if;
  select * into v from public.provider_effect_reservations where id=p_reservation_id;
  if not found or v.provider_id<>'tavus' or v.tavus_webhook_capability_hash is distinct from p_capability_hash then
    return jsonb_build_object('outcome','unauthorized');
  end if;
  if exists(select 1 from public.tavus_webhook_deliveries d where d.reservation_id=v.id and d.status='completed') then
    return jsonb_build_object('outcome','replayed_terminal');
  end if;
  if v.tavus_webhook_capability_expires_at is null or v.tavus_webhook_capability_expires_at<=now()
    or v.tavus_webhook_capability_revoked_at is not null or v.state='released' then
    return jsonb_build_object('outcome','unauthorized');
  end if;
  if v.state not in ('provider_in_flight','unknown','committed','completed','cleanup_pending') or v.provider_ref is null then
    return jsonb_build_object('outcome','not_ready');
  end if;
  return jsonb_build_object('outcome','authorized','providerRef',v.provider_ref,'capabilityExpiresAt',v.tavus_webhook_capability_expires_at);
end; $$;

create or replace function public.portal_record_tavus_customer_delivery_service(
  p_reservation_id app.uuid_v7,p_provider_ref text,p_payload_digest text,p_event_type text,p_observed_at timestamptz
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v public.provider_effect_reservations%rowtype; d public.tavus_customer_delivery_receipts%rowtype; v_inserted boolean;
begin
  if p_payload_digest !~ '^[0-9a-f]{64}$' or p_event_type<>'application.transcription_ready' then
    raise exception 'invalid Tavus delivery evidence' using errcode='22023';
  end if;
  select * into v from public.provider_effect_reservations where id=p_reservation_id for update;
  if not found or v.provider_id<>'tavus' or v.provider_ref is distinct from p_provider_ref then raise exception 'Tavus reservation mismatch' using errcode='23514'; end if;
  select * into d from public.tavus_customer_delivery_receipts where reservation_id=v.id;
  if found then
    if d.provider_ref is distinct from p_provider_ref or d.payload_digest is distinct from p_payload_digest
      or d.receipt_kind<>'delivered' or d.event_type is distinct from p_event_type
      or d.observed_at is distinct from p_observed_at then
      raise exception 'Tavus delivery receipt conflict' using errcode='23505';
    end if;
    return jsonb_build_object('recorded',true,'replayed',true,'customerDeliveryState',v.customer_delivery_state);
  end if;
  if v.state not in ('committed','completed') then raise exception 'committed Tavus reservation required' using errcode='23514'; end if;
  if v.tavus_webhook_capability_revoked_at is not null or v.tavus_webhook_capability_expires_at is null
    or now()>=v.tavus_webhook_capability_expires_at
    or p_observed_at<v.provider_dispatched_at-interval '5 minutes'
    or p_observed_at>v.tavus_webhook_capability_expires_at
    or p_observed_at>now()+interval '5 minutes' then
    raise exception 'invalid Tavus delivery evidence' using errcode='22023';
  end if;
  if not exists(select 1 from public.tavus_webhook_deliveries w
    where w.reservation_id=v.id and w.provider_ref=p_provider_ref and w.payload_digest=p_payload_digest
      and w.observed_at=p_observed_at and w.status='processing' and w.lease_until>now()) then
    raise exception 'active Tavus webhook claim required' using errcode='55000';
  end if;
  if not exists(select 1 from public.conversation_transcripts t cross join lateral jsonb_array_elements(t.turns) turn
    where t.tenant_id=v.tenant_id and t.surface='video' and t.external_ref=v.provider_ref and t.ended_at is not null
      and turn->>'role'='user' and char_length(btrim(turn->>'content'))>0) then
    raise exception 'authoritative user transcript turn required' using errcode='55000';
  end if;
  insert into public.tavus_customer_delivery_receipts(reservation_id,tenant_id,provider_ref,payload_digest,receipt_kind,event_type,observed_at)
    values(v.id,v.tenant_id,v.provider_ref,p_payload_digest,'delivered',p_event_type,p_observed_at);
  return jsonb_build_object('recorded',true,'replayed',false,'customerDeliveryState',v.customer_delivery_state);
end; $$;

create or replace function public.portal_record_tavus_no_delivery_service(
  p_reservation_id app.uuid_v7,p_provider_ref text,p_payload_digest text,p_reason text,p_observed_at timestamptz
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v public.provider_effect_reservations%rowtype; d public.tavus_customer_delivery_receipts%rowtype; v_inserted boolean;
begin
  if p_payload_digest !~ '^[0-9a-f]{64}$' or p_reason not in ('participant_absent_timeout reached','transcript_without_user_turn') then
    raise exception 'invalid Tavus non-delivery evidence' using errcode='22023';
  end if;
  select * into v from public.provider_effect_reservations where id=p_reservation_id for update;
  if not found or v.provider_id<>'tavus' or v.provider_ref is distinct from p_provider_ref then raise exception 'Tavus reservation mismatch' using errcode='23514'; end if;
  select * into d from public.tavus_customer_delivery_receipts where reservation_id=v.id;
  if found then
    if d.provider_ref is distinct from p_provider_ref or d.payload_digest is distinct from p_payload_digest
      or d.receipt_kind<>'never_joined' or d.event_type<>'system.shutdown'
      or d.reason is distinct from p_reason or d.observed_at is distinct from p_observed_at then
      raise exception 'Tavus delivery receipt conflict' using errcode='23505';
    end if;
    return jsonb_build_object('voided',true,'replayed',true,'customerDeliveryState','voided');
  end if;
  if v.state not in ('committed','completed','cleanup_pending') then raise exception 'committed Tavus reservation required' using errcode='23514'; end if;
  if v.tavus_webhook_capability_revoked_at is not null or v.tavus_webhook_capability_expires_at is null
    or now()>=v.tavus_webhook_capability_expires_at
    or p_observed_at<v.provider_dispatched_at-interval '5 minutes'
    or p_observed_at>v.tavus_webhook_capability_expires_at
    or p_observed_at>now()+interval '5 minutes' then
    raise exception 'invalid Tavus non-delivery evidence' using errcode='22023';
  end if;
  if not exists(select 1 from public.tavus_webhook_deliveries w
    where w.reservation_id=v.id and w.provider_ref=p_provider_ref and w.payload_digest=p_payload_digest
      and w.observed_at=p_observed_at and w.status='processing' and w.lease_until>now()) then
    raise exception 'active Tavus webhook claim required' using errcode='55000';
  end if;
  if p_reason='transcript_without_user_turn' then
    if not exists(select 1 from public.conversation_transcripts t
      where t.tenant_id=v.tenant_id and t.surface='video' and t.external_ref=v.provider_ref and t.ended_at is not null) then
      raise exception 'authoritative final transcript required for no-delivery evidence' using errcode='55000';
    end if;
    if exists(select 1 from public.conversation_transcripts t cross join lateral jsonb_array_elements(t.turns) turn
      where t.tenant_id=v.tenant_id and t.surface='video' and t.external_ref=v.provider_ref and t.ended_at is not null
        and turn->>'role'='user' and char_length(btrim(turn->>'content'))>0) then
      raise exception 'user participation conflicts with no-delivery evidence' using errcode='23505';
    end if;
  end if;
  insert into public.tavus_customer_delivery_receipts(reservation_id,tenant_id,provider_ref,payload_digest,receipt_kind,event_type,reason,observed_at)
    values(v.id,v.tenant_id,v.provider_ref,p_payload_digest,'never_joined','system.shutdown',p_reason,p_observed_at);
  if v.customer_delivery_state='activated' then raise exception 'activated delivery cannot be voided' using errcode='55000'; end if;
  if exists(select 1 from public.billing_usage_outbox where reservation_id=v.id and (status not in ('pending','failed','voided') or lease_token is not null)) then raise exception 'billing delivery already in flight' using errcode='55000'; end if;
  update public.billing_usage_outbox set status='voided',terminal_reason=p_reason,updated_at=now() where reservation_id=v.id and status in ('pending','failed');
  update public.provider_effect_reservations set customer_delivery_state='voided',customer_voided_at=coalesce(customer_voided_at,now()),
    customer_delivery_receipt_kind='tavus_never_joined',customer_delivery_receipt_ref=p_payload_digest,customer_delivery_receipt_at=coalesce(customer_delivery_receipt_at,p_observed_at),billable_overage=false,updated_at=now()
    where id=v.id and customer_delivery_state='held';
  return jsonb_build_object('voided',true,'replayed',false,'customerDeliveryState','voided');
end; $$;

create or replace function public.portal_create_tavus_stage_capability_service(
  p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_reservation_id app.uuid_v7,p_token_hash text,p_room_url text
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare c public.tavus_stage_capabilities%rowtype; v_expiry timestamptz:=now()+interval '45 minutes';
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' or p_room_url !~ '^https://tavus[.]daily[.]co/' or char_length(p_room_url)>2000 then raise exception 'invalid stage capability' using errcode='22023'; end if;
  if not exists(select 1 from public.provider_effect_reservations where tenant_id=p_tenant_id and agent_id=p_agent_id and id=p_reservation_id and provider_id='tavus' and state in ('committed','completed')) then raise exception 'committed Tavus reservation required' using errcode='23514'; end if;
  select * into c from public.tavus_stage_capabilities where reservation_id=p_reservation_id for update;
  if found then
    if c.tenant_id is distinct from p_tenant_id or c.agent_id is distinct from p_agent_id or c.room_url is distinct from p_room_url then raise exception 'stage capability replay conflict' using errcode='23505'; end if;
    if c.token_hash=p_token_hash and c.revoked_at is null and c.expires_at>now() and c.resolve_count<8 then
      return jsonb_build_object('created',true,'replayed',true,'expiresAt',c.expires_at);
    end if;
    -- The raw token only exists in the caller. If its response was lost, a
    -- retry cannot recover it; rotate the hash under the reservation row lock.
    update public.tavus_stage_capabilities set token_hash=p_token_hash,expires_at=v_expiry,
      revoked_at=null,resolve_count=0,updated_at=now() where reservation_id=p_reservation_id;
    return jsonb_build_object('created',true,'replayed',false,'rotated',true,'expiresAt',v_expiry);
  end if;
  insert into public.tavus_stage_capabilities(reservation_id,tenant_id,agent_id,token_hash,room_url,expires_at) values(p_reservation_id,p_tenant_id,p_agent_id,p_token_hash,p_room_url,v_expiry);
  return jsonb_build_object('created',true,'replayed',false,'expiresAt',v_expiry);
end; $$;

create or replace function public.portal_resolve_tavus_stage_capability_service(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='public' as $$ declare c public.tavus_stage_capabilities%rowtype; begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('found',false); end if;
  select * into c from public.tavus_stage_capabilities where token_hash=p_token_hash for update;
  if not found or c.revoked_at is not null or c.expires_at<=now() or c.resolve_count>=8 then return jsonb_build_object('found',false); end if;
  update public.tavus_stage_capabilities set resolve_count=resolve_count+1,updated_at=now() where reservation_id=c.reservation_id;
  return jsonb_build_object('found',true,'roomUrl',c.room_url,'expiresAt',c.expires_at);
end; $$;

create or replace function public.portal_revoke_tavus_stage_capability_service(p_reservation_id app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='public' as $$ declare v boolean; begin
  update public.tavus_stage_capabilities set revoked_at=coalesce(revoked_at,now()),updated_at=now() where reservation_id=p_reservation_id; v:=found;
  return jsonb_build_object('revoked',v);
end; $$;

create or replace function public.portal_claim_tavus_webhook_service(
  p_reservation_id app.uuid_v7,p_provider_ref text,p_capability_hash text,p_payload_digest text,p_claim_token app.uuid_v7,p_observed_at timestamptz
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_res public.provider_effect_reservations%rowtype; v_delivery public.tavus_webhook_deliveries%rowtype; v_inserted boolean;
begin
  if p_capability_hash is null or p_capability_hash !~ '^[0-9a-f]{64}$' or p_payload_digest is null or p_payload_digest !~ '^[0-9a-f]{64}$'
    or p_observed_at is null then
    raise exception 'invalid webhook evidence' using errcode='22023';
  end if;
  select * into v_res from public.provider_effect_reservations where id=p_reservation_id for update;
  if not found or v_res.provider_id<>'tavus' or v_res.tavus_webhook_capability_hash is distinct from p_capability_hash
    or v_res.tavus_webhook_capability_revoked_at is not null or v_res.tavus_webhook_capability_expires_at is null
    or now()>=v_res.tavus_webhook_capability_expires_at
    or p_observed_at<v_res.provider_dispatched_at-interval '5 minutes'
    or p_observed_at>v_res.tavus_webhook_capability_expires_at
    or p_observed_at>now()+interval '5 minutes' then
    return jsonb_build_object('outcome','unauthorized');
  end if;
  if v_res.state not in ('committed','completed') or v_res.provider_ref is distinct from p_provider_ref
    or not exists(select 1 from public.conversation_transcripts t where t.tenant_id=v_res.tenant_id and t.surface='video' and t.external_ref=v_res.provider_ref) then
    return jsonb_build_object('outcome','not_ready');
  end if;
  insert into public.tavus_webhook_deliveries(reservation_id,tenant_id,provider_ref,observed_at,payload_digest,claim_token)
    values(v_res.id,v_res.tenant_id,v_res.provider_ref,p_observed_at,p_payload_digest,p_claim_token) on conflict do nothing;
  get diagnostics v_inserted=row_count;
  select * into v_delivery from public.tavus_webhook_deliveries where reservation_id=v_res.id for update;
  if v_delivery.provider_ref is distinct from p_provider_ref or v_delivery.payload_digest is distinct from p_payload_digest
    or v_delivery.observed_at is distinct from p_observed_at then return jsonb_build_object('outcome','conflict'); end if;
  if v_inserted then return jsonb_build_object('outcome','claimed'); end if;
  if v_delivery.status='completed' then return jsonb_build_object('outcome','replayed'); end if;
  if v_delivery.lease_until<=now() then
    update public.tavus_webhook_deliveries set claim_token=p_claim_token,lease_until=now()+interval '300 seconds',attempts=attempts+1,updated_at=now() where reservation_id=v_res.id;
    return jsonb_build_object('outcome','claimed');
  end if;
  return jsonb_build_object('outcome','busy');
end; $$;
create or replace function public.portal_complete_tavus_webhook_service(p_reservation_id app.uuid_v7,p_payload_digest text,p_claim_token app.uuid_v7)
returns boolean language plpgsql security definer set search_path='public' as $$
begin
  update public.tavus_webhook_deliveries set status='completed',completed_at=now(),updated_at=now()
    where reservation_id=p_reservation_id and payload_digest=p_payload_digest and status='processing'
      and claim_token=p_claim_token and lease_until>now();
  if not found then return false; end if;
  update public.provider_effect_reservations set tavus_webhook_capability_revoked_at=coalesce(tavus_webhook_capability_revoked_at,now()),updated_at=now()
    where id=p_reservation_id and provider_id='tavus' and tavus_webhook_capability_hash is not null;
  if not found then raise exception 'Tavus capability revocation invariant failed' using errcode='55000'; end if;
  return true;
end; $$;
create or replace function public.portal_release_tavus_webhook_service(p_reservation_id app.uuid_v7,p_payload_digest text,p_claim_token app.uuid_v7)
returns boolean language plpgsql security definer set search_path='public' as $$ begin update public.tavus_webhook_deliveries set lease_until=now(),updated_at=now() where reservation_id=p_reservation_id and payload_digest=p_payload_digest and status='processing' and claim_token=p_claim_token and lease_until>now(); return found; end; $$;

create or replace function public.portal_claim_recall_webhook_service(p_delivery_id text,p_payload_digest text,p_claim_token app.uuid_v7)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_row public.recall_webhook_deliveries%rowtype; v_inserted boolean;
begin
  insert into public.recall_webhook_deliveries(delivery_id,payload_digest,claim_token) values(p_delivery_id,p_payload_digest,p_claim_token) on conflict do nothing;
  get diagnostics v_inserted = row_count;
  select * into v_row from public.recall_webhook_deliveries where delivery_id=p_delivery_id for update;
  if v_row.payload_digest<>p_payload_digest then return jsonb_build_object('outcome','conflict'); end if;
  if v_inserted then return jsonb_build_object('outcome','claimed'); end if;
  if v_row.status='completed' then return jsonb_build_object('outcome','replayed'); end if;
  if v_row.lease_until<=now() then
    update public.recall_webhook_deliveries set claim_token=p_claim_token,lease_until=now()+interval '300 seconds',attempts=attempts+1,updated_at=now() where delivery_id=p_delivery_id;
    return jsonb_build_object('outcome','claimed');
  end if;
  return jsonb_build_object('outcome','busy');
end; $$;
create or replace function public.portal_complete_recall_webhook_service(p_delivery_id text,p_claim_token app.uuid_v7)
returns boolean language plpgsql security definer set search_path='public' as $$ begin update public.recall_webhook_deliveries set status='completed',completed_at=now(),updated_at=now() where delivery_id=p_delivery_id and status='processing' and claim_token=p_claim_token and lease_until>now(); return found; end; $$;
create or replace function public.portal_release_recall_webhook_service(p_delivery_id text,p_payload_digest text,p_claim_token app.uuid_v7)
returns boolean language plpgsql security definer set search_path='public' as $$ begin update public.recall_webhook_deliveries set lease_until=now(),updated_at=now() where delivery_id=p_delivery_id and payload_digest=p_payload_digest and claim_token=p_claim_token and status='processing' and lease_until>now(); return found; end; $$;

create or replace function public.portal_record_worker_heartbeat_service(
  p_worker_kind text,p_run_id app.uuid_v7,p_phase text,p_version text,p_deployment_id text,p_config_fingerprint text,p_counters jsonb default '{}'::jsonb
) returns boolean language plpgsql security definer set search_path='public' as $$
declare v public.worker_heartbeats%rowtype;
begin
  if p_worker_kind not in ('billing_usage','provider_effect_reconciler') or p_phase not in ('started','succeeded','failed')
    or p_version !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}$' or jsonb_typeof(p_counters) is distinct from 'object'
    or p_deployment_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$' or p_config_fingerprint !~ '^sha256:[0-9a-f]{64}$'
    or pg_column_size(p_counters)>4096 or (p_phase<>'succeeded' and p_counters<>'{}'::jsonb)
    then raise exception 'invalid worker heartbeat' using errcode='22023'; end if;
  select * into v from public.worker_heartbeats where worker_name=p_worker_kind for update;
  if found and v.run_id=p_run_id and v.status=p_phase and v.version=p_version and v.deployment_id=p_deployment_id
    and v.config_fingerprint=p_config_fingerprint and v.counters=p_counters then return true; end if;
  if found and v.run_id=p_run_id and not (
    v.status='started' and p_phase in ('succeeded','failed') and v.version=p_version
      and v.deployment_id=p_deployment_id and v.config_fingerprint=p_config_fingerprint
  ) then
    raise exception 'worker heartbeat replay conflict' using errcode='23505';
  end if;
  if p_phase='started' then
    if found and p_run_id::text<=v.run_id::text then raise exception 'worker heartbeat run is stale' using errcode='23505'; end if;
    insert into public.worker_heartbeats(worker_name,run_id,version,deployment_id,config_fingerprint,status,started_at,succeeded_at,counters)
      values(p_worker_kind,p_run_id,p_version,p_deployment_id,p_config_fingerprint,'started',now(),null,p_counters)
      on conflict(worker_name) do update set run_id=excluded.run_id,version=excluded.version,deployment_id=excluded.deployment_id,
        config_fingerprint=excluded.config_fingerprint,status='started',started_at=now(),succeeded_at=null,counters=excluded.counters,updated_at=now();
  elsif p_phase='succeeded' then
    if not found or v.run_id<>p_run_id or v.status<>'started' then raise exception 'worker success has no matching run' using errcode='55000'; end if;
    update public.worker_heartbeats set status='succeeded',succeeded_at=now(),last_succeeded_at=now(),last_succeeded_version=p_version,
      last_succeeded_deployment_id=p_deployment_id,last_succeeded_config_fingerprint=p_config_fingerprint,counters=p_counters,updated_at=now() where worker_name=p_worker_kind;
  else
    if not found or v.run_id<>p_run_id or v.status<>'started' then raise exception 'worker failure has no matching run' using errcode='55000'; end if;
    update public.worker_heartbeats set status='failed',succeeded_at=null,counters=p_counters,updated_at=now() where worker_name=p_worker_kind;
  end if;
  return true;
end; $$;

create or replace function public.portal_worker_readiness_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'billingUsage',coalesce((select jsonb_build_object('lastSucceededAt',last_succeeded_at,'ageSeconds',case when last_succeeded_at is null then null else floor(extract(epoch from now()-last_succeeded_at))::bigint end,'version',last_succeeded_version,'deploymentId',last_succeeded_deployment_id,'configFingerprint',last_succeeded_config_fingerprint) from public.worker_heartbeats where worker_name='billing_usage'),'null'::jsonb),
    'providerEffectReconciler',coalesce((select jsonb_build_object('lastSucceededAt',last_succeeded_at,'ageSeconds',case when last_succeeded_at is null then null else floor(extract(epoch from now()-last_succeeded_at))::bigint end,'version',last_succeeded_version,'deploymentId',last_succeeded_deployment_id,'configFingerprint',last_succeeded_config_fingerprint) from public.worker_heartbeats where worker_name='provider_effect_reconciler'),'null'::jsonb)
  )
$$;

create or replace function app.billing_checkout_intent_receipt(
  p_row public.billing_checkout_intents,
  p_outcome text
) returns jsonb language sql stable set search_path='public' as $$
  select jsonb_build_object(
    'outcome',p_outcome,
    'checkoutIntentId',p_row.id,
    'state',p_row.state,
    'stripeIdempotencyKey',p_row.stripe_idempotency_key,
    'planId',p_row.plan_id,
    'basePriceId',p_row.base_price_id,
    'overagePriceId',p_row.overage_price_id,
    'stripeLivemode',p_row.stripe_livemode,
    'baseUnitAmountCents',p_row.base_unit_amount_cents,
    'overageUnitAmountCents',p_row.overage_unit_amount_cents,
    'meterEventName',p_row.meter_event_name,
    'existingStripeCustomerId',p_row.existing_stripe_customer_id,
    'successUrl',p_row.success_url,
    'cancelUrl',p_row.cancel_url,
    'expiresAt',to_char(p_row.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'stripeSessionId',p_row.stripe_session_id,
    'checkoutUrl',p_row.checkout_url
  )
$$;

create or replace function app.blocked_billing_checkout_intent_receipt(p_outcome text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'outcome',p_outcome,'checkoutIntentId',null,'state',null,
    'stripeIdempotencyKey',null,'planId',null,'basePriceId',null,
    'overagePriceId',null,'stripeLivemode',null,'baseUnitAmountCents',null,
    'overageUnitAmountCents',null,'meterEventName',null,'existingStripeCustomerId',null,
    'successUrl',null,'cancelUrl',null,'expiresAt',null,
    'stripeSessionId',null,'checkoutUrl',null
  )
$$;

create or replace function public.portal_begin_billing_checkout_intent_service(
  p_checkout_intent_id app.uuid_v7,
  p_tenant_id app.uuid_v7,
  p_user_id uuid,
  p_plan_id text,
  p_base_price_id text,
  p_overage_price_id text,
  p_stripe_livemode boolean,
  p_base_unit_amount_cents integer,
  p_overage_unit_amount_cents integer,
  p_meter_event_name text,
  p_existing_stripe_customer_id text,
  p_success_url text,
  p_cancel_url text,
  p_expires_at timestamptz
) returns jsonb language plpgsql security definer
set search_path='public','extensions' as $$
declare
  v_actor_id app.uuid_v7;
  v_role text;
  v_existing public.billing_checkout_intents%rowtype;
  v_catalog_fingerprint text;
  v_request_fingerprint text;
begin
  if p_plan_id not in ('piloto','crescimento','escala')
    or p_base_price_id !~ '^price_[A-Za-z0-9]{1,255}$'
    or p_overage_price_id !~ '^price_[A-Za-z0-9]{1,255}$'
    or p_stripe_livemode is null
    or p_base_unit_amount_cents not between 1 and 100000000
    or p_overage_unit_amount_cents not between 1 and 100000000
    or p_meter_event_name !~ '^[a-z][a-z0-9_]{2,99}$'
    or (p_existing_stripe_customer_id is not null and p_existing_stripe_customer_id !~ '^cus_[A-Za-z0-9]{1,255}$')
  then raise exception 'invalid checkout catalog' using errcode='22023'; end if;
  if not (
    (p_success_url='https://closer.axtroai.com/configuracoes?billing_success=1'
      and p_cancel_url='https://closer.axtroai.com/configuracoes?billing_error=cancelado')
    or
    (p_success_url='https://portal-production-b43e.up.railway.app/configuracoes?billing_success=1'
      and p_cancel_url='https://portal-production-b43e.up.railway.app/configuracoes?billing_error=cancelado')
  )
  then raise exception 'invalid checkout redirect URL' using errcode='22023'; end if;
  if p_expires_at is null or not isfinite(p_expires_at)
    or p_expires_at<>date_trunc('second',p_expires_at)
  then raise exception 'checkout expiry must be a finite second-precision instant' using errcode='22023'; end if;

  select actor_id,role into v_actor_id,v_role
  from public.user_tenant_memberships
  where user_id=p_user_id and tenant_id=p_tenant_id;
  if v_actor_id is null or v_role<>'tenant_admin' then
    raise exception 'tenant administrator membership required' using errcode='42501';
  end if;

  v_catalog_fingerprint:=app.sha256_tuple(p_plan_id,p_base_price_id,p_overage_price_id,
    p_stripe_livemode::text,p_base_unit_amount_cents::text,p_overage_unit_amount_cents::text,p_meter_event_name);
  v_request_fingerprint:=app.sha256_tuple(p_tenant_id::text,p_plan_id,p_base_price_id,p_overage_price_id,
    p_stripe_livemode::text,p_base_unit_amount_cents::text,p_overage_unit_amount_cents::text,p_meter_event_name,
    p_existing_stripe_customer_id,p_success_url,p_cancel_url,p_expires_at::text);

  perform pg_advisory_xact_lock(hashtextextended('billing-checkout:'||p_tenant_id::text,0));
  select * into v_existing from public.billing_checkout_intents where id=p_checkout_intent_id for update;
  if found then
    if v_existing.tenant_id is distinct from p_tenant_id
      or v_existing.actor_id is distinct from v_actor_id
      or v_existing.request_fingerprint is distinct from v_request_fingerprint
    then return app.blocked_billing_checkout_intent_receipt('conflict'); end if;
    return app.billing_checkout_intent_receipt(v_existing,'replayed');
  end if;

  if exists(select 1 from public.tenant_subscriptions
    where tenant_id=p_tenant_id and status not in ('canceled','incomplete_expired') for update)
  then return app.blocked_billing_checkout_intent_receipt('blocked_unknown'); end if;

  if p_expires_at<statement_timestamp()+interval '30 minutes'
    or p_expires_at>statement_timestamp()+interval '24 hours'
  then raise exception 'new checkout expiry must be 30 minutes to 24 hours ahead' using errcode='22023'; end if;

  select * into v_existing from public.billing_checkout_intents
  where tenant_id=p_tenant_id and state in ('reserved','dispatched','bound','unknown') for update;
  if found then
    if v_existing.state='reserved' and v_existing.dispatched_at is null
      and v_existing.expires_at<statement_timestamp()+interval '30 minutes'
    then
      update public.billing_checkout_intents set state='released',release_evidence='not_dispatched',
        released_at=now(),updated_at=now() where id=v_existing.id;
    else
      if v_existing.actor_id=v_actor_id
        and v_existing.catalog_fingerprint=v_catalog_fingerprint
        and v_existing.existing_stripe_customer_id is not distinct from p_existing_stripe_customer_id
        and v_existing.success_url=p_success_url and v_existing.cancel_url=p_cancel_url
      then
        return app.billing_checkout_intent_receipt(v_existing,'replayed');
      end if;
      if v_existing.state='unknown' then return app.blocked_billing_checkout_intent_receipt('blocked_unknown'); end if;
      return app.blocked_billing_checkout_intent_receipt('conflict');
    end if;
  end if;

  insert into public.billing_checkout_intents(
    id,tenant_id,actor_id,plan_id,base_price_id,overage_price_id,stripe_livemode,
    base_unit_amount_cents,overage_unit_amount_cents,meter_event_name,
    existing_stripe_customer_id,success_url,cancel_url,expires_at,
    stripe_idempotency_key,catalog_fingerprint,request_fingerprint
  ) values(
    p_checkout_intent_id,p_tenant_id,v_actor_id,p_plan_id,p_base_price_id,p_overage_price_id,p_stripe_livemode,
    p_base_unit_amount_cents,p_overage_unit_amount_cents,p_meter_event_name,
    p_existing_stripe_customer_id,p_success_url,p_cancel_url,p_expires_at,
    'billing:checkout:'||replace(p_checkout_intent_id::text,'-',''),v_catalog_fingerprint,v_request_fingerprint
  ) returning * into v_existing;
  return app.billing_checkout_intent_receipt(v_existing,'reserved');
end $$;

create or replace function public.portal_mark_billing_checkout_dispatched_service(
  p_checkout_intent_id app.uuid_v7
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v public.billing_checkout_intents%rowtype;
begin
  select * into v from public.billing_checkout_intents where id=p_checkout_intent_id for update;
  if not found then raise exception 'checkout intent not found' using errcode='P0002'; end if;
  if v.state='reserved' then
    if v.dispatched_at is not null then raise exception 'reserved checkout already crossed dispatch fence' using errcode='55000'; end if;
    if v.expires_at<statement_timestamp()+interval '30 minutes' then
      update public.billing_checkout_intents set state='released',release_evidence='not_dispatched',
        released_at=now(),updated_at=now() where id=v.id;
      return jsonb_build_object('acquired',false,'state','released');
    end if;
    update public.billing_checkout_intents set state='dispatched',catalog_verified_at=now(),dispatched_at=now(),updated_at=now()
      where id=v.id returning * into v;
    return jsonb_build_object('acquired',true,'state','dispatched');
  end if;
  if v.state='dispatched' then return jsonb_build_object('acquired',false,'state','unknown'); end if;
  return jsonb_build_object('acquired',false,'state',v.state);
end $$;

create or replace function public.portal_bind_billing_checkout_session_service(
  p_checkout_intent_id app.uuid_v7,
  p_stripe_session_id text,
  p_checkout_url text,
  p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v public.billing_checkout_intents%rowtype; v_allowed_origin text;
begin
  if p_stripe_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]{1,240}$'
    or p_checkout_url is null or char_length(p_checkout_url) not between 9 and 2000
    or p_checkout_url !~ '^https://[^/@?#]+(?::[0-9]{1,5})?(/[^#]*)?$'
  then raise exception 'invalid Stripe checkout session' using errcode='22023'; end if;
  select * into v from public.billing_checkout_intents where id=p_checkout_intent_id for update;
  if not found then raise exception 'checkout intent not found' using errcode='P0002'; end if;
  v_allowed_origin:=substring(v.success_url from '^(https://[^/?#]+)');
  if p_checkout_url !~ '^https://checkout[.]stripe[.]com/'
    and p_checkout_url<>v_allowed_origin and p_checkout_url not like v_allowed_origin||'/%'
  then raise exception 'checkout URL origin is not allowed' using errcode='22023'; end if;
  if p_expires_at is distinct from v.expires_at then raise exception 'checkout expiry conflicts with immutable intent' using errcode='23505'; end if;
  if v.stripe_session_id is not null then
    if v.stripe_session_id is distinct from p_stripe_session_id
      or (v.checkout_url is not null and v.checkout_url is distinct from p_checkout_url) then
      raise exception 'checkout intent is bound to a different Stripe session' using errcode='23505';
    end if;
    if v.state='bound' and v.checkout_url is not null then return jsonb_build_object('bound',true,'state','bound'); end if;
    if v.state='completed' then
      update public.billing_checkout_intents set checkout_url=coalesce(checkout_url,p_checkout_url),
        bound_at=coalesce(bound_at,now()),updated_at=now() where id=v.id;
      return jsonb_build_object('bound',true,'state','completed');
    end if;
  end if;
  if v.state not in ('dispatched','unknown') then raise exception 'checkout intent is not bindable' using errcode='55000'; end if;
  update public.billing_checkout_intents set state='bound',stripe_session_id=p_stripe_session_id,
    checkout_url=p_checkout_url,bound_at=coalesce(bound_at,now()),updated_at=now() where id=v.id;
  return jsonb_build_object('bound',true,'state','bound');
exception when unique_violation then
  raise exception 'Stripe checkout session is already bound' using errcode='23505';
end $$;

create or replace function public.portal_release_billing_checkout_intent_service(
  p_checkout_intent_id app.uuid_v7,
  p_evidence text
) returns jsonb language plpgsql security definer set search_path='public' as $$
declare v public.billing_checkout_intents%rowtype;
begin
  if p_evidence not in ('catalog_preflight_failed','not_dispatched') then raise exception 'invalid checkout release evidence' using errcode='22023'; end if;
  select * into v from public.billing_checkout_intents where id=p_checkout_intent_id for update;
  if not found then raise exception 'checkout intent not found' using errcode='P0002'; end if;
  if v.state='released' and v.release_evidence=p_evidence then return jsonb_build_object('released',true,'state','released'); end if;
  if v.state<>'reserved' or v.dispatched_at is not null then raise exception 'dispatched checkout intent cannot be released' using errcode='55000'; end if;
  update public.billing_checkout_intents set state='released',release_evidence=p_evidence,released_at=now(),updated_at=now() where id=v.id;
  return jsonb_build_object('released',true,'state','released');
end $$;

create or replace function public.portal_apply_billing_checkout_event_service(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_checkout_intent_id app.uuid_v7,
  p_stripe_session_id text,
  p_tenant_id app.uuid_v7,
  p_plan_id text,
  p_stripe_customer_id text default null,
  p_stripe_subscription_id text default null,
  p_payment_status text default null
) returns jsonb language plpgsql security definer set search_path='public','extensions' as $$
declare
  v public.billing_checkout_intents%rowtype;
  v_event public.billing_stripe_event_receipts%rowtype;
  v_fingerprint text;
  v_target_state text;
  v_applied boolean:=false;
begin
  if p_event_id !~ '^evt_[A-Za-z0-9_]{1,251}$'
    or p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','checkout.session.async_payment_failed')
    or p_event_created_at is null or not isfinite(p_event_created_at) or p_event_created_at>statement_timestamp()+interval '5 minutes'
    or p_stripe_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]{1,240}$'
    or p_plan_id not in ('piloto','crescimento','escala')
    or (p_stripe_customer_id is not null and p_stripe_customer_id !~ '^cus_[A-Za-z0-9]{1,255}$')
    or (p_stripe_subscription_id is not null and p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]{1,255}$')
    or (p_payment_status is not null and p_payment_status not in ('paid','unpaid','no_payment_required'))
  then raise exception 'invalid signed checkout event' using errcode='22023'; end if;
  if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded')
    and (p_stripe_customer_id is null or p_stripe_subscription_id is null)
  then raise exception 'successful checkout event lacks subscription identity' using errcode='22023'; end if;
  v_fingerprint:=app.sha256_text(jsonb_build_array(p_event_id,p_event_type,p_event_created_at,p_checkout_intent_id,
    p_stripe_session_id,p_tenant_id,p_plan_id,p_stripe_customer_id,p_stripe_subscription_id,p_payment_status)::text);
  perform pg_advisory_xact_lock(hashtextextended('stripe-event:'||p_event_id,0));
  select * into v_event from public.billing_stripe_event_receipts where event_id=p_event_id;
  if found then
    if v_event.receipt_kind<>'checkout' or v_event.payload_fingerprint<>v_fingerprint then
      raise exception 'Stripe event identity conflict' using errcode='23505'; end if;
    return jsonb_build_object('applied',false,'replayed',true,'state',v_event.receipt_state);
  end if;
  if p_stripe_subscription_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('stripe-subscription:'||p_stripe_subscription_id,0));
    if exists(select 1 from public.billing_checkout_intents
        where stripe_subscription_id=p_stripe_subscription_id and id<>p_checkout_intent_id)
      or exists(select 1 from public.tenant_subscriptions
        where stripe_subscription_id=p_stripe_subscription_id
          and (tenant_id<>p_tenant_id or checkout_intent_id is distinct from p_checkout_intent_id))
    then raise exception 'Stripe subscription is owned by another checkout' using errcode='23505'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('billing-checkout:'||p_tenant_id::text,0));
  select * into v from public.billing_checkout_intents where id=p_checkout_intent_id for update;
  if not found or v.tenant_id<>p_tenant_id or v.plan_id<>p_plan_id
    or (v.stripe_session_id is not null and v.stripe_session_id<>p_stripe_session_id)
    or (v.existing_stripe_customer_id is not null and p_stripe_customer_id is distinct from v.existing_stripe_customer_id)
    or (v.stripe_customer_id is not null and p_stripe_customer_id is distinct from v.stripe_customer_id)
    or (v.stripe_subscription_id is not null and p_stripe_subscription_id is distinct from v.stripe_subscription_id)
  then raise exception 'checkout event tuple conflicts with durable intent' using errcode='23505'; end if;
  if v.state in ('reserved','released','conflict') then raise exception 'checkout event has no dispatched intent' using errcode='55000'; end if;

  v_target_state:=case
    when p_event_type='checkout.session.async_payment_succeeded'
      and p_payment_status in ('paid','no_payment_required') then 'completed'
    when p_event_type in ('checkout.session.expired','checkout.session.async_payment_failed') then 'expired'
    when p_event_type='checkout.session.completed' and p_payment_status in ('paid','no_payment_required') then 'completed'
    else 'unknown'
  end;
  if v.last_event_created_at is null
    or (p_event_created_at,p_event_id)>(v.last_event_created_at,v.last_event_id) then
    if v.state not in ('completed','expired') then
      update public.billing_checkout_intents set state=v_target_state,stripe_session_id=p_stripe_session_id,
        stripe_customer_id=coalesce(p_stripe_customer_id,stripe_customer_id),
        stripe_subscription_id=coalesce(p_stripe_subscription_id,stripe_subscription_id),
        completed_at=case when v_target_state='completed' then coalesce(completed_at,now()) else completed_at end,
        expired_at=case when v_target_state='expired' then coalesce(expired_at,now()) else expired_at end,
        last_event_id=p_event_id,last_event_created_at=p_event_created_at,updated_at=now()
      where id=v.id returning * into v;
      v_applied:=true;
    else
      update public.billing_checkout_intents set last_event_id=p_event_id,last_event_created_at=p_event_created_at,updated_at=now()
        where id=v.id returning * into v;
    end if;
  end if;
  insert into public.billing_stripe_event_receipts(event_id,event_type,event_created_at,tenant_id,checkout_intent_id,
    stripe_session_id,stripe_subscription_id,payload_fingerprint,receipt_kind,receipt_state,receipt_applied)
  values(p_event_id,p_event_type,p_event_created_at,p_tenant_id,p_checkout_intent_id,p_stripe_session_id,
    p_stripe_subscription_id,v_fingerprint,'checkout',v_target_state,v_applied);
  return jsonb_build_object('applied',v_applied,'replayed',false,'state',v_target_state);
exception when unique_violation then
  raise exception 'Stripe session or event identity conflict' using errcode='23505';
end $$;

create or replace function public.portal_apply_tenant_subscription_event_service(
  p_event_id text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_tenant_id app.uuid_v7,
  p_plan_id text,
  p_status text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_current_period_start timestamptz default null,
  p_current_period_end timestamptz default null,
  p_checkout_intent_id app.uuid_v7 default null
) returns jsonb language plpgsql security definer set search_path='public','extensions' as $$
declare
  v_sub public.tenant_subscriptions%rowtype;
  v_intent public.billing_checkout_intents%rowtype;
  v_event public.billing_stripe_event_receipts%rowtype;
  v_fingerprint text;
  v_outcome text:='applied';
  v_applied boolean:=false;
begin
  if p_event_id !~ '^evt_[A-Za-z0-9_]{1,251}$' or p_event_type not in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted')
    or p_event_created_at is null or not isfinite(p_event_created_at) or p_event_created_at>statement_timestamp()+interval '5 minutes'
    or p_plan_id not in ('piloto','crescimento','escala')
    or p_status not in ('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused')
    or p_stripe_customer_id !~ '^cus_[A-Za-z0-9]{1,255}$'
    or p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]{1,255}$'
    or (p_current_period_start is not null and not isfinite(p_current_period_start))
    or (p_current_period_end is not null and not isfinite(p_current_period_end))
    or (p_current_period_start is not null and p_current_period_end is not null and p_current_period_end<=p_current_period_start)
  then raise exception 'invalid signed subscription event' using errcode='22023'; end if;
  v_fingerprint:=app.sha256_text(jsonb_build_array(p_event_id,p_event_type,p_event_created_at,p_tenant_id,p_plan_id,p_status,
    p_stripe_customer_id,p_stripe_subscription_id,p_current_period_start,p_current_period_end,p_checkout_intent_id)::text);
  perform pg_advisory_xact_lock(hashtextextended('stripe-event:'||p_event_id,0));
  select * into v_event from public.billing_stripe_event_receipts where event_id=p_event_id;
  if found then
    if v_event.receipt_kind<>'subscription' or v_event.payload_fingerprint<>v_fingerprint then raise exception 'Stripe event identity conflict' using errcode='23505'; end if;
    return jsonb_build_object('outcome','replayed','applied',false,'replayed',true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stripe-subscription:'||p_stripe_subscription_id,0));
  if exists(select 1 from public.tenant_subscriptions
      where stripe_subscription_id=p_stripe_subscription_id
        and (tenant_id<>p_tenant_id
          or (p_checkout_intent_id is not null and checkout_intent_id is distinct from p_checkout_intent_id)))
    or exists(select 1 from public.billing_checkout_intents
      where stripe_subscription_id=p_stripe_subscription_id
        and (tenant_id<>p_tenant_id
          or (p_checkout_intent_id is not null and id<>p_checkout_intent_id)))
  then raise exception 'Stripe subscription is owned by another tenant or checkout' using errcode='23505'; end if;
  perform pg_advisory_xact_lock(hashtextextended('billing-checkout:'||p_tenant_id::text,0));
  if not exists(select 1 from public.tenants where id=p_tenant_id) then raise exception 'unknown tenant' using errcode='42501'; end if;
  if p_checkout_intent_id is not null then
    select * into v_intent from public.billing_checkout_intents where id=p_checkout_intent_id for update;
    if not found or v_intent.tenant_id<>p_tenant_id or v_intent.plan_id<>p_plan_id
      or (v_intent.existing_stripe_customer_id is not null and v_intent.existing_stripe_customer_id<>p_stripe_customer_id)
      or (v_intent.stripe_customer_id is not null and v_intent.stripe_customer_id<>p_stripe_customer_id)
      or (v_intent.stripe_subscription_id is not null and v_intent.stripe_subscription_id<>p_stripe_subscription_id)
    then raise exception 'subscription event checkout tuple conflicts' using errcode='23505'; end if;
  end if;
  select * into v_sub from public.tenant_subscriptions where tenant_id=p_tenant_id for update;
  if found and v_sub.stripe_subscription_id=p_stripe_subscription_id then
    if v_sub.last_event_created_at is not null
      and (p_event_created_at,p_event_id)<=(v_sub.last_event_created_at,v_sub.last_event_id) then
      v_outcome:='ignored_stale';
    else
      if p_checkout_intent_id is not null and v_intent.state in ('bound','completed') then
        update public.billing_checkout_intents set state='completed',stripe_customer_id=p_stripe_customer_id,
          stripe_subscription_id=p_stripe_subscription_id,completed_at=coalesce(completed_at,now()),updated_at=now()
          where id=v_intent.id;
      elsif p_checkout_intent_id is not null then
        raise exception 'subscription intent is not bound' using errcode='55000';
      end if;
      update public.tenant_subscriptions set plan_id=p_plan_id,status=p_status,stripe_customer_id=p_stripe_customer_id,
        current_period_start=p_current_period_start,current_period_end=p_current_period_end,
        checkout_intent_id=coalesce(p_checkout_intent_id,checkout_intent_id),last_event_id=p_event_id,
        last_event_created_at=p_event_created_at,updated_at=now() where tenant_id=p_tenant_id;
      v_applied:=true;
    end if;
  elsif found then
    if v_sub.last_event_created_at is not null
      and (p_event_created_at,p_event_id)<=(v_sub.last_event_created_at,v_sub.last_event_id) then
      v_outcome:='ignored_superseded_subscription';
    elsif v_sub.status not in ('canceled','incomplete_expired') then
      if p_checkout_intent_id is not null then
        update public.billing_checkout_intents set state='conflict',updated_at=now()
          where id=p_checkout_intent_id and state in ('reserved','dispatched','bound','unknown','completed');
      end if;
      v_outcome:='duplicate_subscription_conflict';
    elsif p_checkout_intent_id is null or v_intent.state not in ('bound','completed')
      or (v_intent.stripe_customer_id is not null and v_intent.stripe_customer_id<>p_stripe_customer_id)
      or (v_intent.stripe_subscription_id is not null and v_intent.stripe_subscription_id<>p_stripe_subscription_id)
    then raise exception 'replacement subscription lacks an exact completed checkout intent' using errcode='55000';
    else
      update public.billing_checkout_intents set state='completed',stripe_customer_id=p_stripe_customer_id,
        stripe_subscription_id=p_stripe_subscription_id,completed_at=coalesce(completed_at,now()),updated_at=now()
        where id=v_intent.id;
      update public.tenant_subscriptions set plan_id=p_plan_id,status=p_status,stripe_customer_id=p_stripe_customer_id,
        stripe_subscription_id=p_stripe_subscription_id,current_period_start=p_current_period_start,
        current_period_end=p_current_period_end,checkout_intent_id=p_checkout_intent_id,last_event_id=p_event_id,
        last_event_created_at=p_event_created_at,updated_at=now() where tenant_id=p_tenant_id;
      v_applied:=true;
    end if;
  else
    if p_checkout_intent_id is null or v_intent.state not in ('bound','completed') then
      raise exception 'new subscription lacks a bound checkout intent' using errcode='55000'; end if;
    update public.billing_checkout_intents set state='completed',stripe_customer_id=p_stripe_customer_id,
      stripe_subscription_id=p_stripe_subscription_id,completed_at=coalesce(completed_at,now()),updated_at=now()
      where id=v_intent.id;
    insert into public.tenant_subscriptions(id,tenant_id,plan_id,status,stripe_customer_id,stripe_subscription_id,
      current_period_start,current_period_end,last_event_created_at,checkout_intent_id,last_event_id)
    values(p_checkout_intent_id,p_tenant_id,p_plan_id,p_status,p_stripe_customer_id,p_stripe_subscription_id,
      p_current_period_start,p_current_period_end,p_event_created_at,p_checkout_intent_id,p_event_id);
    v_applied:=true;
  end if;
  insert into public.billing_stripe_event_receipts(event_id,event_type,event_created_at,tenant_id,checkout_intent_id,
    stripe_subscription_id,payload_fingerprint,receipt_kind,receipt_outcome,receipt_applied)
  values(p_event_id,p_event_type,p_event_created_at,p_tenant_id,p_checkout_intent_id,p_stripe_subscription_id,
    v_fingerprint,'subscription',v_outcome,v_applied);
  return jsonb_build_object('outcome',v_outcome,'applied',v_applied,'replayed',false);
exception when unique_violation then
  raise exception 'Stripe subscription identity conflict' using errcode='23505';
end $$;

create or replace function public.portal_schema_capabilities_service()
returns jsonb language sql stable security definer set search_path='public' as $$
  select jsonb_build_object(
    'version',40,
    'providerEffectReservations',to_regclass('public.provider_effect_reservations') is not null,
    'providerEffectReconciliation',to_regprocedure('public.portal_lease_provider_effect_reconciliation_service(app.uuid_v7,integer,integer)') is not null,
    'billingUsageOutbox',to_regclass('public.billing_usage_outbox') is not null,
    'recallWebhookDedupe',to_regclass('public.recall_webhook_deliveries') is not null,
    'recallTenantBinding',to_regprocedure('public.portal_record_meeting_bot_session_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text,text,app.uuid_v7,app.uuid_v7)') is not null,
    'tavusWebhookCapabilities',to_regclass('public.tavus_webhook_deliveries') is not null,
    'tavusWebhookCapabilityLifecycle',
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='provider_effect_reservations' and column_name='tavus_webhook_capability_expires_at')
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='provider_effect_reservations' and column_name='tavus_webhook_capability_revoked_at')
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='tavus_webhook_deliveries' and column_name='observed_at')
      and to_regprocedure('public.portal_preflight_tavus_webhook_service(app.uuid_v7,text)') is not null
      and to_regprocedure('public.portal_claim_tavus_webhook_service(app.uuid_v7,text,text,text,app.uuid_v7,timestamp with time zone)') is not null,
    'tavusCustomerDeliveryReceipts',to_regclass('public.tavus_customer_delivery_receipts') is not null
      and to_regprocedure('public.portal_record_tavus_customer_delivery_service(app.uuid_v7,text,text,text,timestamp with time zone)') is not null
      and to_regprocedure('public.portal_record_tavus_no_delivery_service(app.uuid_v7,text,text,text,timestamp with time zone)') is not null,
    'tavusStageCapabilities',to_regclass('public.tavus_stage_capabilities') is not null
      and to_regprocedure('public.portal_create_tavus_stage_capability_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null
      and to_regprocedure('public.portal_resolve_tavus_stage_capability_service(text)') is not null
      and to_regprocedure('public.portal_revoke_tavus_stage_capability_service(app.uuid_v7)') is not null,
    'aiUsageReservations',to_regclass('public.ai_usage_reservations') is not null,
    'aiUsageReconciliation',to_regclass('public.ai_usage_reconciliation_receipts') is not null
      and to_regprocedure('public.portal_reconcile_ai_usage_service(app.uuid_v7,app.uuid_v7,text,text,integer,integer,numeric)') is not null
      and to_regprocedure('public.portal_ai_usage_reconciliation_backlog_service()') is not null,
    'workerHeartbeats',to_regclass('public.worker_heartbeats') is not null
      and to_regprocedure('public.portal_record_worker_heartbeat_service(text,app.uuid_v7,text,text,text,text,jsonb)') is not null
      and to_regprocedure('public.portal_worker_readiness_service()') is not null,
    'providerTranscriptService',to_regprocedure('public.portal_register_provider_transcript_service(app.uuid_v7,app.uuid_v7,app.uuid_v7,text,text)') is not null
    ,'billingCheckoutIntents',to_regclass('public.billing_checkout_intents') is not null
      and to_regclass('public.billing_stripe_event_receipts') is not null
      and to_regprocedure('public.portal_begin_billing_checkout_intent_service(app.uuid_v7,app.uuid_v7,uuid,text,text,text,boolean,integer,integer,text,text,text,text,timestamp with time zone)') is not null
      and to_regprocedure('public.portal_mark_billing_checkout_dispatched_service(app.uuid_v7)') is not null
      and to_regprocedure('public.portal_bind_billing_checkout_session_service(app.uuid_v7,text,text,timestamp with time zone)') is not null
      and to_regprocedure('public.portal_release_billing_checkout_intent_service(app.uuid_v7,text)') is not null
      and to_regprocedure('public.portal_apply_billing_checkout_event_service(text,text,timestamp with time zone,app.uuid_v7,text,app.uuid_v7,text,text,text,text)') is not null
      and to_regprocedure('public.portal_apply_tenant_subscription_event_service(text,text,timestamp with time zone,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,app.uuid_v7)') is not null,
    'strictSubscriptionIdentity',to_regclass('public.billing_checkout_intents_subscription_uidx') is not null
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='tenant_subscriptions' and column_name='checkout_intent_id')
      and exists(select 1 from information_schema.columns where table_schema='public' and table_name='tenant_subscriptions' and column_name='last_event_id')
      and to_regprocedure('public.portal_apply_billing_checkout_event_service(text,text,timestamp with time zone,app.uuid_v7,text,app.uuid_v7,text,text,text,text)') is not null
      and to_regprocedure('public.portal_apply_tenant_subscription_event_service(text,text,timestamp with time zone,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,app.uuid_v7)') is not null,
    'legacySubscriptionWriterRevoked',not has_function_privilege(
      'service_role',
      'public.portal_upsert_tenant_subscription_service(app.uuid_v7,app.uuid_v7,text,text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
      'EXECUTE'
    )
  )
$$;

create or replace function public.portal_register_provider_transcript_service(p_id app.uuid_v7,p_tenant_id app.uuid_v7,p_agent_id app.uuid_v7,p_surface text,p_external_ref text)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare v_existing public.conversation_transcripts%rowtype;
begin
  if p_surface not in ('video','meeting') or p_external_ref is null or char_length(p_external_ref) not between 1 and 255 then raise exception 'invalid provider transcript reference' using errcode='22023'; end if;
  if not exists(select 1 from public.agents where tenant_id=p_tenant_id and id=p_agent_id) then raise exception 'agent not found for tenant' using errcode='42501'; end if;
  -- A missing row cannot be protected by SELECT FOR UPDATE. Serialize the
  -- globally provider-owned reference before lookup so simultaneous retries
  -- deterministically become insert + replay instead of a unique violation.
  perform pg_advisory_xact_lock(hashtextextended(p_surface||':'||p_external_ref,0));
  select * into v_existing from public.conversation_transcripts where surface=p_surface and external_ref=p_external_ref for update;
  if found then
    if v_existing.tenant_id is distinct from p_tenant_id or v_existing.agent_id is distinct from p_agent_id then raise exception 'provider transcript ownership conflict' using errcode='23505'; end if;
    return jsonb_build_object('ok',true,'replayed',true);
  end if;
  insert into public.conversation_transcripts(id,tenant_id,agent_id,surface,external_ref,turns) values(p_id,p_tenant_id,p_agent_id,p_surface,p_external_ref,'[]');
  return jsonb_build_object('ok',true,'replayed',false);
end; $$;

create or replace function public.portal_list_conversation_transcripts(p_agent_id app.uuid_v7 default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare v_tenant app.uuid_v7; v_result jsonb; v_limit int:=least(greatest(coalesce(p_limit,50),1),200);
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id=auth.uid(); if v_tenant is null then return '[]'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'agentId',q.agent_id,'agentName',q.name,'surface',q.surface,'turnCount',jsonb_array_length(q.turns),'startedAt',q.started_at,'endedAt',q.ended_at) order by q.started_at desc),'[]') into v_result
  from (select t.id,t.agent_id,a.name,t.surface,t.turns,t.started_at,t.ended_at from public.conversation_transcripts t join public.agents a on a.tenant_id=t.tenant_id and a.id=t.agent_id where t.tenant_id=v_tenant and (p_agent_id is null or t.agent_id=p_agent_id) order by t.started_at desc,t.id desc limit v_limit) q;
  return v_result;
end; $$;

-- Ledger-authoritative usage summary. Legacy fields remain additive-compatible
-- for the current portal while the total fields include every provider/unit
-- exactly as recorded, including Tavus and Recall reservations.
create or replace function public.portal_usage_summary()
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare
  v_tenant app.uuid_v7;
  v_tokens_today bigint;
  v_conversations_today bigint;
  v_ai_cost_usd_today numeric(20,8);
  v_video_cost_floor_usd_today numeric(20,8);
  v_ai_cost_usd_7d numeric(20,8);
  v_video_cost_floor_usd_7d numeric(20,8);
  v_total_cost_usd_today numeric(20,8);
  v_total_cost_usd_7d numeric(20,8);
  v_services jsonb;
  v_video_floor_per_conversation constant numeric(20,10):=0.175;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode='28000'; end if;
  select tenant_id into v_tenant from public.user_tenant_memberships where user_id=auth.uid();
  if v_tenant is null then raise exception 'no tenant provisioned' using errcode='42501'; end if;

  select coalesce(sum(quantity),0)::bigint,coalesce(sum(amount_usd),0)
    into v_tokens_today,v_ai_cost_usd_today
    from public.cost_events where tenant_id=v_tenant and unit_type='token' and occurred_at>=date_trunc('day',now(),'UTC');
  select count(*) into v_conversations_today
    from public.cost_events where tenant_id=v_tenant and unit_type='conversation' and occurred_at>=date_trunc('day',now(),'UTC');
  v_video_cost_floor_usd_today:=v_conversations_today*v_video_floor_per_conversation;

  select coalesce(sum(amount_usd),0) into v_ai_cost_usd_7d
    from public.cost_events where tenant_id=v_tenant and unit_type='token' and occurred_at>=now()-interval '7 days';
  select count(*)*v_video_floor_per_conversation into v_video_cost_floor_usd_7d
    from public.cost_events where tenant_id=v_tenant and unit_type='conversation' and occurred_at>=now()-interval '7 days';
  select coalesce(sum(amount_usd),0) into v_total_cost_usd_today
    from public.cost_events where tenant_id=v_tenant and occurred_at>=date_trunc('day',now(),'UTC');
  select coalesce(sum(amount_usd),0) into v_total_cost_usd_7d
    from public.cost_events where tenant_id=v_tenant and occurred_at>=now()-interval '7 days';

  select coalesce(jsonb_agg(jsonb_build_object(
    'service',grouped.service,'unit_type',grouped.unit_type,
    'quantity',grouped.quantity,'amount_usd',grouped.amount_usd
  ) order by grouped.amount_usd desc,grouped.service,grouped.unit_type),'[]'::jsonb) into v_services
  from (
    select service,unit_type,sum(quantity) as quantity,sum(amount_usd) as amount_usd
    from public.cost_events where tenant_id=v_tenant and occurred_at>=now()-interval '7 days'
    group by service,unit_type
  ) grouped;

  return jsonb_build_object(
    'tokens_today',v_tokens_today,
    'conversations_today',v_conversations_today,
    'ai_cost_usd_today',v_ai_cost_usd_today,
    'video_cost_floor_usd_today',v_video_cost_floor_usd_today,
    'ai_cost_usd_7d',v_ai_cost_usd_7d,
    'video_cost_floor_usd_7d',v_video_cost_floor_usd_7d,
    'total_cost_usd_today',v_total_cost_usd_today,
    'total_cost_usd_7d',v_total_cost_usd_7d,
    'cost_precision','mixed_estimated_provider_reported',
    'cost_estimate_note','totais somam o ledger estimado/provider-reported; campos de piso de vídeo são mantidos apenas por compatibilidade',
    'services_7d',v_services
  );
end; $$;
revoke all on function public.portal_usage_summary() from public,anon;
grant execute on function public.portal_usage_summary() to authenticated;

-- All M5-01 control-plane RPCs are service-only. No direct table grants.
do $$ declare r record; begin
  for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
    'portal_begin_provider_effect_service','portal_mark_provider_effect_in_flight_service','portal_mark_provider_effect_unknown_service','portal_release_provider_effect_service','portal_reconcile_provider_effect_service','portal_lease_provider_effect_reconciliation_service','portal_ack_provider_effect_reconciliation_service','portal_fail_provider_effect_reconciliation_service','portal_provider_effect_reconciliation_backlog_service','portal_mark_provider_effect_cleanup_pending_service','portal_commit_provider_effect_service','portal_activate_provider_effect_billing_service','portal_complete_provider_effect_service','portal_update_meeting_bot_session_status_service','portal_mark_sentinel_conversation_created_service','portal_mark_sentinel_camera_started_service','portal_get_sentinel_attach_service','portal_record_meeting_bot_session_service','portal_lease_billing_usage_service','portal_ack_billing_usage_service','portal_fail_billing_usage_service','portal_void_unleased_billing_usage_service','portal_billing_usage_backlog_service','portal_bind_tavus_webhook_capability_service','portal_preflight_tavus_webhook_service','portal_record_tavus_customer_delivery_service','portal_record_tavus_no_delivery_service','portal_create_tavus_stage_capability_service','portal_resolve_tavus_stage_capability_service','portal_revoke_tavus_stage_capability_service','portal_claim_tavus_webhook_service','portal_complete_tavus_webhook_service','portal_release_tavus_webhook_service','portal_claim_recall_webhook_service','portal_complete_recall_webhook_service','portal_release_recall_webhook_service','portal_record_worker_heartbeat_service','portal_worker_readiness_service','portal_schema_capabilities_service','portal_register_provider_transcript_service','portal_begin_ai_usage_reservation_service','portal_mark_ai_usage_in_flight_service','portal_commit_ai_usage_service','portal_reconcile_ai_usage_service','portal_ai_usage_reconciliation_backlog_service','portal_mark_ai_usage_unknown_service','portal_release_ai_usage_service','portal_begin_billing_checkout_intent_service','portal_mark_billing_checkout_dispatched_service','portal_bind_billing_checkout_session_service','portal_release_billing_checkout_intent_service','portal_apply_billing_checkout_event_service','portal_apply_tenant_subscription_event_service')
  loop execute format('revoke all on function %s from public, anon, authenticated',r.signature); execute format('grant execute on function %s to service_role',r.signature); end loop;
end $$;
revoke all on function app.sha256_text(text) from public,anon,authenticated,service_role;
revoke all on function app.sha256_tuple(text[]) from public,anon,authenticated,service_role;
revoke all on function app.billing_checkout_intent_receipt(public.billing_checkout_intents,text) from public,anon,authenticated,service_role;
revoke all on function app.blocked_billing_checkout_intent_receipt(text) from public,anon,authenticated,service_role;
revoke all on function app.prevent_billing_checkout_snapshot_mutation() from public,anon,authenticated,service_role;
revoke all on function public.portal_list_conversation_transcripts(app.uuid_v7,integer) from public,anon;
grant execute on function public.portal_list_conversation_transcripts(app.uuid_v7,integer) to authenticated;

commit;
