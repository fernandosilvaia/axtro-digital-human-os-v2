import { isRecallRegion, parseRecallTranscriptDownloadHosts, recallApiBaseUrl } from "@axtro/provider-recall";

import { configuredOpenRouterGenerationModel } from "../../../lib/ai-budget/reservations.ts";
import { isRecallWebhookSecretConfigured } from "../../../lib/meetings/webhook.ts";
import { isPortalPublicOriginConfigured } from "../../../lib/public-origin.ts";
import { portalDeploymentId } from "../../../lib/workers/heartbeat.ts";

export interface ReadinessChecks {
  readonly supabase_url: boolean;
  readonly supabase_publishable_key: boolean;
  readonly supabase_service_role: boolean;
  readonly provider_mode: boolean;
  readonly public_origin: boolean;
  readonly deployment_identity: boolean;
  readonly recall_api_key: boolean;
  readonly recall_api_region: boolean;
  readonly recall_api_base_url: boolean;
  readonly recall_transcript_download_hosts: boolean;
  readonly recall_webhook_hmac: boolean;
  readonly tavus_api_key: boolean;
  readonly openrouter_api_key: boolean;
  readonly openrouter_model_rate_card: boolean;
  readonly ai_usage_reconcile_secret: boolean;
  readonly billing_usage_outbox_flag: boolean;
  readonly billing_dispatch_secret: boolean;
  readonly stripe_api_key: boolean;
  readonly stripe_webhook_secret: boolean;
  readonly stripe_meter_name: boolean;
  readonly stripe_price_catalog: boolean;
  readonly provider_effect_reconciler_flag: boolean;
  readonly provider_effect_reconcile_secret: boolean;
}

function isHttpsUrl(value: string | undefined): boolean {
  try {
    return new URL(value ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

function parseOptionalFeatureFlag(value: string | undefined): boolean | null {
  if (value === undefined || value.trim().length === 0) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

function hasKey(value: string | undefined, minimumLength = 8): boolean {
  return (value ?? "").trim().length >= minimumLength;
}

const STRIPE_PRICE_ENV_VARS = Object.freeze([
  "STRIPE_PRICE_PILOTO_BASE",
  "STRIPE_PRICE_PILOTO_OVERAGE",
  "STRIPE_PRICE_CRESCIMENTO_BASE",
  "STRIPE_PRICE_CRESCIMENTO_OVERAGE",
  "STRIPE_PRICE_ESCALA_BASE",
  "STRIPE_PRICE_ESCALA_OVERAGE",
] as const);

function hasStripeWebhookSecret(value: string | undefined): boolean {
  return /^whsec_[A-Za-z0-9_+/=-]{16,}$/.test((value ?? "").trim());
}

function hasStripeMeterName(value: string | undefined): boolean {
  return /^[a-z][a-z0-9_]{2,79}$/.test((value ?? "").trim());
}

function hasStripePriceCatalog(env: NodeJS.ProcessEnv): boolean {
  return STRIPE_PRICE_ENV_VARS.every((name) => /^price_[A-Za-z0-9]{1,255}$/.test((env[name] ?? "").trim()));
}

function hasReviewedOpenRouterModel(env: NodeJS.ProcessEnv): boolean {
  try {
    configuredOpenRouterGenerationModel(env);
    return true;
  } catch {
    return false;
  }
}

function hasDeploymentIdentity(env: NodeJS.ProcessEnv): boolean {
  try {
    portalDeploymentId(env);
    return true;
  } catch {
    return false;
  }
}

export function readinessConfig(env: NodeJS.ProcessEnv): ReadinessChecks {
  const fakeModeValue = (env.PORTAL_FAKE_PROVIDERS ?? "").trim();
  const providerModeValid = fakeModeValue === "" || fakeModeValue === "0" || fakeModeValue === "1";
  const fakeMode = fakeModeValue === "1";
  const recallRegionValue = (env.RECALL_API_REGION ?? "").trim();
  const recallRegionValid = isRecallRegion(recallRegionValue);
  const transcriptHosts = parseRecallTranscriptDownloadHosts(env.RECALL_TRANSCRIPT_DOWNLOAD_HOSTS);
  const billingUsageOutbox = parseOptionalFeatureFlag(env.BILLING_USAGE_OUTBOX_ENABLED);
  const billingDisabled = fakeMode && billingUsageOutbox === false;
  const providerEffectReconciler = parseOptionalFeatureFlag(env.PROVIDER_EFFECT_RECONCILER_ENABLED);
  const providerEffectReconcilerDisabled = fakeMode && providerEffectReconciler === false;
  return {
    supabase_url: isHttpsUrl(env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
    supabase_publishable_key: (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "").trim().length > 0,
    supabase_service_role: (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim().length > 0,
    provider_mode: providerModeValid,
    public_origin: isPortalPublicOriginConfigured(env),
    deployment_identity: hasDeploymentIdentity(env),
    recall_api_key: fakeMode || hasKey(env.RECALL_API_KEY),
    recall_api_region: fakeMode || recallRegionValid,
    recall_api_base_url: fakeMode || (recallRegionValid && isHttpsUrl(recallApiBaseUrl(recallRegionValue))),
    recall_transcript_download_hosts: fakeMode || transcriptHosts !== null,
    recall_webhook_hmac: fakeMode || isRecallWebhookSecretConfigured(env.RECALL_WEBHOOK_SECRET ?? ""),
    tavus_api_key: fakeMode || hasKey(env.TAVUS_API_KEY),
    openrouter_api_key: fakeMode || hasKey(env.OPENROUTER_API_KEY),
    openrouter_model_rate_card: fakeMode || hasReviewedOpenRouterModel(env),
    ai_usage_reconcile_secret: fakeMode || hasKey(env.AI_USAGE_RECONCILE_SECRET, 24),
    billing_usage_outbox_flag: billingUsageOutbox !== null && (fakeMode || billingUsageOutbox === true),
    billing_dispatch_secret: billingDisabled || hasKey(env.BILLING_DISPATCH_SECRET, 24),
    stripe_api_key: billingDisabled || hasKey(env.STRIPE_SECRET_KEY),
    stripe_webhook_secret: billingDisabled || hasStripeWebhookSecret(env.STRIPE_WEBHOOK_SECRET),
    stripe_meter_name: billingDisabled || hasStripeMeterName(env.STRIPE_CONVERSATION_OVERAGE_EVENT_NAME),
    stripe_price_catalog: billingDisabled || hasStripePriceCatalog(env),
    provider_effect_reconciler_flag: providerEffectReconciler !== null
      && (fakeMode || providerEffectReconciler === true),
    provider_effect_reconcile_secret: providerEffectReconcilerDisabled
      || hasKey(env.PROVIDER_EFFECT_RECONCILE_SECRET, 24),
  };
}

export function readinessRequiresProviderEffectReconciliation(env: NodeJS.ProcessEnv): boolean {
  return parseOptionalFeatureFlag(env.PROVIDER_EFFECT_RECONCILER_ENABLED) === true;
}

export function readinessRequiresWorkerHeartbeats(env: NodeJS.ProcessEnv): boolean {
  return (env.PORTAL_FAKE_PROVIDERS ?? "").trim() !== "1";
}

export function readinessConfigOk(checks: ReadinessChecks): boolean {
  return Object.values(checks).every(Boolean);
}
