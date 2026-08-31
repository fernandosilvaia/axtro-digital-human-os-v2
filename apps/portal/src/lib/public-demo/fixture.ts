export const PUBLIC_DEMO_FIXTURE_VERSION = "1.0.0" as const;

export const PUBLIC_DEMO_SURFACES = Object.freeze([
  "overview",
  "agent",
  "knowledge",
  "conversation",
] as const);

export const PUBLIC_DEMO_STEPS = Object.freeze([
  "welcome",
  "context",
  "conversation",
  "handoff",
] as const);

export const PUBLIC_DEMO_COMMANDS = Object.freeze([
  "open_overview",
  "inspect_agent",
  "inspect_knowledge",
  "inspect_conversation",
  "advance",
  "reset",
] as const);

export type PublicDemoSurface = (typeof PUBLIC_DEMO_SURFACES)[number];
export type PublicDemoStep = (typeof PUBLIC_DEMO_STEPS)[number];
export type PublicDemoCommandName = (typeof PUBLIC_DEMO_COMMANDS)[number];

/**
 * Product-tour data is fixed application content. It contains no customer,
 * tenant, user, actor, provider, receipt or externally supplied value.
 */
export const PUBLIC_DEMO_FIXTURE = Object.freeze({
  fixture_version: PUBLIC_DEMO_FIXTURE_VERSION,
  data_classification: "synthetic_non_customer",
  retention: "none",
  paid_effects: "disabled",
  surfaces: Object.freeze({
    overview: Object.freeze({
      available_demo_surfaces: 4,
      external_effects: 0,
      stored_customer_records: 0,
    }),
    agent: Object.freeze({
      synthetic_agent_profiles: 1,
      privileged_roles: 0,
      external_effects: 0,
    }),
    knowledge: Object.freeze({
      synthetic_knowledge_sources: 3,
      customer_documents: 0,
      external_queries: 0,
    }),
    conversation: Object.freeze({
      scripted_demo_steps: 4,
      provider_requests: 0,
      stored_transcripts: 0,
    }),
  }),
});

export function isPublicDemoSurface(value: unknown): value is PublicDemoSurface {
  return typeof value === "string"
    && (PUBLIC_DEMO_SURFACES as readonly string[]).includes(value);
}

export function isPublicDemoStep(value: unknown): value is PublicDemoStep {
  return typeof value === "string"
    && (PUBLIC_DEMO_STEPS as readonly string[]).includes(value);
}

export function isPublicDemoCommandName(value: unknown): value is PublicDemoCommandName {
  return typeof value === "string"
    && (PUBLIC_DEMO_COMMANDS as readonly string[]).includes(value);
}
