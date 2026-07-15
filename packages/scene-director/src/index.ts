/**
 * M2-07: controls what appears on screen as allowlisted, receipt-audited
 * scenes only, per docs/architecture/SCENE_PRESENTATION_DIRECTOR.md. The
 * dialogue layer requests a `SceneIntent` (scene type + a manifest id it
 * already knows about + data to bind); it never supplies a URL or script.
 * Flow: SceneIntent -> select manifest -> bind sanitized data -> policy
 * check -> render -> scene_directive -> channel output -> audit event.
 */
export const SCENE_TYPES = [
  "avatar_full",
  "avatar_pip",
  "slide_deck",
  "pdf_page",
  "approved_web_demo_sandbox",
  "calculator_result",
  "plan_comparison",
  "proposal_preview",
  "human_handoff",
  "technical_fallback",
] as const;
export type SceneType = (typeof SCENE_TYPES)[number];

export type SceneBindingFieldType = "string" | "number" | "boolean";
export type ScenePriority = "normal" | "max";

export interface SceneManifest {
  readonly manifestId: string;
  readonly sceneType: SceneType;
  readonly version: string;
  readonly allowedOrigins: readonly string[];
  readonly assetReferences: readonly string[];
  readonly dataBindingSchema: Readonly<Record<string, SceneBindingFieldType>>;
  readonly allowedActions: readonly string[];
  readonly allowedPiiFields: readonly string[];
  readonly accessibilityLabel: string;
  readonly channelCapabilitiesRequired: readonly string[];
  readonly timeoutMs: number;
  readonly fallbackManifestId: string | null;
  readonly priority: ScenePriority;
}

export interface SceneIntent {
  readonly sceneType: SceneType;
  readonly requestedManifestId: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly piiFields: readonly string[];
  readonly generationId: number;
}

export interface SceneDirective {
  readonly manifestId: string;
  readonly sceneType: SceneType;
  readonly boundData: Readonly<Record<string, unknown>>;
  readonly allowedActions: readonly string[];
  readonly accessibilityLabel: string;
  readonly sandbox: "iframe_sandboxed";
  readonly generationId: number;
  readonly issuedAtMs: number;
}

export type SceneRejectionReason =
  | "manifest_not_found"
  | "scene_type_mismatch"
  | "unauthorized_data_binding"
  | "invalid_data_type"
  | "unauthorized_pii_field"
  | "missing_channel_capability"
  | "policy_blocked"
  | "generation_no_longer_active";

export interface SceneSelectionRejected {
  readonly outcome: "rejected";
  readonly reason: SceneRejectionReason;
  readonly fallbackManifestId: string | null;
}

export interface SceneSelectionAccepted {
  readonly outcome: "accepted";
  readonly directive: SceneDirective;
  readonly preempted: boolean;
}

export type SceneSelectionResult = SceneSelectionAccepted | SceneSelectionRejected;

export type SceneAuditEventType = "scene_selected" | "scene_rejected" | "scene_preempted";

export interface SceneAuditEvent {
  readonly type: SceneAuditEventType;
  readonly sequence: number;
  readonly atMs: number;
  readonly manifestId: string | null;
  readonly reason: string | null;
  readonly generationId: number;
}

export class SceneManifestRegistryError extends Error {
  constructor(readonly manifestId: string) {
    super(`scene manifest is not allowlisted: ${manifestId}`);
    this.name = "SceneManifestRegistryError";
  }
}

export interface SceneManifestRegistry {
  get(manifestId: string): SceneManifest | null;
  list(): readonly SceneManifest[];
}

const MANIFEST_ID_PATTERN = /^[a-z][a-z0-9_-]{2,63}$/;
const MAX_MANIFESTS = 64;
const MAX_CHANNEL_CAPABILITIES = 16;

