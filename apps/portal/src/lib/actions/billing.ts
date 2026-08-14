"use server";

import { redirect } from "next/navigation";

import { createStripeBillingPort } from "@axtro/provider-stripe";

import {
  checkoutCatalogExpectation,
  createDeterministicFakeCheckoutPort,
} from "@/lib/billing/checkout-preflight";
import { createDurableCheckout } from "@/lib/billing/checkout-intents";
import { BILLING_TERMINAL_STATUSES, hasNonTerminalSubscription, isPlanId, PLAN_CATALOG } from "@/lib/billing/plans";
import { fetchTenantOverview } from "@/lib/portal-data";
import { portalPublicOrigin } from "@/lib/public-origin";
import { isRateLimited } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Server actions de cobrança (D-V2-101): assinar um plano (Checkout) e
 * gerenciar a assinatura existente (Customer Portal da Stripe — troca de
 * plano, forma de pagamento, faturas e cancelamento vivem lá, não aqui:
 * reimplementar isso na nossa UI duplicaria o que a Stripe já resolve
 * nativamente, e criar uma SEGUNDA Checkout Session pra um tenant que já
 * assina criaria uma segunda assinatura cobrando em paralelo).
 */

interface BillingStatusRow {
  readonly plan_id?: string | null;
  readonly status?: string | null;
  readonly stripe_customer_id?: string | null;
}

