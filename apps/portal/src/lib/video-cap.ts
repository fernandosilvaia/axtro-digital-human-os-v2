// Módulo exclusivo de servidor: teto de conversas de vídeo por tenant +
// cobrança de overage (D-V2-101). O teto DIÁRIO é a rede de segurança
// contra abuso/bug (existe independente de assinatura, nunca muda com o
// plano — falha fechada: se a leitura de uso falhar, a conversa NÃO abre).
// O teto MENSAL vem do plano contratado e, quando estourado, NÃO bloqueia
// — a conversa acontece normalmente e a unidade extra é cobrada como
// overage (Stripe Billing Meter), que é o modelo de negócio inteiro
// (docs/PRICING_UNIT_ECONOMICS.md): margem sã mesmo no pior caso de uso.
import { createStripeBillingPort } from "@axtro/provider-stripe";

import { conversationOverageEventName, isPlanId, isTrialLimitEnabled, PLAN_CATALOG, TRIAL_INCLUDED_CONVERSATIONS_PER_MONTH } from "./billing/plans.ts";
import { maybeAlertCostCap } from "./cost-alerts.ts";
import type { createClient } from "./supabase/server.ts";
import { logError as trackError } from "./telemetry.ts";

export const DAILY_VIDEO_CONVERSATION_CAP = 20;

export const VIDEO_CAP_MESSAGE =
  "A conta atingiu o limite diário de conversas de vídeo. Volte amanhã ou fale com o suporte para ampliar o plano.";

export const VIDEO_CAP_CHECK_FAILED_MESSAGE =
  "Não foi possível verificar o uso de vídeo da conta. Tente novamente.";

export const VIDEO_TRIAL_CAP_MESSAGE =
  "Sua conta de avaliação atingiu o limite de conversas do mês. Assine um plano para continuar.";

/**
 * "allowed_overage": dentro do teto diário de segurança, mas já passou do
 * incluído mensal do plano — a conversa é permitida e cobrada como
 * overage. Callers devem tratar "allowed" e "allowed_overage" como
 * igualmente liberados pra decidir se a conversa acontece; a diferença só
 * importa depois, pra decidir se chama reportConversationOverageIfNeeded.
 */
export type VideoCapVerdict = "allowed" | "allowed_overage" | "capped" | "check_failed";

interface BillingStatusRow {
  readonly tenant_id?: string | null;
  readonly plan_id?: string | null;
  readonly status?: string | null;
  readonly stripe_customer_id?: string | null;
  readonly conversations_today?: number | null;
  readonly conversations_this_period?: number | null;
}

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function checkVideoCap(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<VideoCapVerdict> {
  const { data, error } = await supabase.rpc("portal_billing_status");
  if (error) {
    trackError("video_cap_check_failed", error);
    return "check_failed";
  }
  const status = (data ?? {}) as BillingStatusRow;
  const conversationsToday = Number(status.conversations_today ?? 0);
  // Alerta proativo (D-V2-107): fire-and-forget, nunca atrasa a decisão de
  // liberar/bloquear a conversa. tenant_id vem do MESMO retorno da RPC que
  // já líamos aqui (0031 acrescentou o campo) — zero query nova.
  if (typeof status.tenant_id === "string") {
    void maybeAlertCostCap({ tenantId: status.tenant_id, capKind: "daily_video_conversations", current: conversationsToday, cap: DAILY_VIDEO_CONVERSATION_CAP });
  }
  if (conversationsToday >= DAILY_VIDEO_CONVERSATION_CAP) return "capped";

  const conversationsThisPeriod = Number(status.conversations_this_period ?? 0);

  if (isPlanId(status.plan_id) && typeof status.status === "string" && ACTIVE_STATUSES.has(status.status)) {
    const included = PLAN_CATALOG[status.plan_id].includedConversationsPerMonth;
    return conversationsThisPeriod >= included ? "allowed_overage" : "allowed";
  }

  // Sem assinatura ativa: comportamento de sempre (só o teto diário), a
  // menos que o teto de avaliação esteja ligado (desligado por padrão —
  // ver BILLING_TRIAL_LIMIT_ENABLED em lib/billing/plans.ts).
  if (isTrialLimitEnabled() && conversationsThisPeriod >= TRIAL_INCLUDED_CONVERSATIONS_PER_MONTH) {
    return "capped";
  }
  return "allowed";
}

/**
 * Reporta 1 unidade de overage à Stripe quando a conversa que acabou de ser
 * logada (costEventId) passou do incluído do plano. Nunca bloqueia nem
 * lança — é side-effect de cobrança de uma conversa que JÁ aconteceu; falha
 * aqui vira telemetria, nunca reverte o que já foi feito. Chave de
 * idempotência amarrada ao costEventId: retry nunca cobra duas vezes a
 * mesma conversa.
 */
export async function reportConversationOverageIfNeeded(
  supabase: Awaited<ReturnType<typeof createClient>>,
  verdict: VideoCapVerdict,
  costEventId: string,
): Promise<void> {
  if (verdict !== "allowed_overage") return;
  const apiKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (apiKey.length === 0) return;

  try {
    const { data, error: statusError } = await supabase.rpc("portal_billing_status");
    if (statusError) {
      // Falha de leitura aqui não pode virar "nada a reportar" em
      // silêncio — sem isso, uma conversa que É overage nunca é cobrada e
      // nem fica visível pra investigar (achado da revisão adversarial
      // 2026-08-03, mesma disciplina de checkVideoCap).
      trackError("billing_overage_status_read_failed", statusError, { cost_event_id: costEventId });
      return;
    }
    const status = (data ?? {}) as BillingStatusRow;
    if (!isPlanId(status.plan_id) || typeof status.stripe_customer_id !== "string") return;

    const port = createStripeBillingPort({ apiKey });
    await port.reportOverageUsage({
      stripeCustomerId: status.stripe_customer_id,
      eventName: conversationOverageEventName(),
      quantity: 1,
      idempotencyKey: `overage:${status.stripe_customer_id}:${costEventId}`,
    });
  } catch (error) {
    trackError("billing_overage_report_failed", error, { cost_event_id: costEventId });
  }
}
