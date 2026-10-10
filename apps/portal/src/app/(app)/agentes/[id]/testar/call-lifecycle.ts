"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PortalVideoStartEffect } from "@axtro/contracts-ts";
import { isTrustedTavusConversationUrl } from "@axtro/provider-tavus";
import type { VideoChannelConsent } from "@/lib/actions/video-conversation";
import { classifyToolCallName } from "@/lib/runtime/tool-call-names";
import { dispatchToolCall, type ToolCallMessage } from "./tool-call-dispatcher";

type DailyCall = {
  join(options: { url: string }): Promise<unknown>;
  leave(): Promise<unknown>;
  destroy(): Promise<unknown>;
  setLocalAudio(enabled: boolean): unknown;
  sendAppMessage(message: unknown, to?: string): unknown;
  on(event: string, handler: (event: never) => void): unknown;
};
type Phase = "idle" | "starting" | "live" | "ended" | "recovery";
type Slot = "remoteVideo" | "remoteAudio" | "localVideo";
type StartResult = {
  url: string | null;
  conversationId: string | null;
  error: string | null;
  effect?: PortalVideoStartEffect;
  simulated?: boolean;
};
type Attempt = {
  epoch: number;
  commandId: string;
  conversationId: string | null;
  call: DailyCall | null;
  disposed: boolean;
  simulated: boolean;
  stopInFlight?: boolean;
  restored?: boolean;
  tracks: Partial<Record<Slot, MediaStreamTrack>>;
};
const STORAGE_ERROR = "Não foi possível preservar a intenção desta chamada nesta aba. Permita o armazenamento da sessão e recarregue a página.";
const STOP_ERROR = "Não foi possível confirmar o encerramento agora. Tente novamente. Se persistir, solicite reconciliação ao suporte.";
const COMMAND_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Only a typed completion, never storage absence, releases another mounted owner.
const completionSubscribers = new Map<string, Set<(commandId: string) => void>>();

// daily-js 0.91 keeps one global registry of call objects. destroy() awaits leave()
// and only then frees the entry, so while a previous teardown is pending (or its
// leave never settles) createCallObject() throws "Duplicate DailyIframe instances".
// That throw would land AFTER the paid start. The next start therefore waits, before
// any paid effect, for the previous teardown to settle, and refuses if it does not.
const TEARDOWN_WAIT_MS = 4_000;
let previousTeardown: Promise<unknown> = Promise.resolve();
// join() can hang (blocked network, stalled call machine) with the paid room already
// committed. Without a deadline the screen stays in "starting" with no way to stop it.
const JOIN_TIMEOUT_MS = 30_000;
function withDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("call join deadline exceeded")), milliseconds); });
  return Promise.race([operation, deadline]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}
