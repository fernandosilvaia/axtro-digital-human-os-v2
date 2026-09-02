-- ADR-041: resolves the model's 0-based slotIndex (the position it read
-- aloud from propose_meeting_slots' own response) into the slot_id UUID
-- that portal_reserve_business_meeting_slot_service (0052) requires as
-- p_slot_id. Closes the exact gap business-action-tool-call.ts documented
-- on confirm_meeting_slot: propose_meeting_slots hands the model a
-- 0-based index, never the underlying app.uuid_v7 row id (Art. 3: the
-- model never sees a raw database identifier for something it did not
-- create itself), so something has to translate before
-- reserveBusinessMeetingSlot can run at all.
--
-- Read-only, STABLE, SECURITY DEFINER, service_role-only -- same
-- anti-oracle discipline as portal_business_action_call_context_service
-- (0054) and portal_google_calendar_decrypted_refresh_token_service
-- (0053): every kind of "not found" (unknown proposal, index out of
-- range, proposal belonging to a different tenant) collapses to the same
-- {"outcome":"not_found"} response, never a distinguishable error the
-- model (or an attacker probing through a misconfigured surface) could
-- use to enumerate another tenant's proposals.
--
-- Deliberately does not touch portal_schema_capabilities_service() --
-- same reasoning 0055 already documented for itself ("no code path
-- branches on whether this fix is live"): the only caller of this RPC is
-- business-action-tool-call.ts, shipped in the same release as this
-- migration, so there is no cross-version caller that would ever need to
-- detect its presence at runtime.
--
-- NUMBERING NOTE: database/supabase-only/ already has an unapplied 0059
-- (0059_data_governance_disposition_workflow.sql, ADR-046) sitting on
-- disk, deliberately not yet applied to production (it would disable
-- RPCs the portal still calls directly -- see D-V2-161). This file is
-- numbered 0060, after it, so that if 0059 is applied later it is never
-- forced to reconcile against a schema state it was not written against.
begin;

create or replace function public.portal_business_action_resolve_meeting_slot_service(
  p_tenant_id app.uuid_v7,
  p_proposal_id app.uuid_v7,
  p_slot_index integer
) returns jsonb language sql stable security definer set search_path='public' as $$
  select case
    when s.id is null then jsonb_build_object('outcome','not_found')
    else jsonb_build_object(
      'outcome','found','slotId',s.id,'startAt',s.start_at,'endAt',s.end_at,'timezone',s.timezone
    )
  end
  from (values(1)) seed(n)
  left join public.portal_business_action_proposal_slots s
    on s.tenant_id=p_tenant_id and s.proposal_id=p_proposal_id and s.slot_index=p_slot_index
$$;

revoke all on function public.portal_business_action_resolve_meeting_slot_service(app.uuid_v7,app.uuid_v7,integer) from public,anon,authenticated,service_role;
grant execute on function public.portal_business_action_resolve_meeting_slot_service(app.uuid_v7,app.uuid_v7,integer) to service_role;

commit;
