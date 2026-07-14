import type { ProviderRegistry, RealtimeModelPort } from "@axtro/provider-contracts";

/** Composition boundary only. It never imports a model SDK or makes a network call. */
export function resolveRealtimeModelPort(registry: ProviderRegistry, providerId: unknown): RealtimeModelPort {
  return registry.resolve(providerId, "realtime_model");
}

export type { RealtimeModelPort, RealtimeModelSession, RealtimeModelSessionRequest } from "@axtro/provider-contracts";
