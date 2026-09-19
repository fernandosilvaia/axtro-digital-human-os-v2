"use server";

import { createUuidV7 } from "@axtro/domain";
import { createStripeBillingPort, StripeBillingError } from "@axtro/provider-stripe";

import { fetchTenantOverview } from "@/lib/portal-data";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Server Actions do catálogo de checkout do closer (ADR-040): o
 * `tenant_admin` cadastra/desativa os produtos que `request_checkout` pode
 * oferecer. Nunca aceita preço/produto por texto livre do modelo -- este é
 * o único lugar que grava a linha que `request_checkout` depois só lê.
 *
 * `upsertBusinessCheckoutProduct` roda o MESMO preflight de preço vivo que
 * `checkout-preflight.ts` já aplica ao catálogo de assinatura da própria
 * Axtro, mas contra a conta CONECTADA do tenant: se o `stripe_price_id`
 * informado não existir, não estiver `active`, não for `one_time`, ou o
 * valor/moeda não baterem com o que o `tenant_admin` está digitando, o
 * cadastro é recusado antes de tocar o banco. Isso fecha o mesmo risco que
 * o dispatch-time preflight fecha depois (ver `stripe-checkout-dispatch.ts`):
 * o valor gravado como "o preço deste produto" só existe se a Stripe
 * confirmar que é esse o preço vivo, nunca o que o formulário disse sozinho.
 */
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRODUCT_ID_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
const CHECKOUT_CATALOG_CURRENCY = "usd";

function fakeProvidersEnabled(): boolean {
  return (process.env.PORTAL_FAKE_PROVIDERS ?? "").trim() === "1";
}

export interface UpsertBusinessCheckoutProductInput {
  readonly productId: string;
  readonly displayName: string;
  readonly stripePriceId: string;
  readonly unitAmountCents: number;
  readonly maxQuantity?: number;
}

export interface BusinessCheckoutCatalogActionState {
  readonly error: string | null;
}

export async function upsertBusinessCheckoutProduct(input: UpsertBusinessCheckoutProductInput): Promise<BusinessCheckoutCatalogActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) return { error: "Sessão expirada. Faça login de novo." };

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) return { error: "Conta ainda não provisionada." };
  if (overview.role !== "tenant_admin") return { error: "Somente administradores podem configurar o catálogo de cobrança." };

  const actorId = typeof user.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;
  if (actorId === null || !UUID_V7_PATTERN.test(actorId)) {
    trackError("checkout_catalog_upsert_missing_actor", new Error("authenticated session is missing a tenant actor id"), { tenant_id: overview.tenant.id });
    return { error: "Sessão inválida. Recarregue a página e tente de novo." };
  }

  if (!PRODUCT_ID_PATTERN.test(input.productId)) return { error: "Identificador do produto inválido." };
  if (input.displayName.trim().length === 0 || input.displayName.length > 200) return { error: "Nome de exibição inválido." };
  if (!Number.isInteger(input.unitAmountCents) || input.unitAmountCents < 1 || input.unitAmountCents > 99_999_999) return { error: "Valor inválido." };
  const maxQuantity = input.maxQuantity ?? 1;
  if (!Number.isInteger(maxQuantity) || maxQuantity < 1 || maxQuantity > 100) return { error: "Quantidade máxima inválida." };

  try {
    const service = createServiceRoleClient();
    const { data: statusData, error: statusError } = await service.rpc("portal_stripe_connect_status_service", {
      p_tenant_id: overview.tenant.id,
    });
    if (statusError) {
      trackError("checkout_catalog_upsert_status_failed", statusError, { tenant_id: overview.tenant.id });
      return { error: "Não foi possível confirmar a conexão com a Stripe agora. Tente novamente." };
    }
    const status = statusData as { outcome?: unknown; stripeAccountId?: unknown } | null;
    const stripeAccountId = status?.stripeAccountId;
    if (status?.outcome !== "found" || typeof stripeAccountId !== "string") {
      return { error: "Conecte a conta Stripe do tenant antes de cadastrar produtos." };
    }

    const fakeProviders = fakeProvidersEnabled();
    const apiKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
    if (!fakeProviders && apiKey.length === 0) {
      trackError("checkout_catalog_upsert_not_configured", new Error("Stripe API key is not configured"), { tenant_id: overview.tenant.id });
      return { error: "Cobrança não está configurada agora. Tente novamente mais tarde." };
    }

    try {
      const port = createStripeBillingPort({ apiKey: fakeProviders ? "sk_test_fake_checkout_catalog" : apiKey });
      if (fakeProviders) {
        // Modo demonstração: nunca toca a rede real, mas confirma que o
        // formato do priceId/preço faz sentido, mesmo espírito de
        // createDeterministicFakeCheckoutPort em checkout-preflight.ts.
        if (!/^price_[A-Za-z0-9]{1,255}$/.test(input.stripePriceId)) return { error: "Identificador de preço da Stripe inválido." };
      } else {
        await port.verifyConnectedAccountPrice({
          stripeAccountId,
          priceId: input.stripePriceId,
          expectedUnitAmountCents: input.unitAmountCents,
          expectedCurrency: CHECKOUT_CATALOG_CURRENCY,
        });
      }
    } catch (error) {
      const providerCode = error instanceof StripeBillingError ? error.code : "unknown";
      trackError("checkout_catalog_price_preflight_failed", new Error(`Stripe connected account price preflight failed (${providerCode})`), { tenant_id: overview.tenant.id });
      return { error: "O preço informado não bate com o que está ativo na conta Stripe conectada. Confira o valor e o identificador do preço." };
    }

    const { data, error } = await service.rpc("portal_upsert_business_checkout_product_service", {
      p_id: createUuidV7(),
      p_tenant_id: overview.tenant.id,
      p_actor_id: actorId,
      p_product_id: input.productId,
      p_display_name: input.displayName,
      p_stripe_price_id: input.stripePriceId,
      p_unit_amount_cents: input.unitAmountCents,
      p_max_quantity: maxQuantity,
    });
    if (error) {
      trackError("checkout_catalog_upsert_failed", error, { tenant_id: overview.tenant.id, product_id: input.productId });
      return { error: "Não foi possível salvar o produto agora. Tente novamente." };
    }
    const outcome = (data as { outcome?: unknown } | null)?.outcome;
    if (outcome !== "saved") {
      trackError("checkout_catalog_upsert_unexpected_outcome", new Error("unexpected checkout catalog upsert outcome"), { tenant_id: overview.tenant.id, outcome: String(outcome) });
      return { error: "Não foi possível confirmar o cadastro. Tente novamente." };
    }
  } catch (serviceError) {
    trackError("checkout_catalog_upsert_failed", serviceError, { tenant_id: overview.tenant.id, product_id: input.productId });
    return { error: "Não foi possível salvar o produto agora. Tente novamente." };
  }

  return { error: null };
}

