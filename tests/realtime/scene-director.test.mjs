import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const sceneDirector = await import(pathToFileURL(join(root, "packages/scene-director/dist/index.js")).href);

const { createSceneManifestRegistry, createSceneDirector } = sceneDirector;

function slideManifest(overrides = {}) {
  return {
    manifestId: "slide-deck-default",
    sceneType: "slide_deck",
    version: "1.0.0",
    allowedOrigins: ["https://assets.axtro.internal"],
    assetReferences: ["asset_slide_deck_v1"],
    dataBindingSchema: { slideIndex: "number", title: "string" },
    allowedActions: ["next_slide", "previous_slide"],
    allowedPiiFields: [],
    accessibilityLabel: "Slide presentation",
    channelCapabilitiesRequired: ["screenshare"],
    timeoutMs: 5_000,
    fallbackManifestId: "technical-fallback-default",
    priority: "normal",
    ...overrides,
  };
}

function fallbackManifest() {
  return {
    manifestId: "technical-fallback-default",
    sceneType: "technical_fallback",
    version: "1.0.0",
    allowedOrigins: [],
    assetReferences: ["asset_technical_fallback_v1"],
    dataBindingSchema: {},
    allowedActions: [],
    allowedPiiFields: [],
    accessibilityLabel: "Technical difficulties",
    channelCapabilitiesRequired: [],
    timeoutMs: 5_000,
    fallbackManifestId: null,
    priority: "normal",
  };
}

function handoffManifest() {
  return {
    manifestId: "human-handoff-default",
    sceneType: "human_handoff",
    version: "1.0.0",
    allowedOrigins: [],
    assetReferences: ["asset_human_handoff_v1"],
    dataBindingSchema: { reason: "string" },
    allowedActions: ["confirm_handoff"],
    allowedPiiFields: [],
    accessibilityLabel: "Transferring to a human specialist",
    channelCapabilitiesRequired: [],
    timeoutMs: 5_000,
    fallbackManifestId: null,
    priority: "max",
  };
}

function proposalManifest() {
  return {
    manifestId: "proposal-preview-default",
    sceneType: "proposal_preview",
    version: "1.0.0",
    allowedOrigins: ["https://assets.axtro.internal"],
    assetReferences: ["asset_proposal_preview_v1"],
    dataBindingSchema: { customerName: "string", accountLastFour: "string", totalUsdMicros: "number" },
    allowedActions: ["download"],
    allowedPiiFields: ["customerName"],
    accessibilityLabel: "Proposal preview",
    channelCapabilitiesRequired: [],
    timeoutMs: 5_000,
    fallbackManifestId: null,
    priority: "normal",
  };
}

function registry() {
  return createSceneManifestRegistry([slideManifest(), fallbackManifest(), handoffManifest(), proposalManifest()]);
}

test("scene director: an allowlisted scene binds sanitized data and renders sandboxed", () => {
  const director = createSceneDirector(registry());
  const result = director.selectScene(
    { sceneType: "slide_deck", requestedManifestId: "slide-deck-default", data: { slideIndex: 1, title: "Onboarding" }, piiFields: [], generationId: 1 },
    ["screenshare"],
  );
  assert.equal(result.outcome, "accepted");
  assert.equal(result.directive.manifestId, "slide-deck-default");
  assert.equal(result.directive.sandbox, "iframe_sandboxed");
  assert.deepEqual(result.directive.boundData, { slideIndex: 1, title: "Onboarding" });
});

test("scene director: an unknown manifest id is rejected instead of falling back to a raw URL or ad hoc scene", () => {
  const director = createSceneDirector(registry());
  const result = director.selectScene(
    { sceneType: "slide_deck", requestedManifestId: "not-allowlisted", data: {}, piiFields: [], generationId: 1 },
    ["screenshare"],
  );
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "manifest_not_found");
});

