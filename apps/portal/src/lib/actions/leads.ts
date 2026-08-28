"use server";

import { fakeProvidersEnabled } from "@/lib/knowledge";
import { admitBusinessAction, registerBusinessLead, type PortalBusinessActionRejectionCode } from "@/lib/runtime/portal-business-action-bridge";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";

/**
 * ADR-039 wave 1a direct calling surface for register_lead. The tool call
 * that would supply sessionId/presenterId from an already-admitted live
 * video session (video-conversation.ts, ADR-039 "Fronteira navegador ->
 * servidor") is a later ticket; today's caller supplies them directly, the
 * same way every other business-action funnel input is supplied.
 */

export interface RegisterLeadInput {
  readonly agentId: string;
  readonly sessionId: string;
  readonly presenterId: string;
  /** Minted once by the caller, preserved across retries (same discipline as meeting-bot.ts's commandId). */
  readonly commandId: string;
  readonly contactName: string;
  readonly contactEmail?: string | null;
  readonly contactPhone?: string | null;
  readonly qualificationSummary?: string;
}

export interface RegisterLeadResult {
  readonly leadId: string | null;
  readonly error: string | null;
}

function admissionErrorMessage(code: PortalBusinessActionRejectionCode): string {
  switch (code) {
    case "bridge_disabled":
      return "O registro de leads pela agente ainda não está disponível neste ambiente.";
    case "kill_switch_active":
      return "Este recurso foi pausado pela equipe responsável. Tente novamente mais tarde.";
    case "agent_inactive":
      return "Este agente está inativo.";
    case "presenter_mismatch":
      return "A sessão mudou de apresentador. Recarregue e tente novamente.";
    case "denied_disclosure":
    case "denied_essential_consent":
    case "denied_purpose_consent":
      return "Esta sessão ainda não tem o consentimento necessário para registrar um lead.";
    case "grant_expired":
    case "grant_invalid":
      return "A autorização para este registro expirou. Tente novamente.";
    default:
      return "Não foi possível registrar o lead com segurança agora.";
  }
}

export async function registerLead(input: RegisterLeadInput): Promise<RegisterLeadResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) {
    return { leadId: null, error: "Sua sessão pode ter expirado. Recarregue a página e faça login de novo." };
  }

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) {
    return { leadId: null, error: "Conta ainda não provisionada." };
  }

  const agents = await fetchAgents();
  const agent = agents.find((candidate) => candidate.id === input.agentId);
  if (!agent) {
    return { leadId: null, error: "Agente não encontrado nesta conta." };
  }

  const contactEmail = input.contactEmail ?? null;
  const contactPhone = input.contactPhone ?? null;
  const qualificationSummary = input.qualificationSummary ?? "";

  const admission = await admitBusinessAction({
    tenantId: overview.tenant.id,
    agentId: agent.id,
    sessionId: input.sessionId,
    presenterId: input.presenterId,
    actionKind: "register_lead",
    commandId: input.commandId,
    args: { contactName: input.contactName, contactEmail, contactPhone, qualificationSummary },
  });
  if (admission.outcome === "rejected") {
    // service_unavailable in a real tenant means the RPC call itself failed
    // (worth an operator alert); a demo tenant is not expected to have a
    // real admitted session behind sessionId/presenterId yet, so the same
    // outcome there is not a production signal (meeting-bot.ts fakeProvidersEnabled
    // precedent).
    if (admission.code === "service_unavailable" && !fakeProvidersEnabled()) {
      trackError("register_lead_admission_failed", new Error(`admission rejected: ${admission.code}`), { agent_id: agent.id });
    }
    return { leadId: null, error: admissionErrorMessage(admission.code) };
  }

  const registration = await registerBusinessLead({
    grant: admission.grant,
    contactName: input.contactName,
    contactEmail,
    contactPhone,
    qualificationSummary,
  });
  if (registration.outcome === "rejected") {
    if (registration.code === "service_unavailable" && !fakeProvidersEnabled()) {
      trackError("register_lead_registration_failed", new Error(`registration rejected: ${registration.code}`), { agent_id: agent.id });
    }
    return { leadId: null, error: admissionErrorMessage(registration.code) };
  }

  return { leadId: registration.leadId, error: null };
}
