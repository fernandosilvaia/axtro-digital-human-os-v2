import type { ProviderRegistry, RealtimeModelPort } from "@axtro/provider-contracts";

/** Composition boundary only. It never imports a model SDK or makes a network call. */
export function resolveRealtimeModelPort(registry: ProviderRegistry, providerId: unknown): RealtimeModelPort {
  return registry.resolve(providerId, "realtime_model");
}

export type { RealtimeModelPort, RealtimeModelSession, RealtimeModelSessionRequest } from "@axtro/provider-contracts";

export {
  runModularConversationPath,
  selectConversationPathMode,
  openS2SSession,
  renewS2SSessionIfNeeded,
  createDeterministicTextGenerationFake,
  type ConversationPathMode,
  type ConversationPathFeatureFlags,
  type ConversationPathRouteResult,
  type ModularPathClock,
  type ModularPathResult,
  type ModularPathTiming,
  type RunModularConversationPathInput,
  type RenewS2SSessionInput,
  type RenewS2SSessionResult,
  type TextGenerationPort,
  type TextGenerationRequest,
  type TextGenerationResult,
} from "./conversation-path.js";
