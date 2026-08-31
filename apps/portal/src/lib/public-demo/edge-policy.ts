export const PUBLIC_DEMO_EDGE_POLICY_ATTESTATION_ENV =
  "PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION";

export const PUBLIC_DEMO_EDGE_POLICY_ATTESTATION =
  "axtro-public-demo-edge/v3;scope=global;post-start=120/60s;post-command-end=600/60s;get-head-demo=900/60s;concurrency=32;queue=0;reject=429";

export const PUBLIC_DEMO_EDGE_POLICY = Object.freeze({
  schema: "axtro-public-demo-edge/v3",
  scope: "global_across_replicas",
  queueDepth: 0,
  rejectStatus: 429,
  maxConcurrentRequests: 32,
  rules: Object.freeze([
    Object.freeze({
      method: "POST",
      path: "/demo/start",
      operation: "start",
      windowSeconds: 60,
      maxRequests: 120,
    }),
    Object.freeze({
      method: "POST",
      path: "/demo/command and /demo/end",
      operation: "command_or_end",
      windowSeconds: 60,
      maxRequests: 600,
    }),
    Object.freeze({
      method: "GET or HEAD",
      path: "/demo and /demo/*",
      operation: "read",
      windowSeconds: 60,
      maxRequests: 900,
    }),
  ]),
} as const);

export function isPublicDemoEdgePolicyAttested(value: string | undefined): boolean {
  return value === PUBLIC_DEMO_EDGE_POLICY_ATTESTATION;
}
