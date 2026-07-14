import type { ProviderRegistry, SpeechToTextPort, TextToSpeechPort } from "@axtro/provider-contracts";

/** Composition boundary only. Selection remains explicit and fake-only in M0. */
export function resolveSpeechToTextPort(registry: ProviderRegistry, providerId: unknown): SpeechToTextPort {
  return registry.resolve(providerId, "stt");
}

export function resolveTextToSpeechPort(registry: ProviderRegistry, providerId: unknown): TextToSpeechPort {
  return registry.resolve(providerId, "tts");
}

export type { SpeechToTextPort, TextToSpeechPort, SpeechToTextRequest, TextToSpeechRequest } from "@axtro/provider-contracts";