export async function startCheckout(formData: FormData): Promise<void> {
  const planIdRaw = String(formData.get("plan_id") ?? "");
  if (!isPlanId(planIdRaw)) {
    redirect("/configuracoes?billing_error=plano_invalido");
  }
  const plan = PLAN_CATALOG[planIdRaw];

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) {
    redirect("/login");
  }

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) {
    redirect("/configuracoes?billing_error=conta_nao_provisionada");
  }
  if (overview.role !== "tenant_admin") {
    // Ação de servidor é POST-ável direto (o botão só fica escondido na UI
    // pra quem não é admin — isso é UX, não fronteira de segurança).
    // Mesmo controle de papel que toda RPC administrativa do projeto já
    // aplica (ex.: portal_invite_member) — achado da revisão adversarial 2026-08-03.
    redirect("/configuracoes?billing_error=apenas_admin");
  }

  // Direct Server Action calls bypass the submit-once UI. The database is
  // still the durable single-effect authority; this tenant-scoped limiter
  // bounds catalog GET/recovery traffic on the current application instance.
  if (isRateLimited(`billing-checkout:${overview.tenant.id}`, 60_000, 6)) {
    redirect("/configuracoes?billing_error=checkout_pendente");
  }

  const fakeProviders = (process.env.PORTAL_FAKE_PROVIDERS ?? "").trim() === "1";
  const apiKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  const basePriceId = (process.env[plan.basePriceEnvVar] ?? "").trim();
  const overagePriceId = (process.env[plan.overagePriceEnvVar] ?? "").trim();
  const overageEventName = (process.env.STRIPE_CONVERSATION_OVERAGE_EVENT_NAME ?? "").trim();
  if (!fakeProviders && (apiKey.length === 0 || basePriceId.length === 0 || overagePriceId.length === 0 || overageEventName.length === 0)) {
    trackError("billing_checkout_not_configured", new Error("Stripe billing is not configured"), { plan_id: plan.id });
    redirect("/configuracoes?billing_error=nao_configurado");
  }

  const { data: statusData, error: statusError } = await supabase.rpc("portal_billing_status");
  if (statusError) {
    trackError("billing_checkout_status_failed", statusError, { plan_id: plan.id });
    redirect("/configuracoes?billing_error=falha_ao_ler_status");
  }
  const existing = (statusData ?? {}) as BillingStatusRow;
  const hasCustomer = typeof existing.stripe_customer_id === "string";
  if (hasCustomer && hasNonTerminalSubscription(existing.status)) {
    // Já tem assinatura viva (qualquer status não-terminal — active/trialing/
    // past_due/unpaid/paused/incomplete): troca ou reativação é no Customer
    // Portal, nunca um checkout novo (evita duas assinaturas cobrando em
    // paralelo da mesma conta). Achado D-V2-107: antes só bloqueava
    // status !== 'canceled', deixando 'unpaid'/'incomplete_expired'/'paused'
    // travados sem conseguir assinar nem gerenciar (a UI só mostra o botão
    // "gerenciar" pra status ACTIVE_STATUSES) — corrigido nos dois lados
    // (aqui e em billing-section.tsx) com a mesma classificação compartilhada.
    redirect("/configuracoes?billing_error=ja_assinante");
  }
  // Terminal (cancelou, ou a janela de confirmação de pagamento expirou) e
  // voltou a assinar: reaproveita o Customer existente em vez de criar um
  // novo com o mesmo e-mail — sem isso, o histórico de fatura/forma de
  // pagamento fragmenta no dashboard Stripe a cada ciclo (achado da
  // auditoria 2026-08-06, estendido a incomplete_expired em D-V2-107 —
  // mesmo racional, também é um estado terminal).
  const existingCustomerId = hasCustomer && existing.status !== null && existing.status !== undefined && BILLING_TERMINAL_STATUSES.has(existing.status)
    ? existing.stripe_customer_id
    : undefined;

  const effectiveApiKey = fakeProviders ? "sk_test_fake_checkout" : apiKey;
  const effectiveBasePriceId = fakeProviders ? `price_fake${plan.id}base` : basePriceId;
  const effectiveOveragePriceId = fakeProviders ? `price_fake${plan.id}overage` : overagePriceId;
  const effectiveEventName = fakeProviders ? "axtro_conversation_overage" : overageEventName;
  let checkoutDestination: string;
  try {
    const origin = portalPublicOrigin();
    const port = fakeProviders
      ? createDeterministicFakeCheckoutPort(`${origin}/configuracoes?billing_error=nao_configurado`)
      : createStripeBillingPort({ apiKey });
    // Stripe/SQL require at least 30 minutes. One minute of margin prevents
    // statement_timestamp() from making an exact +30m client instant stale
    // by the time the service-role transaction validates it.
    const expiresAtIso = new Date(Math.floor((Date.now() + 31 * 60_000) / 1000) * 1000).toISOString();
    const result = await createDurableCheckout({
      tenantId: overview.tenant.id,
      userId: user.id,
      planId: plan.id,
      basePriceId: effectiveBasePriceId,
      overagePriceId: effectiveOveragePriceId,
      ...(existingCustomerId ? { existingStripeCustomerId: existingCustomerId } : {}),
      successUrl: `${origin}/configuracoes?billing_success=1`,
      cancelUrl: `${origin}/configuracoes?billing_error=cancelado`,
      expiresAtIso,
      catalog: checkoutCatalogExpectation(plan, {
        apiKey: effectiveApiKey,
        eventName: effectiveEventName,
        basePriceId: effectiveBasePriceId,
        overagePriceId: effectiveOveragePriceId,
      }),
    }, {
      client: createServiceRoleClient(),
      port,
    });
    checkoutDestination = result.status === "ready"
      ? result.checkoutUrl
      : `/configuracoes?billing_error=${result.status === "conflict" ? "checkout_conflito" : "checkout_pendente"}`;
  } catch (error) {
    trackError("billing_checkout_failed", error, { plan_id: plan.id });
    redirect("/configuracoes?billing_error=falha_ao_criar_checkout");
  }

  redirect(checkoutDestination);
}

export async function openBillingPortal(): Promise<void> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) {
    redirect("/login");
  }

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) {
    redirect("/configuracoes?billing_error=conta_nao_provisionada");
  }
  if (overview.role !== "tenant_admin") {
    redirect("/configuracoes?billing_error=apenas_admin");
  }

  const apiKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (apiKey.length === 0) {
    redirect("/configuracoes?billing_error=nao_configurado");
  }

  const { data: statusData, error } = await supabase.rpc("portal_billing_status");
  if (error) {
    trackError("billing_portal_status_failed", error, {});
    redirect("/configuracoes?billing_error=falha_ao_ler_status");
  }
  const status = (statusData ?? {}) as BillingStatusRow;
  if (typeof status.stripe_customer_id !== "string") {
    redirect("/configuracoes?billing_error=sem_assinatura");
  }

  const port = createStripeBillingPort({ apiKey });
  let portalUrl: string;
  try {
    const session = await port.createPortalSession({
      stripeCustomerId: status.stripe_customer_id,
      returnUrl: `${portalPublicOrigin()}/configuracoes`,
    });
    portalUrl = session.portalUrl;
  } catch (portalError) {
    trackError("billing_portal_failed", portalError, {});
    redirect("/configuracoes?billing_error=falha_ao_abrir_portal");
  }

  redirect(portalUrl);
}