const PREVIOUS_CALL_STILL_CLOSING = "A chamada anterior ainda está sendo encerrada neste navegador. Aguarde alguns segundos e tente de novo.";
async function previousCallReleased(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), TEARDOWN_WAIT_MS); });
  try {
    return await Promise.race([previousTeardown.then(() => true, () => true), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
function closedEffect(result: StartResult) {
  const effect = result.effect;
  if (effect?.schema_version !== "2.0.0" || Object.keys(effect).length !== 2) return null;
  return ["not_started", "possible", "committed"].includes(effect.remoteEffect) ? effect.remoteEffect : null;
}
function isProvenNotStarted(result: StartResult) { return closedEffect(result) === "not_started"; }

/** ADR-047: the stored UUID is correlation only; server actions retain authority. */
export function callRecoveryKey(tenantId: string, agentId: string, mode: "video" | "presentation") {
  return `axtro:call:${encodeURIComponent(tenantId)}:${encodeURIComponent(agentId)}:${mode}`;
}

export function useCallLifecycle<T extends StartResult>({ tenantId, agentId, mode, consent, startAction, stopAction, acceptResult }: {
  tenantId: string;
  agentId: string;
  mode: "video" | "presentation";
  consent: VideoChannelConsent;
  startAction: (agentId: string, commandId: string, consent: VideoChannelConsent) => Promise<T>;
  stopAction: (agentId: string, commandId: string) => Promise<{ stopped: boolean; error: string | null }>;
  acceptResult?: (result: T) => boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [providerStopConfirmed, setProviderStopConfirmed] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const attemptRef = useRef<Attempt | null>(null);
  const elements = useRef<Partial<Record<Slot, HTMLMediaElement | null>>>({});
  const storageRef = useRef<Storage | null>(null);
  const key = callRecoveryKey(tenantId, agentId, mode);

  const current = useCallback((attempt: Attempt) => mounted.current && attemptRef.current === attempt && attempt.epoch === epoch.current, []);
  const currentCall = useCallback((attempt: Attempt, call: DailyCall) => current(attempt) && attempt.call === call && !attempt.disposed, [current]);
  const bind = useCallback((slot: Slot, element: HTMLMediaElement | null) => {
    const previous = elements.current[slot];
    if (previous && previous !== element) previous.srcObject = null;
    elements.current[slot] = element;
    const track = attemptRef.current?.tracks[slot];
    if (element) element.srcObject = track ? new MediaStream([track]) : null;
  }, []);
  const remoteVideoRef = useCallback((element: HTMLVideoElement | null) => bind("remoteVideo", element), [bind]);
  const remoteAudioRef = useCallback((element: HTMLAudioElement | null) => bind("remoteAudio", element), [bind]);
  const localVideoRef = useCallback((element: HTMLVideoElement | null) => bind("localVideo", element), [bind]);

  const dispose = useCallback((attempt: Attempt) => {
    if (attempt.disposed) return;
    attempt.disposed = true;
    attempt.tracks = {};
    if (attemptRef.current === attempt) {
      for (const element of Object.values(elements.current)) if (element) element.srcObject = null;
    }
    const call = attempt.call;
    if (!call) return;
    // Both operations are attempted once, including when leave rejects or throws.
    // destroy() itself awaits leave() in daily-js, so the registry entry is only
    // freed once the pair settles: the next start waits on previousTeardown.
    const leaving = (async () => { try { await call.leave(); } catch { /* local cleanup remains best effort */ } })();
    const destroying = (async () => { try { await call.destroy(); } catch { /* remote recovery remains independent */ } })();
    previousTeardown = Promise.all([previousTeardown, leaving, destroying]);
  }, []);

  const clearCommand = useCallback((commandId: string) => {
    const storage = storageRef.current;
    if (!storage) throw new Error(STORAGE_ERROR);
    const storedCommand = storage.getItem(key);
    if (storedCommand !== null && storedCommand !== commandId) throw new Error(STORAGE_ERROR);
    if (storedCommand === commandId) storage.removeItem(key);
  }, [key]);

  useEffect(() => {
    mounted.current = true;
    epoch.current += 1;
    setStorageReady(false);
    setPhase("idle");
    setStopping(false);
    setError(null);
    setProviderStopConfirmed(false);
    try {
      if (!tenantId || !agentId) throw new Error(STORAGE_ERROR);
      const storage = window.sessionStorage;
      storageRef.current = storage;
      const commandId = storage.getItem(key);
      if (commandId !== null) {
        if (!COMMAND_UUID.test(commandId)) throw new Error(STORAGE_ERROR);
        attemptRef.current = { epoch: epoch.current, commandId, conversationId: null, call: null, disposed: false, simulated: false, restored: true, tracks: {} };
        setPhase("recovery");
      }
      setStorageReady(true);
    } catch {
      storageRef.current = null;
      setStorageReady(false);
      setError(STORAGE_ERROR);
    }
    const releaseDeniedCommand = (commandId: string) => {
      const attempt = attemptRef.current;
      // Only restored recovery owners can consume a denial for an earlier attempt.
      if (!attempt?.restored || attempt.commandId !== commandId || attempt.call || !current(attempt)) return;
      dispose(attempt);
      attemptRef.current = null;
      epoch.current += 1;
      setStopping(false);
      setPhase("idle");
      setError("A tentativa anterior não iniciou uma sala. Você pode iniciar uma nova chamada.");
    };
    const listeners = completionSubscribers.get(key) ?? new Set<(commandId: string) => void>();
    listeners.add(releaseDeniedCommand);
    completionSubscribers.set(key, listeners);
    return () => {
      listeners.delete(releaseDeniedCommand);
      if (!listeners.size) completionSubscribers.delete(key);
      mounted.current = false;
      epoch.current += 1;
      const attempt = attemptRef.current;
      if (attempt) dispose(attempt);
      attemptRef.current = null;
      storageRef.current = null;
    };
  }, [agentId, current, dispose, key, tenantId]);

  const sendToolResult = useCallback((attempt: Attempt, call: DailyCall, toolCallId: string, output: string, status: string) => {
    if (!currentCall(attempt, call) || !attempt.conversationId) return;
    try {
      call.sendAppMessage({ message_type: "conversation", event_type: "conversation.tool_result", conversation_id: attempt.conversationId,
        properties: { tool_call_id: toolCallId, output, status } }, "*");
    } catch {
      if (currentCall(attempt, call)) setError("Não foi possível entregar a resposta da ação nesta chamada.");
    }
  }, [currentCall]);

  const handleTool = useCallback((attempt: Attempt, call: DailyCall, message: ToolCallMessage) => {
    if (!currentCall(attempt, call) || !attempt.conversationId) return;
    // Older provider envelopes omit the label; the captured Daily object and
    // command still identify the session. A supplied label must agree.
    if (message.conversation_id !== undefined && message.conversation_id !== attempt.conversationId) return;
    const toolCallId = message.properties?.tool_call_id;
    if (!toolCallId) return;
    const category = classifyToolCallName(message.properties?.name ?? "");
    if (category === "scene") {
      sendToolResult(attempt, call, toolCallId, "Comando de cena recusado: não há manifesto, geração e recibo validados pelo servidor.", "error");
    } else if (category === "business_action") {
      void (async () => {
        try {
          const result = await dispatchToolCall({ agentId, commandId: attempt.commandId, mode, message });
          if (result && currentCall(attempt, call)) sendToolResult(attempt, call, result.toolCallId, result.output, result.status);
        } catch {
          // Failure cannot become a success receipt, and cannot reach a later call.
          if (currentCall(attempt, call)) sendToolResult(attempt, call, toolCallId, "Não foi possível confirmar o resultado desta ação. Consulte o histórico antes de repetir.", "error");
        }
      })();
    }
  }, [agentId, currentCall, mode, sendToolResult]);

  const start = useCallback(() => {
    if (!storageReady || !storageRef.current || attemptRef.current || phase !== "idle") return;
    const commandId = crypto.randomUUID();
    try {
      const pendingCommand = storageRef.current.getItem(key);
      if (pendingCommand !== null) {
        if (!COMMAND_UUID.test(pendingCommand)) throw new Error(STORAGE_ERROR);
        attemptRef.current = {epoch: ++epoch.current, commandId: pendingCommand, conversationId: null, call: null, disposed: false, simulated: false, restored: true, tracks: {}};
        setPhase("recovery");
        setError("Há uma intenção pendente nesta aba. Confirme o pedido de encerramento antes de iniciar outra chamada.");
        return;
      }
      storageRef.current.setItem(key, commandId);
      if (storageRef.current.getItem(key) !== commandId) throw new Error(STORAGE_ERROR);
    } catch {
      setStorageReady(false);
      setError(STORAGE_ERROR);
      return;
    }
    const attempt: Attempt = { epoch: ++epoch.current, commandId, conversationId: null, call: null, disposed: false, simulated: false, tracks: {} };
    attemptRef.current = attempt;
    setError(null);
    setProviderStopConfirmed(false);
    setMuted(false);
    setPhase("starting");
    void (async () => {
      const forgetNotStartedCommand = () => {
        const storage = storageRef.current;
        if (storage) clearCommand(commandId);
        else {
          const recoveryStorage = window.sessionStorage;
          if (recoveryStorage.getItem(key) === commandId) recoveryStorage.removeItem(key);
        }
        for (const listener of completionSubscribers.get(key) ?? []) listener(commandId);
      };
      try {
        // Nothing paid has been dispatched yet, so every early exit may forget the intent.
        const released = await previousCallReleased();
        if (!released || !current(attempt)) {
          forgetNotStartedCommand();
          if (current(attempt)) {
            attemptRef.current = null;
            setError(released ? "A chamada não foi iniciada." : PREVIOUS_CALL_STILL_CLOSING);
            setPhase("idle");
          }
          return;
        }
        const result = await startAction(agentId, commandId, consent);
        // An explicit predispatch denial can be forgotten even after unmount.
        if (isProvenNotStarted(result)) forgetNotStartedCommand();
        if (!current(attempt)) return;
        if (result.simulated && isProvenNotStarted(result) && acceptResult?.(result)) {
          attempt.simulated = true;
          setPhase("live");
          return;
        }
        if (isProvenNotStarted(result)) {
          attemptRef.current = null;
          setError(result.error ?? "A chamada não foi iniciada.");
          setPhase("idle");
          return;
        }
        if (result.simulated || closedEffect(result) !== "committed" || !result.url || !result.conversationId || !isTrustedTavusConversationUrl(result.url) || (acceptResult && !acceptResult(result))) {
          setError(result.error ?? "A sala não pôde ser aberta com segurança. A intenção foi preservada para encerramento ou reconciliação.");
          setPhase("recovery");
          return;
        }
        attempt.conversationId = result.conversationId;
        const DailyIframe = (await import("@daily-co/daily-js")).default;
        if (!current(attempt)) return;
        const call = DailyIframe.createCallObject() as unknown as DailyCall;
        attempt.call = call;
        call.on("track-started", ((event: { participant?: { local?: boolean }; track?: MediaStreamTrack }) => {
          if (!currentCall(attempt, call) || !event.track) return;
          const slot = event.track.kind === "video" ? (event.participant?.local ? "localVideo" : "remoteVideo") : event.track.kind === "audio" && !event.participant?.local ? "remoteAudio" : null;
          if (!slot) return;
          attempt.tracks[slot] = event.track;
          bind(slot, elements.current[slot] ?? null);
        }) as never);
        call.on("track-stopped", ((event: { track?: MediaStreamTrack }) => {
          if (!currentCall(attempt, call) || !event.track) return;
          for (const slot of Object.keys(attempt.tracks) as Slot[]) {
            if (attempt.tracks[slot] === event.track || attempt.tracks[slot]?.id === event.track.id) {
              delete attempt.tracks[slot];
              bind(slot, elements.current[slot] ?? null);
            }
          }
        }) as never);
        call.on("app-message", ((event: { data?: ToolCallMessage }) => {
          const data = event.data;
          if (data?.message_type === "conversation" && data.event_type === "conversation.tool_call") handleTool(attempt, call, data);
        }) as never);
        call.on("left-meeting", (() => {
          if (!currentCall(attempt, call)) return;
          dispose(attempt);
          setPhase("recovery");
          setError("A sala foi desconectada nesta tela. Confirme o pedido de encerramento para liberar uma nova chamada.");
        }) as never);
        await withDeadline(call.join({ url: result.url }), JOIN_TIMEOUT_MS);
        if (currentCall(attempt, call)) setPhase("live");
        else dispose(attempt);
      } catch {
        dispose(attempt);
        if (current(attempt)) {
          setError("Não foi possível entrar na sala. A intenção foi preservada para encerramento ou reconciliação.");
          setPhase("recovery");
        }
      }
    })();
  }, [acceptResult, agentId, bind, clearCommand, consent, current, currentCall, dispose, handleTool, key, phase, startAction, storageReady]);

  const end = useCallback(async () => {
    const attempt = attemptRef.current;
    if (!attempt || !current(attempt) || attempt.stopInFlight) return;
    if (attempt.simulated) {
      dispose(attempt);
      attemptRef.current = null;
      setPhase("ended");
      return;
    }
    attempt.stopInFlight = true;
    let accepted = false;
    setStopping(true);
    setError(null);
    try {
      const result = await stopAction(agentId, attempt.commandId);
      if (!current(attempt)) return;
      if (!result.stopped) { setError(result.error ?? STOP_ERROR); return; }
      clearCommand(attempt.commandId);
      dispose(attempt);
      attemptRef.current = null;
      epoch.current += 1;
      accepted = true;
      setProviderStopConfirmed(true);
      setPhase("ended");
    } catch {
      if (current(attempt)) setError(STOP_ERROR);
    } finally {
      attempt.stopInFlight = false;
      if (current(attempt) || (accepted && mounted.current && attemptRef.current === null && epoch.current === attempt.epoch + 1)) setStopping(false);
    }
  }, [agentId, clearCommand, current, dispose, stopAction]);

  const reset = useCallback(() => {
    if (attemptRef.current || !storageReady) return;
    setProviderStopConfirmed(false);
    setError(null);
    setPhase("idle");
  }, [storageReady]);
  const toggleMute = useCallback(() => {
    const attempt = attemptRef.current;
    if (!attempt?.call || !currentCall(attempt, attempt.call)) return;
    const next = !muted;
    try { attempt.call.setLocalAudio(!next); setMuted(next); } catch { setError("Não foi possível alterar o microfone agora."); }
  }, [currentCall, muted]);

  return { phase, error, muted, stopping, providerStopConfirmed, storageReady, start, end, reset, toggleMute, remoteVideoRef, remoteAudioRef, localVideoRef };
}
