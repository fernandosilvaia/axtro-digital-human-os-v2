import type { AvatarPort, ProviderRegistry } from "@axtro/provider-contracts";

/** Composition boundary only. Avatar failure handling remains owned by the session runtime. */
export function resolveAvatarPort(registry: ProviderRegistry, providerId: unknown): AvatarPort {
  return registry.resolve(providerId, "avatar");
}

export type { AvatarPort, AvatarRenderRequest } from "@axtro/provider-contracts";

export {
  createAvatarSession,
  type AvatarSession,
  type AvatarSessionClock,
  type AvatarRenderOutcome,
  type AvatarRenderSegmentInput,
  type AvatarRenderStatus,
  type AvatarWarmUpResult,
  type CreateAvatarSessionOptions,
} from "./avatar-session.js";