/** The allowlist is fixed at construction time. Nothing can register a manifest at runtime. */
export function createSceneManifestRegistry(manifests: readonly SceneManifest[]): SceneManifestRegistry {
  if (!Array.isArray(manifests) || manifests.length === 0 || manifests.length > MAX_MANIFESTS) {
    throw new RangeError("scene manifest registry requires 1..64 manifests");
  }
  const byId = new Map<string, SceneManifest>();
  for (const manifest of manifests) {
    assertValidManifest(manifest);
    if (byId.has(manifest.manifestId)) throw new RangeError(`duplicate scene manifest id: ${manifest.manifestId}`);
    byId.set(manifest.manifestId, Object.freeze({ ...manifest }));
  }
  for (const manifest of byId.values()) {
    if (manifest.fallbackManifestId !== null && !byId.has(manifest.fallbackManifestId)) {
      throw new RangeError(`unknown fallback manifest id: ${manifest.fallbackManifestId}`);
    }
  }
  const frozen = Object.freeze([...byId.values()]);
  return Object.freeze({
    get: (manifestId: string) => byId.get(manifestId) ?? null,
    list: () => frozen,
  });
}

export type SceneBindingPolicy = (manifest: SceneManifest, boundData: Readonly<Record<string, unknown>>) => { readonly allowed: boolean; readonly reason?: string };

export interface SceneDirectorClock {
  now(): number;
}

export interface SceneDirector {
  selectScene(intent: unknown, availableChannelCapabilities: readonly string[]): SceneSelectionResult;
  auditLog(): readonly SceneAuditEvent[];
  activeGenerationId(): number | null;
}

export interface CreateSceneDirectorOptions {
  readonly policy?: SceneBindingPolicy;
  readonly clock?: SceneDirectorClock;
}

const systemClock: SceneDirectorClock = Object.freeze({ now: () => Date.now() });

export function createSceneDirector(registry: SceneManifestRegistry, options: CreateSceneDirectorOptions = {}): SceneDirector {
  const clock = options.clock ?? systemClock;
  const policy = options.policy ?? (() => ({ allowed: true }));
  const events: SceneAuditEvent[] = [];
  let sequence = 0;
  let activeGenerationId: number | null = null;
  let activeManifestId: string | null = null;

  const emit = (type: SceneAuditEventType, manifestId: string | null, reason: string | null, generationId: number): void => {
    events.push(Object.freeze({ type, sequence: sequence += 1, atMs: clock.now(), manifestId, reason, generationId }));
  };
  const reject = (reason: SceneRejectionReason, generationId: number, fallbackManifestId: string | null = null): SceneSelectionRejected => {
    emit("scene_rejected", null, reason, generationId);
    return Object.freeze({ outcome: "rejected", reason, fallbackManifestId });
  };

  return Object.freeze({
    selectScene(rawIntent: unknown, availableChannelCapabilities: readonly string[]): SceneSelectionResult {
      const intent = parseIntent(rawIntent);
      const manifest = registry.get(intent.requestedManifestId);
      if (manifest === null) return reject("manifest_not_found", intent.generationId);
      if (manifest.sceneType !== intent.sceneType) return reject("scene_type_mismatch", intent.generationId, manifest.fallbackManifestId);

      const isStale = activeGenerationId !== null && intent.generationId < activeGenerationId;
      if (isStale && manifest.priority !== "max") return reject("generation_no_longer_active", intent.generationId);

      const missingCapability = manifest.channelCapabilitiesRequired.find((capability) => !availableChannelCapabilities.includes(capability));
      if (missingCapability !== undefined) return reject("missing_channel_capability", intent.generationId, manifest.fallbackManifestId);

      const bindingResult = bindData(manifest, intent.data);
      if (bindingResult.outcome === "rejected") return reject(bindingResult.reason, intent.generationId, manifest.fallbackManifestId);

      const unauthorizedPiiField = intent.piiFields.find((field) => !manifest.allowedPiiFields.includes(field));
      if (unauthorizedPiiField !== undefined) return reject("unauthorized_pii_field", intent.generationId, manifest.fallbackManifestId);

      const policyResult = policy(manifest, bindingResult.boundData);
      if (!policyResult.allowed) return reject("policy_blocked", intent.generationId, manifest.fallbackManifestId);

      const preempted = manifest.priority === "max" && activeManifestId !== null && activeManifestId !== manifest.manifestId;
      if (preempted) emit("scene_preempted", activeManifestId, "max_priority_scene", intent.generationId);

      activeGenerationId = activeGenerationId === null ? intent.generationId : Math.max(activeGenerationId, intent.generationId);
      activeManifestId = manifest.manifestId;
      emit("scene_selected", manifest.manifestId, null, intent.generationId);

      const directive: SceneDirective = Object.freeze({
        manifestId: manifest.manifestId,
        sceneType: manifest.sceneType,
        boundData: bindingResult.boundData,
        allowedActions: manifest.allowedActions,
        accessibilityLabel: manifest.accessibilityLabel,
        sandbox: "iframe_sandboxed",
        generationId: intent.generationId,
        issuedAtMs: clock.now(),
      });
      return Object.freeze({ outcome: "accepted", directive, preempted });
    },
    auditLog: () => Object.freeze([...events]),
    activeGenerationId: () => activeGenerationId,
  });
}

