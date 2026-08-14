import assert from "node:assert/strict";
import { test } from "node:test";

const plans = await import("../../apps/portal/src/lib/billing/plans.ts");

test("hasNonTerminalSubscription trata active/trialing/past_due/unpaid/paused/incomplete como assinatura viva", () => {
  for (const status of ["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]) {
    assert.equal(plans.hasNonTerminalSubscription(status), true, `esperava true para status=${status}`);
  }
});

test("hasNonTerminalSubscription trata canceled/incomplete_expired como terminal (checkout novo é seguro)", () => {
  for (const status of ["canceled", "incomplete_expired"]) {
    assert.equal(plans.hasNonTerminalSubscription(status), false, `esperava false para status=${status}`);
  }
});

test("hasNonTerminalSubscription trata null/undefined (sem assinatura) como terminal", () => {
  assert.equal(plans.hasNonTerminalSubscription(null), false);
  assert.equal(plans.hasNonTerminalSubscription(undefined), false);
});

test("BILLING_TERMINAL_STATUSES e ACTIVE_STATUSES não se sobrepõem (achado D-V2-107)", () => {
  for (const status of plans.ACTIVE_STATUSES) {
    assert.equal(plans.BILLING_TERMINAL_STATUSES.has(status), false, `${status} não pode estar nos dois conjuntos`);
  }
});

test("unpaid/paused/incomplete não estão em ACTIVE_STATUSES nem em BILLING_TERMINAL_STATUSES — precisam do branch needsAttention na UI", () => {
  for (const status of ["unpaid", "paused", "incomplete"]) {
    assert.equal(plans.ACTIVE_STATUSES.has(status), false);
    assert.equal(plans.BILLING_TERMINAL_STATUSES.has(status), false);
    assert.equal(plans.hasNonTerminalSubscription(status), true);
  }
});

test("cada plano preserva margem variável mínima de 55% por superfície e duração suportada", () => {
  for (const planId of plans.PLAN_ORDER) {
    const plan = plans.PLAN_CATALOG[planId];
    for (const surface of Object.keys(plans.MODELED_VARIABLE_COST_USD_PER_MINUTE)) {
      for (const duration of [1, 10, 15, plans.MAX_BILLABLE_CONVERSATION_MINUTES]) {
        const margin = plans.modeledVariableMargin(plan.overageUsdCentsPerConversation, surface, duration);
        assert.ok(
          margin >= plans.MINIMUM_OVERAGE_VARIABLE_MARGIN,
          `${planId}/${surface}/${duration}min ficou em ${(margin * 100).toFixed(2)}%`,
        );
      }
    }
  }
});

test("a reunião externa de 30min usa Tavus no topo + reserva Recall de 40min e preserva 55,33%", () => {
  for (const planId of plans.PLAN_ORDER) {
    const plan = plans.PLAN_CATALOG[planId];
    assert.equal(plan.overageUsdCentsPerConversation, 3_000);
    const margin = plans.modeledVariableMargin(plan.overageUsdCentsPerConversation, "external_meeting", 30);
    assert.equal(Number(margin.toFixed(4)), 0.5533);
  }
});

test("o modelo rejeita duração fora do teto documentado", () => {
  assert.throws(() => plans.modeledVariableMargin(3_000, "direct_video", 0), RangeError);
  assert.throws(() => plans.modeledVariableMargin(3_000, "external_meeting", 31), RangeError);
});