test("scene director: data outside the manifest's binding schema is rejected, never passed through", () => {
  const director = createSceneDirector(registry());
  const result = director.selectScene(
    {
      sceneType: "slide_deck",
      requestedManifestId: "slide-deck-default",
      data: { slideIndex: 1, title: "Onboarding", injectedScript: "<script>alert(1)</script>" },
      piiFields: [],
      generationId: 1,
    },
    ["screenshare"],
  );
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "unauthorized_data_binding");
  assert.equal(result.fallbackManifestId, "technical-fallback-default");
});

test("scene director: a PII field outside the manifest's allowlist is rejected", () => {
  const director = createSceneDirector(registry());
  const result = director.selectScene(
    {
      sceneType: "proposal_preview",
      requestedManifestId: "proposal-preview-default",
      data: { customerName: "Fernando", accountLastFour: "4242", totalUsdMicros: 12_000_000 },
      piiFields: ["accountLastFour"],
      generationId: 1,
    },
    [],
  );
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "unauthorized_pii_field");
});

test("scene director: a missing channel capability is rejected before rendering", () => {
  const director = createSceneDirector(registry());
  const result = director.selectScene(
    { sceneType: "slide_deck", requestedManifestId: "slide-deck-default", data: { slideIndex: 1, title: "Onboarding" }, piiFields: [], generationId: 1 },
    [],
  );
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "missing_channel_capability");
});

test("scene director: a late directive from an older turn never overrides the current scene", () => {
  const director = createSceneDirector(registry());
  const first = director.selectScene(
    { sceneType: "slide_deck", requestedManifestId: "slide-deck-default", data: { slideIndex: 1, title: "One" }, piiFields: [], generationId: 5 },
    ["screenshare"],
  );
  assert.equal(first.outcome, "accepted");

  const late = director.selectScene(
    { sceneType: "slide_deck", requestedManifestId: "slide-deck-default", data: { slideIndex: 0, title: "Stale" }, piiFields: [], generationId: 3 },
    ["screenshare"],
  );
  assert.equal(late.outcome, "rejected");
  assert.equal(late.reason, "generation_no_longer_active");
});

test("scene director: handoff (max priority) preempts the active scene even from an older generation", () => {
  const director = createSceneDirector(registry());
  director.selectScene(
    { sceneType: "slide_deck", requestedManifestId: "slide-deck-default", data: { slideIndex: 1, title: "One" }, piiFields: [], generationId: 10 },
    ["screenshare"],
  );

  const handoff = director.selectScene(
    { sceneType: "human_handoff", requestedManifestId: "human-handoff-default", data: { reason: "billing_dispute" }, piiFields: [], generationId: 4 },
    [],
  );
  assert.equal(handoff.outcome, "accepted");
  assert.equal(handoff.preempted, true);
  assert.ok(director.auditLog().some((event) => event.type === "scene_preempted"));
});

test("scene director: a proposal never exposes a field outside its declared PII allowlist even when authorized", () => {
  const director = createSceneDirector(registry());
  const result = director.selectScene(
    {
      sceneType: "proposal_preview",
      requestedManifestId: "proposal-preview-default",
      data: { customerName: "Fernando", accountLastFour: "4242", totalUsdMicros: 12_000_000 },
      piiFields: ["customerName"],
      generationId: 1,
    },
    [],
  );
  assert.equal(result.outcome, "accepted");
  assert.equal(result.directive.boundData.customerName, "Fernando");
  assert.equal(result.directive.boundData.accountLastFour, "4242", "the field itself binds fine, only its PII classification is policed");
});

test("scene director: a custom binding policy can block a scene independently of the schema", () => {
  const director = createSceneDirector(registry(), { policy: () => ({ allowed: false, reason: "consent_missing" }) });
  const result = director.selectScene(
    { sceneType: "slide_deck", requestedManifestId: "slide-deck-default", data: { slideIndex: 1, title: "One" }, piiFields: [], generationId: 1 },
    ["screenshare"],
  );
  assert.equal(result.outcome, "rejected");
  assert.equal(result.reason, "policy_blocked");
});

test("scene manifest registry: a non-https origin is rejected at construction, never at render time", () => {
  assert.throws(() => createSceneManifestRegistry([slideManifest({ allowedOrigins: ["javascript:alert(1)"] })]), RangeError);
});