export async function deactivateBusinessCheckoutProduct(productId: string): Promise<BusinessCheckoutCatalogActionState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user === null) return { error: "Sessão expirada. Faça login de novo." };

  const overview = await fetchTenantOverview();
  if (!overview.provisioned || overview.tenant === undefined) return { error: "Conta ainda não provisionada." };
  if (overview.role !== "tenant_admin") return { error: "Somente administradores podem configurar o catálogo de cobrança." };

  const actorId = typeof user.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : null;
  if (actorId === null || !UUID_V7_PATTERN.test(actorId)) {
    trackError("checkout_catalog_deactivate_missing_actor", new Error("authenticated session is missing a tenant actor id"), { tenant_id: overview.tenant.id });
    return { error: "Sessão inválida. Recarregue a página e tente de novo." };
  }
  if (!PRODUCT_ID_PATTERN.test(productId)) return { error: "Identificador do produto inválido." };

  try {
    const service = createServiceRoleClient();
    const { data, error } = await service.rpc("portal_deactivate_business_checkout_product_service", {
      p_tenant_id: overview.tenant.id,
      p_actor_id: actorId,
      p_product_id: productId,
    });
    if (error) {
      trackError("checkout_catalog_deactivate_failed", error, { tenant_id: overview.tenant.id, product_id: productId });
      return { error: "Não foi possível desativar o produto agora. Tente novamente." };
    }
    const outcome = (data as { outcome?: unknown } | null)?.outcome;
    if (outcome !== "deactivated" && outcome !== "not_found") {
      trackError("checkout_catalog_deactivate_unexpected_outcome", new Error("unexpected checkout catalog deactivate outcome"), { tenant_id: overview.tenant.id, outcome: String(outcome) });
      return { error: "Não foi possível confirmar a desativação. Tente novamente." };
    }
  } catch (serviceError) {
    trackError("checkout_catalog_deactivate_failed", serviceError, { tenant_id: overview.tenant.id, product_id: productId });
    return { error: "Não foi possível desativar o produto agora. Tente novamente." };
  }

  return { error: null };
}
