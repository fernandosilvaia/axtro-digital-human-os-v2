import assert from "node:assert/strict";
import test from "node:test";

const {
  isPortalTextPreviewEnabled,
  isPortalTextPreviewReleaseClosed,
  parsePortalTextPreviewReleaseGate,
  portalTextPreviewReleaseGate,
} = await import("../../apps/portal/src/lib/agent-preview/release-gate.ts");

test("only exact false is a valid explicitly closed M6-02 configuration", () => {
  assert.deepEqual(parsePortalTextPreviewReleaseGate("false"), {
    enabled: false,
    explicitlyConfigured: true,
    valid: true,
  });
  assert.equal(isPortalTextPreviewReleaseClosed({ PORTAL_TEXT_PREVIEW_ENABLED: "false" }), true);
  assert.equal(isPortalTextPreviewEnabled({ PORTAL_TEXT_PREVIEW_ENABLED: "false" }), false);
});

test("true is invalid and cannot enable the preview", () => {
  assert.deepEqual(parsePortalTextPreviewReleaseGate("true"), {
    enabled: false,
    explicitlyConfigured: true,
    valid: false,
  });
  assert.deepEqual(portalTextPreviewReleaseGate({ PORTAL_TEXT_PREVIEW_ENABLED: "true" }), {
    enabled: false,
    explicitlyConfigured: true,
    valid: false,
  });
  assert.equal(isPortalTextPreviewEnabled({ PORTAL_TEXT_PREVIEW_ENABLED: "true" }), false);
  assert.equal(isPortalTextPreviewReleaseClosed({ PORTAL_TEXT_PREVIEW_ENABLED: "true" }), false);
});

test("missing and non-exact values all fail closed without becoming valid", () => {
  assert.deepEqual(parsePortalTextPreviewReleaseGate(undefined), {
    enabled: false,
    explicitlyConfigured: false,
    valid: false,
  });
  for (const value of ["", " false", "false ", "FALSE", "0", "1", "yes", "true\n"]) {
    const gate = parsePortalTextPreviewReleaseGate(value);
    assert.deepEqual(gate, {
      enabled: false,
      explicitlyConfigured: true,
      valid: false,
    });
    assert.equal(isPortalTextPreviewEnabled({ PORTAL_TEXT_PREVIEW_ENABLED: value }), false);
    assert.equal(isPortalTextPreviewReleaseClosed({ PORTAL_TEXT_PREVIEW_ENABLED: value }), false);
  }
});

test("release gate results are immutable", () => {
  assert.equal(Object.isFrozen(parsePortalTextPreviewReleaseGate("false")), true);
  assert.equal(Object.isFrozen(parsePortalTextPreviewReleaseGate("true")), true);
  assert.equal(Object.isFrozen(parsePortalTextPreviewReleaseGate(undefined)), true);
});
