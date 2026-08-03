// Provisiona o catálogo de cobrança na Stripe (D-V2-101): 1 Meter
// compartilhado (overage de conversas) + 3 Products, cada um com 2 Prices
// (licensed fixo mensal + metered vinculado ao meter). Idempotente — roda
// quantas vezes quiser, sempre pelo mesmo lookup_key; nunca duplica.
//
// Uso:
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe_setup.mjs
//
// Ao final, imprime o bloco de env vars pra colar no Doppler/Railway
// (nomes batem com PLAN_CATALOG em apps/portal/src/lib/billing/plans.ts).
import process from "node:process";

const apiKey = (process.env.STRIPE_SECRET_KEY ?? "").trim();
if (apiKey.length === 0) {
  console.error("STRIPE_SECRET_KEY não configurada. Uso: STRIPE_SECRET_KEY=sk_test_... node scripts/stripe_setup.mjs");
  process.exit(1);
}
// sk_live_ é a chave secreta padrão de produção; rk_live_ é uma chave
// RESTRITA (escopo customizável no dashboard) mas igualmente válida em
// produção pros endpoints que este script chama (products/prices/meters) —
// bloquear só sk_live_ deixava rk_live_ passar batido (achado da revisão
// adversarial 2026-08-03).
if (apiKey.startsWith("sk_live_") || apiKey.startsWith("rk_live_")) {
  console.error("Recusado: esta chave é de PRODUÇÃO (sk_live_/rk_live_). Rode primeiro em modo teste (sk_test_/rk_test_) — chave real de produção exige autorização explícita do Fernando (gate humano, ver CLAUDE.md da raiz AxtroAI).");
  process.exit(1);
}

const plansModule = await import(new URL("../apps/portal/src/lib/billing/plans.ts", import.meta.url));
const { PLAN_CATALOG, PLAN_ORDER, conversationOverageEventName } = plansModule;
const EVENT_NAME = conversationOverageEventName();
const STRIPE_API_VERSION = "2025-03-31.basil";

function toFormBody(input) {
  const pairs = [];
  function walk(prefix, value) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(`${prefix}[${index}]`, item));
      return;
    }
    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        walk(prefix.length === 0 ? key : `${prefix}[${key}]`, nested);
      }
      return;
    }
    pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  }
  walk("", input);
  return pairs.join("&");
}

async function stripe(method, path, body) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
    },
    ...(body ? { body: toFormBody(body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Stripe ${method} ${path} -> HTTP ${response.status}: ${payload?.error?.message ?? JSON.stringify(payload)}`);
  }
  return payload;
}

async function ensureMeter() {
  const existing = await stripe("GET", "/billing/meters?limit=100");
  const found = existing.data.find((meter) => meter.event_name === EVENT_NAME);
  if (found) {
    console.log(`✓ Meter já existe: ${found.id} (event_name=${EVENT_NAME})`);
    return found.id;
  }
  const created = await stripe("POST", "/billing/meters", {
    display_name: "Overage de conversas de vídeo (Digital Human OS)",
    event_name: EVENT_NAME,
    default_aggregation: { formula: "sum" },
    customer_mapping: { event_payload_key: "stripe_customer_id", type: "by_id" },
    value_settings: { event_payload_key: "value" },
  });
  console.log(`+ Meter criado: ${created.id} (event_name=${EVENT_NAME})`);
  return created.id;
}

async function ensureProduct(planId, planName) {
  const lookupKey = `axtro_dho_${planId}`;
  const existing = await stripe("GET", `/products?limit=100`);
  const found = existing.data.find((product) => product.metadata?.axtro_plan_id === planId);
  if (found) {
    console.log(`✓ Product já existe: ${found.id} (${planName})`);
    return found.id;
  }
  const created = await stripe("POST", "/products", {
    name: `Digital Human OS — ${planName}`,
    metadata: { axtro_plan_id: planId },
  });
  console.log(`+ Product criado: ${created.id} (${planName})`);
  void lookupKey;
  return created.id;
}

async function ensurePrice({ productId, lookupKey, unitAmountCents, recurring }) {
  const existing = await stripe("GET", `/prices?lookup_keys[0]=${encodeURIComponent(lookupKey)}`);
  const found = existing.data[0];
  if (found) {
    console.log(`  ✓ Price já existe: ${found.id} (${lookupKey})`);
    return found.id;
  }
  const created = await stripe("POST", "/prices", {
    product: productId,
    currency: "usd",
    unit_amount: unitAmountCents,
    lookup_key: lookupKey,
    recurring,
  });
  console.log(`  + Price criado: ${created.id} (${lookupKey})`);
  return created.id;
}

console.log(`Provisionando catálogo de cobrança (${apiKey.startsWith("sk_test_") ? "TESTE" : "desconhecido"})...\n`);

const meterId = await ensureMeter();
console.log("");

const envLines = [`STRIPE_CONVERSATION_OVERAGE_EVENT_NAME=${EVENT_NAME}`];

for (const planId of PLAN_ORDER) {
  const plan = PLAN_CATALOG[planId];
  console.log(`Plano ${plan.name} (${planId}):`);
  const productId = await ensureProduct(planId, plan.name);

  const basePriceId = await ensurePrice({
    productId,
    lookupKey: `axtro_dho_${planId}_base`,
    unitAmountCents: plan.priceUsdCents,
    recurring: { interval: "month", usage_type: "licensed" },
  });

  const overagePriceId = await ensurePrice({
    productId,
    lookupKey: `axtro_dho_${planId}_overage`,
    unitAmountCents: plan.overageUsdCentsPerConversation,
    recurring: { interval: "month", usage_type: "metered", meter: meterId },
  });

  envLines.push(`${plan.basePriceEnvVar}=${basePriceId}`);
  envLines.push(`${plan.overagePriceEnvVar}=${overagePriceId}`);
  console.log("");
}

console.log("Configure também no Customer Portal (dashboard.stripe.com/test/settings/billing/portal):");
console.log("  - Products: permitir os 3 produtos acima em \"Customers can switch plans\" (assim upgrade/downgrade funciona sem código extra).");
console.log("  - Cancellation: habilitar cancelamento self-service.\n");

console.log("Cole no Doppler/Railway (env do portal):\n");
console.log(envLines.join("\n"));
console.log("\nFalta ainda: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (endpoint /api/stripe/webhook, eventos");
console.log("customer.subscription.created/updated/deleted).");
