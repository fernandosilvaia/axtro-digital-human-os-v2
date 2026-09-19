"use server";

import { fetchTenantOverview } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Server Actions de aprovação/rejeição de reserva de checkout (ADR-040),
 * onda de aprovação humana obrigatória: só um `tenant_admin` aprova ou
 * rejeita, e nenhuma das duas RPCs chamadas aqui toca a Stripe (fence
 * estrito `pending_approval` -> `reserved`/`rejected`, nunca mais adiante).
 * A tela que lista reservas `pending_approval` e chama estas actions é
 * trabalho de produto fora do escopo de código deste ADR; o contrato aqui é
 * o que essa tela vai chamar.
 *
 * O que vem DEPOIS de `approveBusinessCheckoutReservation` (dispatch, o
 * preflight de preço vivo repetido, a criação real da Checkout Session na
 * Stripe, o commit e o disparo do e-mail) é uma orquestração de efeito
 * externo com a mesma disciplina de fence/retry/reconciliação do ADR-036,
 * e este repositório ainda não tem essa orquestração implementada para
 * NENHUMA ação de negócio (nem para `confirm_meeting_slot`/Google Calendar,
 * que tem exatamente a mesma lacuna: a RPC de reserva já existe, mas
 * nenhuma Server Action chama `insertEvent` de verdade ainda). Construir
 * essa peça pela primeira vez neste repositório merece sua própria rodada
 * dedicada, não algo encaixado aqui; até lá, uma reserva `reserved` fica
 * aguardando o dispatch, sem nenhuma cobrança criada.
 */
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface CheckoutApprovalActionState {
  readonly error: string | null;
}

async function requireTenantAdminActor(): Promise<
  | { readonly ok: true; readonly tenantId: string; readonly actorId: string }
  | { readonly ok: false; readonly error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) return { ok: false, error: "Sessão expirada. Faça login de novo." };

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) return { ok: false, error: "Conta ainda não provisionada." };
  if (overview.role !== "tenant_admin") return { ok: false, error: "Somente administradores podem aprovar ou rejeitar cobranças." };

  const actorId = typeof user.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;
  if (actorId === null || !UUID_V7_PATTERN.test(actorId)) {
    trackError("checkout_approval_missing_actor", new Error("authenticated session is missing a tenant actor id"), { tenant_id: overview.tenant.id });
    return { ok: false, error: "Sessão inválida. Recarregue a página e tente de novo." };
  }
  return { ok: true, tenantId: overview.tenant.id, actorId };
}

export async function approveBusinessCheckoutReservation(reservationId: string, contactEmail?: string): Promise<CheckoutApprovalActionState> {
  if (!UUID_V7_PATTERN.test(reservationId)) return { error: "Reserva inválida." };
  const actor = await requireTenantAdminActor();
  if (!actor.ok) return { error: actor.error };

  try {
    const service = createServiceRoleClient();
    const { data, error } = await service.rpc("portal_approve_business_checkout_service", {
      p_tenant_id: actor.tenantId,
      p_reservation_id: reservationId,
      p_actor_id: actor.actorId,
      p_contact_email: contactEmail?.trim() || null,
    });
    if (error) {
      trackError("checkout_approve_failed", error, { tenant_id: actor.tenantId, reservation_id: reservationId });
      return { error: "Não foi possível aprovar agora. Tente novamente." };
    }
    const outcome = (data as { outcome?: unknown } | null)?.outcome;
    if (outcome === "contact_email_required") return { error: "Informe o e-mail do prospect para aprovar: nenhuma chamada anterior capturou um." };
    if (outcome === "already_rejected") return { error: "Esta cobrança já foi rejeitada." };
    if (outcome === "approval_expired") return { error: "O prazo de aprovação desta cobrança expirou." };
    if (outcome !== "approved" && outcome !== "already_approved") {
      trackError("checkout_approve_unexpected_outcome", new Error("unexpected checkout approval outcome"), { tenant_id: actor.tenantId, reservation_id: reservationId, outcome: String(outcome) });
      return { error: "Não foi possível confirmar a aprovação. Tente novamente." };
    }
  } catch (serviceError) {
    trackError("checkout_approve_failed", serviceError, { tenant_id: actor.tenantId, reservation_id: reservationId });
    return { error: "Não foi possível aprovar agora. Tente novamente." };
  }

  return { error: null };
}

export async function rejectBusinessCheckoutReservation(reservationId: string, rejectionReason?: string): Promise<CheckoutApprovalActionState> {
  if (!UUID_V7_PATTERN.test(reservationId)) return { error: "Reserva inválida." };
  const trimmedReason = rejectionReason?.trim() || null;
  if (trimmedReason !== null && trimmedReason.length > 500) return { error: "Motivo da rejeição muito longo." };
  const actor = await requireTenantAdminActor();
  if (!actor.ok) return { error: actor.error };

  try {
    const service = createServiceRoleClient();
    const { data, error } = await service.rpc("portal_reject_business_checkout_service", {
      p_tenant_id: actor.tenantId,
      p_reservation_id: reservationId,
      p_actor_id: actor.actorId,
      p_rejection_reason: trimmedReason,
    });
    if (error) {
      trackError("checkout_reject_failed", error, { tenant_id: actor.tenantId, reservation_id: reservationId });
      return { error: "Não foi possível rejeitar agora. Tente novamente." };
    }
    const outcome = (data as { outcome?: unknown } | null)?.outcome;
    if (outcome === "already_approved") return { error: "Esta cobrança já foi aprovada." };
    if (outcome === "approval_expired") return { error: "O prazo de aprovação desta cobrança já expirou." };
    if (outcome !== "rejected" && outcome !== "already_rejected") {
      trackError("checkout_reject_unexpected_outcome", new Error("unexpected checkout rejection outcome"), { tenant_id: actor.tenantId, reservation_id: reservationId, outcome: String(outcome) });
      return { error: "Não foi possível confirmar a rejeição. Tente novamente." };
    }
  } catch (serviceError) {
    trackError("checkout_reject_failed", serviceError, { tenant_id: actor.tenantId, reservation_id: reservationId });
    return { error: "Não foi possível rejeitar agora. Tente novamente." };
  }

  return { error: null };
}
