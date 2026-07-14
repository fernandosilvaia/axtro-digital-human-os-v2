import type { ActionIntent } from "@axtro/contracts-ts";

import {
  type ActorId,
  type CorrelationId,
  type TenantId,
  parseActorId,
  parseCorrelationId,
  parseTenantId,
} from "./ids.js";

export type ActorType = ActionIntent["actor_type"];
const ACTOR_TYPES: readonly ActorType[] = [
  "presenter",
  "specialist",
  "workflow",
  "human_operator",
  "axtro_agent",
];

export interface TenantContextInput {
  tenantId: string;
  actorId: string;
  actorType: ActorType;
  grantedScopes: readonly string[];
  purposes: readonly string[];
}

export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly actorType: ActorType;
  readonly grantedScopes: readonly string[];
  readonly purposes: readonly string[];
}

export interface TraceContextInput {
  traceId: string;
  correlationId: string;
  causationId: string | null;
}

export interface TraceContext {
  readonly traceId: string;
  readonly correlationId: CorrelationId;
  readonly causationId: CorrelationId | null;
}

export class TenantBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantBoundaryError";
  }
}

export function parseActorType(value: unknown): ActorType {
  if (typeof value !== "string" || !(ACTOR_TYPES as readonly string[]).includes(value)) {
    throw new TenantBoundaryError("actorType must be an allowed actor type");
  }
  return value as ActorType;
}

export function createTenantContext(input: TenantContextInput): TenantContext {
  if (input.grantedScopes.some((scope) => scope.length === 0)) {
    throw new TenantBoundaryError("grantedScopes cannot contain empty values");
  }
  if (input.purposes.some((purpose) => purpose.length === 0)) {
    throw new TenantBoundaryError("purposes cannot contain empty values");
  }
  return Object.freeze({
    tenantId: parseTenantId(input.tenantId),
    actorId: parseActorId(input.actorId),
    actorType: parseActorType(input.actorType),
    grantedScopes: Object.freeze([...input.grantedScopes]),
    purposes: Object.freeze([...input.purposes]),
  });
}

export function createTraceContext(input: TraceContextInput): TraceContext {
  if (typeof input.traceId !== "string" || !/^[0-9a-f]{16,64}$/.test(input.traceId)) {
    throw new RangeError("traceId must be 16 to 64 lower-case hexadecimal characters");
  }
  return Object.freeze({
    traceId: input.traceId,
    correlationId: parseCorrelationId(input.correlationId),
    causationId: input.causationId === null ? null : parseCorrelationId(input.causationId),
  });
}

export function assertTenantMatch(context: TenantContext, tenantId: string): TenantId {
  const parsed = parseTenantId(tenantId);
  if (parsed !== context.tenantId) {
    throw new TenantBoundaryError("tenant context does not authorize the requested tenant");
  }
  return parsed;
}
