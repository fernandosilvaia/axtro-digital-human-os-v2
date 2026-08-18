"use server";

import { fakeProvidersEnabled } from "@/lib/knowledge";
import { isPlanId, PLAN_CATALOG } from "@/lib/billing/plans";
import { sendProposalEmail } from "@/lib/email";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { portalPublicOrigin } from "@/lib/public-origin";
import { isRateLimited } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/telemetry";

/**
 * Fechamento ao vivo (D-V2-123): depois de um closer pedir a decisão numa
 * call, um admin revisa empresa/e-mail/plano e dispara a proposta — nunca
 * a própria IA, meio da call ("IA rascunha, humano manda",
 * docs/BRIEFING_RAISSA_CLOSER_VIDEO.md §6). O checkout real de prospect fica
 * deliberadamente fechado até ganhar intent durável e reconciliação próprios.
 */

export interface ProposalActionState {
  readonly error: string | null;
  readonly done: boolean;
}

const PROSPECT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function sendClosingProposal(
  _prevState: ProposalActionState,
  formData: FormData,
): Promise<ProposalActionState> {
  const agentId = String(formData.get("agent_id") ?? "").trim();
  const companyName = String(formData.get("prospect_company") ?? "").trim();
  const prospectEmail = String(formData.get("prospect_email") ?? "").trim();
  const planIdRaw = String(formData.get("plan_id") ?? "");

  if (companyName.length === 0 || companyName.length > 160) {
    return { error: "O nome da empresa precisa ter entre 1 e 160 caracteres.", done: false };
  }
  if (prospectEmail.length === 0 || prospectEmail.length > 255 || !PROSPECT_EMAIL_PATTERN.test(prospectEmail)) {
    return { error: "Informe um e-mail válido para o prospect.", done: false };
  }
  if (!isPlanId(planIdRaw)) {
    return { error: "Plano inválido — escolha um dos planos listados.", done: false };
  }
  const plan = PLAN_CATALOG[planIdRaw];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) {
    return { error: "Sua sessão pode ter expirado — recarregue a página e faça login de novo.", done: false };
  }

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) {
    return { error: "Conta ainda não provisionada.", done: false };
  }
  if (overview.role !== "tenant_admin") {
    return { error: "Somente administradores podem enviar propostas.", done: false };
  }

  const agents = await fetchAgents();
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return { error: "Agente não encontrado nesta conta.", done: false };
  }

  if (isRateLimited(`closing-proposal:${overview.tenant.id}`, 60_000, 6)) {
    return { error: "Muitas propostas em pouco tempo — aguarde um minuto antes de tentar de novo.", done: false };
  }

  if (!fakeProvidersEnabled()) {
    // ADR-036 exige intent persistida, fence e reconciliação também para uma
    // assinatura iniciada por prospect. Esse fluxo ainda não possui a entidade
    // service-owned; não criar a sessão é mais seguro do que cobrar duas vezes
    // após timeout/retry do Server Action.
    logEvent("closing_proposal_checkout_blocked", { plan_id: plan.id, agent_id: agentId });
    return {
      error: "O checkout de proposta está temporariamente indisponível enquanto finalizamos a proteção de cobrança. Use o fluxo comercial assistido.",
      done: false,
    };
  }

  const checkoutUrl = `${portalPublicOrigin()}/precos?fake_checkout=1&plan=${plan.id}`;

  const emailResult = await sendProposalEmail({
    to: prospectEmail,
    prospectCompanyName: companyName,
    closerName: agent.name,
    planLabel: plan.name,
    checkoutUrl,
  });
  if (!emailResult.sent && emailResult.reason === "provider_error") {
    return { error: "O link foi gerado, mas o e-mail não pôde ser enviado agora. Copie o link manualmente.", done: false };
  }

  logEvent("closing_proposal_sent", { plan_id: plan.id, agent_id: agentId, mocked: !emailResult.sent });
  return { error: null, done: true };
}