type BindDataResult =
  | { readonly outcome: "accepted"; readonly boundData: Readonly<Record<string, unknown>> }
  | { readonly outcome: "rejected"; readonly reason: "unauthorized_data_binding" | "invalid_data_type" };

function bindData(manifest: SceneManifest, data: Readonly<Record<string, unknown>>): BindDataResult {
  const bound: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    const expectedType = manifest.dataBindingSchema[key];
    if (expectedType === undefined) return { outcome: "rejected", reason: "unauthorized_data_binding" };
    const value = data[key];
    if (typeof value !== expectedType) return { outcome: "rejected", reason: "invalid_data_type" };
    bound[key] = value;
  }
  return { outcome: "accepted", boundData: Object.freeze(bound) };
}

function parseIntent(value: unknown): SceneIntent {
  if (value === null || typeof value !== "object") throw new RangeError("invalid scene intent");
  const record = value as Record<string, unknown>;
  if (typeof record.sceneType !== "string" || !(SCENE_TYPES as readonly string[]).includes(record.sceneType)) {
    throw new RangeError("invalid scene intent sceneType");
  }
  if (typeof record.requestedManifestId !== "string" || !MANIFEST_ID_PATTERN.test(record.requestedManifestId)) {
    throw new RangeError("invalid scene intent requestedManifestId");
  }
  if (record.data === null || typeof record.data !== "object" || Array.isArray(record.data)) {
    throw new RangeError("invalid scene intent data");
  }
  if (!Array.isArray(record.piiFields) || record.piiFields.some((field) => typeof field !== "string")) {
    throw new RangeError("invalid scene intent piiFields");
  }
  if (typeof record.generationId !== "number" || !Number.isSafeInteger(record.generationId) || record.generationId < 0) {
    throw new RangeError("invalid scene intent generationId");
  }
  return Object.freeze({
    sceneType: record.sceneType as SceneType,
    requestedManifestId: record.requestedManifestId,
    data: Object.freeze({ ...(record.data as Record<string, unknown>) }),
    piiFields: Object.freeze([...(record.piiFields as string[])]),
    generationId: record.generationId,
  });
}

function assertValidManifest(manifest: SceneManifest): void {
  if (manifest === null || typeof manifest !== "object") throw new RangeError("invalid scene manifest");
  if (!MANIFEST_ID_PATTERN.test(manifest.manifestId)) throw new RangeError("invalid scene manifest id");
  if (!(SCENE_TYPES as readonly string[]).includes(manifest.sceneType)) throw new RangeError("invalid scene manifest sceneType");
  if (!Array.isArray(manifest.allowedOrigins) || manifest.allowedOrigins.some((origin) => typeof origin !== "string")) {
    throw new RangeError("invalid scene manifest allowedOrigins");
  }
  for (const origin of manifest.allowedOrigins) {
    if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/.test(origin)) throw new RangeError(`scene manifest origin must be an https origin: ${origin}`);
  }
  if (manifest.channelCapabilitiesRequired.length > MAX_CHANNEL_CAPABILITIES) throw new RangeError("too many required channel capabilities");
  for (const key of manifest.allowedPiiFields) {
    if (!(key in manifest.dataBindingSchema)) throw new RangeError(`PII field ${key} is not part of the data binding schema`);
  }
  if (manifest.timeoutMs <= 0 || manifest.timeoutMs > 120_000) throw new RangeError("invalid scene manifest timeout");
  if (manifest.priority !== "normal" && manifest.priority !== "max") throw new RangeError("invalid scene manifest priority");
}
