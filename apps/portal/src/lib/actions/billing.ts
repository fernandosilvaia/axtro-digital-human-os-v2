"use server";

import { redirect } from "next/navigation";

import { createStripeBillingPort } from "@axtro/provider-stripe";

import { isPlanId, PLAN_CATALOG } from "@/lib/billing/plans";
import { fetchTenantOverview } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Server actions de cobrança (D-V2-101): assinar um plano (Checkout) e
 * gerenciar a assinatura existente (Customer Portal da Stripe — troca de
 * plano, forma de pagamento, faturas e cancelamento vivem lá, não aqui:
 * reimplementar isso na nossa UI duplicaria o que a Stripe já resolve
 * nativamente, e criar uma SEGUNDA Checkout Session pra um tenant que já
 * assina criaria uma segunda assinatura cobrando em paralelo).
 */

function publicUrl(path: string): string {
  const base = (process.env.PORTAL_PUBLIC_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://portal-production-b43e.up.railway.app").replace(/\/$/, "");
  return `${base}${path}`;
}

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

  const apiKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  const basePriceId = (process.env[plan.basePriceEnvVar] ?? "").trim();
  const overagePriceId = (process.env[plan.overagePriceEnvVar] ?? "").trim();
  if (apiKey.length === 0 || basePriceId.length === 0 || overagePriceId.length === 0) {
    trackError("billing_checkout_not_configured", new Error("Stripe billing is not configured"), { plan_id: plan.id });
    redirect("/configuracoes?billing_error=nao_configurado");
  }

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

  const { data: statusData } = await supabase.rpc("portal_billing_status");
  const existing = (statusData ?? {}) as BillingStatusRow;
  if (typeof existing.stripe_customer_id === "string" && existing.status !== "canceled") {
    // Já assinante: troca de plano é no Customer Portal (evita criar uma
    // segunda assinatura cobrando em paralelo da mesma conta).
    redirect("/configuracoes?billing_error=ja_assinante");
  }

  const port = createStripeBillingPort({ apiKey });
  let checkoutUrl: string;
  try {
    const session = await port.createCheckoutSession({
      tenantId: overview.tenant.id,
      planId: plan.id,
      basePriceId,
      overagePriceId,
      ...(typeof user.email === "string" && user.email.length > 0 ? { customerEmail: user.email } : {}),
      successUrl: publicUrl("/configuracoes?billing_success=1"),
      cancelUrl: publicUrl("/configuracoes?billing_error=cancelado"),
    });
    checkoutUrl = session.checkoutUrl;
  } catch (error) {
    trackError("billing_checkout_failed", error, { plan_id: plan.id });
    redirect("/configuracoes?billing_error=falha_ao_criar_checkout");
  }

  redirect(checkoutUrl);
}

export async function openBillingPortal(): Promise<void> {
  const apiKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (apiKey.length === 0) {
    redirect("/configuracoes?billing_error=nao_configurado");
  }

  const overview = await fetchTenantOverview();
  if (overview.role !== "tenant_admin") {
    redirect("/configuracoes?billing_error=apenas_admin");
  }

  const supabase = await createClient();
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
      returnUrl: publicUrl("/configuracoes"),
    });
    portalUrl = session.portalUrl;
  } catch (portalError) {
    trackError("billing_portal_failed", portalError, {});
    redirect("/configuracoes?billing_error=falha_ao_abrir_portal");
  }

  redirect(portalUrl);
}
