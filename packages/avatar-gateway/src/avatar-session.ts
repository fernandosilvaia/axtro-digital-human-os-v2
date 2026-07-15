import {
  ProviderOperationError,
  type AvatarPort,
  type ProviderOperationControl,
  type ProviderReference,
} from "@axtro/provider-contracts";

/**
 * M2-06: avatar publishes media as a replaceable secondary participant. Art.
 * 14 (declared degradation) requires that an avatar failure never blocks
 * audio, so every outcome here is a typed result, never a thrown error that
 * could propagate into a shared audio pipeline. Once a session's avatar
 * fails, it stays disabled for that session (CAPABILITY_DEGRADATION_MATRIX)
 * rather than silently retrying.
 */
export type AvatarRenderStatus = "rendered" | "degraded_to_voice_only" | "discarded_late" | "disabled";

export interface AvatarRenderOutcome {
  readonly status: AvatarRenderStatus;
  readonly generationId: number;
  readonly mediaReference: ProviderReference | null;
  readonly reason: string | null;
}

export interface AvatarWarmUpResult {
  readonly ready: boolean;
  readonly elapsedMs: number;
}

export interface AvatarRenderSegmentInput {
  readonly avatarReference: ProviderReference;
  readonly audioReference: ProviderReference;
  readonly generationId: number;
}

export interface AvatarSessionClock {
  now(): number;
}

export interface AvatarSession {
  isDisabled(): boolean;
  warmUp(control: ProviderOperationControl): Promise<AvatarWarmUpResult>;
  renderSegment(
    input: AvatarRenderSegmentInput,
    isGenerationActive: (generationId: number) => boolean,
    control: ProviderOperationControl,
  ): Promise<AvatarRenderOutcome>;
}

export interface CreateAvatarSessionOptions {
  readonly clock?: AvatarSessionClock;
}

const systemClock: AvatarSessionClock = Object.freeze({ now: () => Date.now() });

export function createAvatarSession(avatarPort: AvatarPort, options: CreateAvatarSessionOptions = {}): AvatarSession {
  const clock = options.clock ?? systemClock;
  let disabled = false;

  return Object.freeze({
    isDisabled: () => disabled,

    async warmUp(control: ProviderOperationControl): Promise<AvatarWarmUpResult> {
      if (disabled) return Object.freeze({ ready: false, elapsedMs: 0 });
      const startedAtMs = clock.now();
      try {
        const health = await avatarPort.health(control);
        const elapsedMs = clock.now() - startedAtMs;
        if (health.status !== "healthy") {
          disabled = true;
          return Object.freeze({ ready: false, elapsedMs });
        }
        return Object.freeze({ ready: true, elapsedMs });
      } catch {
        disabled = true;
        return Object.freeze({ ready: false, elapsedMs: clock.now() - startedAtMs });
      }
    },

    async renderSegment(
      input: AvatarRenderSegmentInput,
      isGenerationActive: (generationId: number) => boolean,
      control: ProviderOperationControl,
    ): Promise<AvatarRenderOutcome> {
      if (disabled) {
        return Object.freeze({ status: "disabled", generationId: input.generationId, mediaReference: null, reason: "avatar_disabled_for_session" });
      }
      try {
        const media = await avatarPort.render({ avatarReference: input.avatarReference, audioReference: input.audioReference }, control);
        if (!isGenerationActive(input.generationId)) {
          // The generation that requested this frame was cancelled (barge-in or
          // supersession) while the provider was still rendering it. Never
          // deliver a lip-sync segment for speech the participant never heard.
          return Object.freeze({ status: "discarded_late", generationId: input.generationId, mediaReference: null, reason: "generation_no_longer_active" });
        }
        return Object.freeze({ status: "rendered", generationId: input.generationId, mediaReference: media.mediaReference, reason: null });
      } catch (error: unknown) {
        disabled = true;
        const reason = error instanceof ProviderOperationError ? error.failure.code : "unknown";
        return Object.freeze({ status: "degraded_to_voice_only", generationId: input.generationId, mediaReference: null, reason });
      }
    },
  });
}
