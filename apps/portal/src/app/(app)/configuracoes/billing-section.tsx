import { openBillingPortal, startCheckout } from "@/lib/actions/billing";
import { ACTIVE_STATUSES, formatUsdCents, hasNonTerminalSubscription, isPlanId, PLAN_CATALOG, PLAN_ORDER, type PlanId } from "@/lib/billing/plans";
import type { BillingStatus } from "@/lib/portal-data";
import { SubmitOnceButton } from "./submit-once-button";

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  trialing: "Em teste",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
  unpaid: "Pagamento recusado",
  incomplete: "Incompleta",
  incomplete_expired: "Expirada",
  paused: "Pausada",
};

const ERROR_MESSAGE: Record<string, string> = {
  plano_invalido: "Plano inválido — escolha um dos planos listados.",
  apenas_admin: "Só um administrador da conta pode assinar ou gerenciar o plano.",
  nao_configurado: "A cobrança ainda não está configurada neste ambiente. Fale com o suporte.",
  conta_nao_provisionada: "Sua conta ainda não terminou de ser provisionada — recarregue em instantes.",
  ja_assinante: "Sua conta já tem uma assinatura ativa — gerencie o plano pelo botão abaixo.",
  cancelado: "Assinatura não concluída — você pode tentar de novo quando quiser.",
  falha_ao_criar_checkout: "Não foi possível abrir o checkout agora. Tente novamente em instantes.",
  checkout_pendente: "Sua solicitação de checkout está sendo conciliada com a Stripe. Aguarde alguns instantes antes de tentar novamente.",
  checkout_conflito: "Já existe outra solicitação de checkout em andamento para esta conta. Conclua ou cancele a tentativa anterior antes de iniciar outra.",
  sem_assinatura: "Sua conta ainda não tem uma assinatura para gerenciar.",
  falha_ao_ler_status: "Não foi possível ler o status da assinatura agora. Tente novamente.",
  falha_ao_abrir_portal: "Não foi possível abrir o gerenciamento de assinatura agora. Tente novamente.",
};

export function BillingSection({
  billing,
  isAdmin,
  billingSuccess,
  billingError,
}: {
  /** null = leitura de cobrança indisponível agora (o resto da página segue funcionando). */
  readonly billing: BillingStatus | null;
  readonly isAdmin: boolean;
  readonly billingSuccess: boolean;
  readonly billingError: string | null;
}) {
  if (billing === null) {
    return (
      <section className="card" aria-labelledby="plano-conta">
        <h2 id="plano-conta" className="section-title">Plano e cobrança</h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: 0 }}>
          As informações de plano estão indisponíveis neste momento. Recarregue a página em instantes —
          o restante das configurações continua funcionando normalmente.
        </p>
      </section>
    );
  }

  const hasActivePlan = isPlanId(billing.plan_id) && billing.status !== null && ACTIVE_STATUSES.has(billing.status);
  // Assinatura viva mas fora de ACTIVE_STATUSES (unpaid/paused/incomplete) —
  // precisa de atenção via Customer Portal, não é "sem plano" nem "ativa"
  // (achado D-V2-107: sem este branch, essas contas caíam em NoPlanCards,
  // que só oferece "Assinar" — e startCheckout bloqueava isso como
  // "já assinante" sem nenhum botão de gerenciar na tela pra resolver).
  const needsAttention = !hasActivePlan && typeof billing.stripe_customer_id === "string" && hasNonTerminalSubscription(billing.status);

  return (
    <section className="card" aria-labelledby="plano-conta">
      <h2 id="plano-conta" className="section-title">Plano e cobrança</h2>

      {billingSuccess && (
        <p className="saved-flag" role="status" style={{ marginBottom: 14 }}>
          ✓ Assinatura confirmada — pode levar alguns segundos para aparecer aqui.
        </p>
      )}
      {billingError && (
        <p className="form-error" role="alert" style={{ marginBottom: 14 }}>
          {ERROR_MESSAGE[billingError] ?? "Não foi possível concluir a operação de cobrança."}
        </p>
      )}

      {hasActivePlan && billing.plan_id !== null ? (
        <CurrentPlanCard billing={billing} planId={billing.plan_id} isAdmin={isAdmin} />
      ) : needsAttention ? (
        <NeedsAttentionCard billing={billing} isAdmin={isAdmin} />
      ) : (
        <NoPlanCards isAdmin={isAdmin} />
      )}

      <p style={{ marginTop: 16, fontSize: "0.8rem", color: "var(--text-faint)" }}>
        Precisa de um volume diferente ou contrato anual?{" "}
        <a href="mailto:fernando@axtroai.com?subject=Plano%20sob%20medida" style={{ color: "var(--accent)" }}>
          Fale com o time
        </a>
        {" · "}
        <a href="/precos" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>
          Ver todos os planos
        </a>
      </p>
    </section>
  );
}

