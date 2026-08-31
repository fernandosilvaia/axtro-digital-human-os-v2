export interface PortalTextPreviewReleaseGate {
  readonly enabled: boolean;
  readonly explicitlyConfigured: boolean;
  readonly valid: boolean;
}

const UNCONFIGURED_CLOSED_GATE: PortalTextPreviewReleaseGate = Object.freeze({
  enabled: false,
  explicitlyConfigured: false,
  valid: false,
});

const EXPLICITLY_CLOSED_GATE: PortalTextPreviewReleaseGate = Object.freeze({
  enabled: false,
  explicitlyConfigured: true,
  valid: true,
});

const INVALID_CLOSED_GATE: PortalTextPreviewReleaseGate = Object.freeze({
  enabled: false,
  explicitlyConfigured: true,
  valid: false,
});

export function parsePortalTextPreviewReleaseGate(
  value: string | undefined,
): PortalTextPreviewReleaseGate {
  if (value === undefined) return UNCONFIGURED_CLOSED_GATE;
  if (value === "false") return EXPLICITLY_CLOSED_GATE;
  return INVALID_CLOSED_GATE;
}

export function portalTextPreviewReleaseGate(
  env: Readonly<Record<string, string | undefined>>,
): PortalTextPreviewReleaseGate {
  return parsePortalTextPreviewReleaseGate(env.PORTAL_TEXT_PREVIEW_ENABLED);
}

export function isPortalTextPreviewEnabled(
  _env: Readonly<Record<string, string | undefined>>,
): boolean {
  // M6-02 is deliberately non-activatable. M6-06 owns the compound release gate.
  return false;
}

export function isPortalTextPreviewReleaseClosed(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const gate = portalTextPreviewReleaseGate(env);
  return gate.valid && gate.explicitlyConfigured && !gate.enabled;
}
