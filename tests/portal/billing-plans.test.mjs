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