function CurrentPlanCard({ billing, planId, isAdmin }: { billing: BillingStatus; planId: PlanId; isAdmin: boolean }) {
  const plan = PLAN_CATALOG[planId];
  const used = billing.conversations_this_period;
  const included = plan.includedConversationsPerMonth;
  const overUsed = used > included;
  const pct = Math.min(100, Math.round((used / included) * 100));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <strong style={{ fontSize: "1.05rem" }}>{plan.name}</strong>
        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
          {formatUsdCents(plan.priceUsdCents)}/mês · {billing.status ? STATUS_LABEL[billing.status] ?? billing.status : ""}
        </span>
      </div>

      <div style={{ margin: "10px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: 4 }}>
          <span>Conversas de vídeo neste período</span>
          <span className="mono">{used} / {included}{overUsed ? ` (+${used - included} overage)` : ""}</span>
        </div>
        <div style={{ height: 6, borderRadius: 100, background: "var(--border)", overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: overUsed ? "var(--accent)" : "var(--accent)", borderRadius: 100 }} />
        </div>
        {overUsed && (
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 6 }}>
            Passou do incluído — o excedente é cobrado a {formatUsdCents(plan.overageUsdCentsPerConversation)}/conversa na próxima fatura. Suas conversas continuam funcionando normalmente.
          </p>
        )}
      </div>

      {isAdmin && (
        <form action={openBillingPortal} style={{ marginTop: 12 }}>
          <button type="submit" className="btn btn-ghost" style={{ padding: "9px 16px" }}>
            Gerenciar assinatura (forma de pagamento, faturas, trocar plano ou cancelar)
          </button>
        </form>
      )}
    </div>
  );
}

const NEEDS_ATTENTION_MESSAGE: Record<string, string> = {
  unpaid: "A cobrança da sua assinatura falhou e as tentativas automáticas da Stripe se esgotaram. Atualize a forma de pagamento para reativar.",
  paused: "Sua assinatura está pausada. Gerencie pelo Customer Portal para retomar quando quiser.",
  incomplete: "A confirmação do pagamento da sua assinatura ainda não foi concluída. Finalize pelo Customer Portal ou tente novamente.",
};

/** Assinatura viva mas fora de ACTIVE_STATUSES (unpaid/paused/incomplete) — D-V2-107. */
function NeedsAttentionCard({ billing, isAdmin }: { billing: BillingStatus; isAdmin: boolean }) {
  const message = billing.status !== null ? NEEDS_ATTENTION_MESSAGE[billing.status] : undefined;
  return (
    <div>
      <p style={{ color: "var(--text-muted)", fontSize: "0.86rem", margin: "0 0 14px" }}>
        {message ?? "Sua assinatura precisa de atenção — gerencie pelo Customer Portal."}
        {billing.status ? ` (status: ${STATUS_LABEL[billing.status] ?? billing.status})` : ""}
      </p>
      {isAdmin ? (
        <form action={openBillingPortal}>
          <button type="submit" className="btn btn-primary" style={{ padding: "9px 16px" }}>
            Gerenciar assinatura
          </button>
        </form>
      ) : (
        <span style={{ fontSize: "0.76rem", color: "var(--text-faint)" }}>Só um administrador pode gerenciar a assinatura</span>
      )}
    </div>
  );
}

function NoPlanCards({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div>
      <p style={{ color: "var(--text-muted)", fontSize: "0.86rem", margin: "0 0 14px" }}>
        Sua conta ainda está no modo de avaliação — agentes, fontes e conversas funcionam dentro
        dos limites de proteção padrão. Assine um plano para liberar mais volume e aparecer no
        painel de cobrança.
      </p>
      <div className="grid grid-3" style={{ gap: 12 }}>
        {PLAN_ORDER.map((id) => {
          const plan = PLAN_CATALOG[id];
          return (
            <div key={id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <strong style={{ fontSize: "0.92rem" }}>{plan.name}</strong>
              <span className="mono" style={{ fontSize: "1.1rem" }}>{formatUsdCents(plan.priceUsdCents)}<span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "inherit" }}>/mês</span></span>
              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{plan.includedConversationsPerMonth} conversas incluídas</span>
              {isAdmin ? (
                <form action={startCheckout} style={{ marginTop: "auto" }}>
                  <input type="hidden" name="plan_id" value={plan.id} />
                  <SubmitOnceButton className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "8px 12px", fontSize: "0.84rem" }}>
                    Assinar
                  </SubmitOnceButton>
                </form>
              ) : (
                <span style={{ fontSize: "0.76rem", color: "var(--text-faint)" }}>Só um administrador pode assinar</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
