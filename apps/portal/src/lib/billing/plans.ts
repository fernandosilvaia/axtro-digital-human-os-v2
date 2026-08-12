/**
 * Catálogo de planos do Digital Human OS (D-V2-101) — mesma disciplina do
 * rate card de custo (database/supabase-only/0017_rate_card.sql): preço
 * como código, versionado, datado, nunca escondido numa tabela editável em
 * runtime. Números e racional completos em docs/PRICING_UNIT_ECONOMICS.md
 * (2026-08-03) — custo real medido de ~US$4,55/conversa de 12min (Tavus
 * 92% + ElevenLabs 4,5% + OpenRouter 3,4%), margem-alvo 90%+ no incluído e
 * nunca abaixo de ~55% no overage, mesmo no pior caso.
 *
 * Unidade cobrada é CONVERSA de vídeo, não minuto: o produto não mede
 * duração real de chamada hoje — cobrar por minuto prometeria uma precisão
 * que o sistema não entrega (Art. 16). Os `Price` da Stripe (um "licensed"
 * fixo + um "metered" de overage) são criados fora deste repo (dashboard ou
 * `scripts/stripe_setup.mjs`) — os ids ficam em env vars, nunca hardcoded
 * (contas de teste e produção têm ids diferentes).
 */

export type PlanId = "piloto" | "crescimento" | "escala";

export interface PlanDefinition {
  readonly id: PlanId;
  readonly name: string;
  readonly priceUsdCents: number;
  readonly includedConversationsPerMonth: number;
  readonly overageUsdCentsPerConversation: number;
  /** Nome da env var que carrega o Price id (licensed, fixo mensal) desse plano. */
  readonly basePriceEnvVar: string;
  /** Nome da env var que carrega o Price id (metered, overage) desse plano. */
  readonly overagePriceEnvVar: string;
}

export const PLAN_CATALOG: Readonly<Record<PlanId, PlanDefinition>> = Object.freeze({
  piloto: Object.freeze({
    id: "piloto",
    name: "Piloto",
    priceUsdCents: 49_700,
    includedConversationsPerMonth: 7,
    overageUsdCentsPerConversation: 1_400,
    basePriceEnvVar: "STRIPE_PRICE_PILOTO_BASE",
    overagePriceEnvVar: "STRIPE_PRICE_PILOTO_OVERAGE",
  }),
  crescimento: Object.freeze({
    id: "crescimento",
    name: "Crescimento",
    priceUsdCents: 149_700,
    includedConversationsPerMonth: 30,
    overageUsdCentsPerConversation: 1_200,
    basePriceEnvVar: "STRIPE_PRICE_CRESCIMENTO_BASE",
    overagePriceEnvVar: "STRIPE_PRICE_CRESCIMENTO_OVERAGE",
  }),
  escala: Object.freeze({
    id: "escala",
    name: "Escala",
    priceUsdCents: 399_700,
    includedConversationsPerMonth: 85,
    overageUsdCentsPerConversation: 1_000,
    basePriceEnvVar: "STRIPE_PRICE_ESCALA_BASE",
    overagePriceEnvVar: "STRIPE_PRICE_ESCALA_OVERAGE",
  }),
});

export const PLAN_ORDER: readonly PlanId[] = Object.freeze(["piloto", "crescimento", "escala"]);

export function isPlanId(value: unknown): value is PlanId {
  return value === "piloto" || value === "crescimento" || value === "escala";
}

export function formatUsdCents(cents: number): string {
  return `US$${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * event_name do Meter compartilhado na Stripe (docs.stripe.com/api/billing/
 * meter) — UM meter pro produto inteiro; cada plano tem seu próprio Price
 * "metered" com valor/unidade diferente, todos apontando pro mesmo meter.
 * Configurável porque o nome é decidido na hora de criar o Meter na Stripe
 * (scripts/stripe_setup.mjs) — precisa bater exatamente dos dois lados.
 */
export function conversationOverageEventName(): string {
  return (process.env.STRIPE_CONVERSATION_OVERAGE_EVENT_NAME ?? "axtro_conversation_overage").trim();
}

/**
 * Teto mensal de conversas pra contas SEM assinatura (trial). ATIVO por
 * padrão desde D-V2-112 (2026-08-12) — a auditoria adversarial da onda 4
 * confirmou (3/3 verificadores) que, desligado, uma conta fake self-serve
 * sem cartão nunca tinha teto mensal: só o teto diário (DAILY_VIDEO_
 * CONVERSATION_CAP=20/dia) segurava o gasto, e cada conta nova multiplicava
 * esse teto por N. Nasceu desligado em D-V2-101 (2026-08-03) por cautela —
 * "não mudar comportamento sem decisão explícita" — mas o próprio achado é
 * essa decisão: fechar o buraco de custo é mais seguro que preservar
 * ilimitado por padrão. Reversível a qualquer momento com
 * BILLING_TRIAL_LIMIT_ENABLED=false no Railway, se o Fernando preferir.
 */
export const TRIAL_INCLUDED_CONVERSATIONS_PER_MONTH = 5;

export function isTrialLimitEnabled(): boolean {
  return (process.env.BILLING_TRIAL_LIMIT_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

/**
 * Status finais da assinatura Stripe — o cliente Stripe pode ser reaproveitado
 * e um checkout NOVO é seguro (achado D-V2-107: `startCheckout` e a UI de
 * /configuracoes usavam definições diferentes de "assinante ativo", travando
 * contas com status `unpaid`/`incomplete_expired`/`paused` sem conseguir nem
 * assinar de novo nem gerenciar — nenhum botão "gerenciar" aparecia porque a
 * UI só o mostra quando `ACTIVE_STATUSES` bate, e `startCheckout` recusava
 * qualquer status != 'canceled'). `incomplete_expired` (janela de confirmação
 * de pagamento/3DS expirada) é tão terminal quanto `canceled` — a assinatura
 * nunca chegou a ativar.
 */
export const BILLING_TERMINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);

/** Status onde a assinatura está viva mas precisa de atenção via Customer Portal (não é "ativa" pro propósito de mostrar uso, mas também não é segura pra checkout novo). */
export const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Existe uma assinatura Stripe não-terminal — checkout novo criaria uma segunda cobrando em paralelo; o caminho correto é o Customer Portal. */
export function hasNonTerminalSubscription(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && !BILLING_TERMINAL_STATUSES.has(status);
}
