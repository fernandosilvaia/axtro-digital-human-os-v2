import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../../apps/portal/src/lib/actions/billing.ts", import.meta.url), "utf8");

test("startCheckout delegates the paid effect to the durable service-role coordinator", () => {
  assert.match(source, /createDurableCheckout\(/);
  assert.match(source, /createServiceRoleClient\(\)/);
  assert.match(source, /tenantId:\s*overview\.tenant\.id/);
  assert.match(source, /userId:\s*user\.id/);
  assert.doesNotMatch(source, /Math\.floor\(Date\.now\(\)\s*\/\s*60_000\)/);
});

test("checkout action uses the reviewed public origin and never forwards customer email", () => {
  assert.match(source, /portalPublicOrigin\(\)/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_SITE_URL/);
  assert.doesNotMatch(source, /customerEmail/);
  assert.doesNotMatch(source, /user\.email/);
});

test("checkout action preserves explicit pending/conflict redirects", () => {
  assert.match(source, /checkout_conflito/);
  assert.match(source, /checkout_pendente/);
});

test("checkout action authenticates and scopes abuse control before provider configuration", () => {
  const getUser = source.indexOf("supabase.auth.getUser()");
  const roleCheck = source.indexOf('overview.role !== "tenant_admin"');
  const limiter = source.indexOf("billing-checkout:${overview.tenant.id}");
  const providerConfig = source.indexOf("process.env.STRIPE_SECRET_KEY");
  assert.ok(getUser >= 0 && roleCheck > getUser && limiter > roleCheck && providerConfig > limiter);
});
