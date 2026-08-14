import assert from "node:assert/strict";
import { test } from "node:test";

const origin = await import("../../apps/portal/src/lib/public-origin.ts");

test("public origin accepts only the exact reviewed HTTPS roots", () => {
  for (const [value, expected] of [
    ["https://closer.axtroai.com", "https://closer.axtroai.com"],
    ["https://closer.axtroai.com/", "https://closer.axtroai.com"],
    ["https://portal-production-b43e.up.railway.app", "https://portal-production-b43e.up.railway.app"],
  ]) {
    assert.equal(origin.parsePortalPublicOrigin(value), expected);
  }
});

test("public origin rejects hostile URL forms without parser normalization", () => {
  const hostile = [
    "",
    " https://closer.axtroai.com",
    "https://closer.axtroai.com ",
    "http://closer.axtroai.com",
    "https://user@closer.axtroai.com",
    "https://user:pass@closer.axtroai.com",
    "https://closer.axtroai.com:443",
    "https://closer.axtroai.com:8443",
    "https://closer.axtroai.com/path",
    "https://closer.axtroai.com//",
    "https://closer.axtroai.com?next=https://evil.example",
    "https://closer.axtroai.com#fragment",
    "https://closer.axtroai.com.evil.example",
    "https://closer.axtroai.com@evil.example",
    "https://closer.axtroai.com./",
    "https://CLOSER.AXTROAI.COM",
    "https://127.0.0.1",
    "https://[::1]",
    "javascript:alert(1)",
  ];
  for (const value of hostile) {
    assert.throws(() => origin.parsePortalPublicOrigin(value), /exact approved HTTPS origin/, value);
  }
});

test("real mode requires PORTAL_PUBLIC_URL while fake mode uses one deterministic origin", () => {
  assert.throws(
    () => origin.portalPublicOrigin({ NEXT_PUBLIC_SITE_URL: "https://closer.axtroai.com" }),
    /exact approved HTTPS origin/,
  );
  assert.equal(origin.isPortalPublicOriginConfigured({}), false);
  assert.equal(origin.isPortalPublicOriginConfigured({ PORTAL_PUBLIC_URL: "https://evil.example" }), false);

  const fake = {
    PORTAL_FAKE_PROVIDERS: "1",
    PORTAL_PUBLIC_URL: "http://attacker.invalid:8080/path?query=1#fragment",
  };
  assert.equal(origin.portalPublicOrigin(fake), origin.DETERMINISTIC_FAKE_PUBLIC_ORIGIN);
  assert.equal(origin.isPortalPublicOriginConfigured(fake), true);
});
