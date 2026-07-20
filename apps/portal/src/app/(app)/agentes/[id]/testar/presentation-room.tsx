"use client";

/**
 * Sala de apresentação ao vivo: a agente aparece em vídeo e comanda o palco
 * de slides via tool calls do protocolo de interações Tavus (app-messages no
 * data channel Daily). O cliente escuta `conversation.tool_call`, aplica a
 * navegação e devolve `conversation.tool_result` com o `tool_call_id` — sem
 * isso a persona não sabe que o slide mudou.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Deck } from "@/lib/presentation/deck";
import { startPresentationConversation } from "@/lib/actions/video-conversation";

type DailyCall = {
  join(options: { url: string }): Promise<unknown>;
  leave(): Promise<unknown>;
  destroy(): Promise<unknown>;
  setLocalAudio(enabled: boolean): unknown;
  sendAppMessage(message: unknown, to?: string): unknown;
  on(event: string, handler: (event: never) => void): unknown;
};

interface ToolCallMessage {
  readonly message_type?: string;
  readonly event_type?: string;
  readonly conversation_id?: string;
  readonly properties?: {
    readonly tool_call_id?: string;
    readonly name?: string;
    readonly arguments?: string | Record<string, unknown>;
  };
}

export function PresentationRoom({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [phase, setPhase] = useState<"idle" | "starting" | "live" | "ended">("idle");
  const [error, setError] = useState<string | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [muted, setMuted] = useState(false);

  const callRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const slideIndexRef = useRef(0);
  const deckRef = useRef<Deck | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  const goTo = useCallback((index: number) => {
    const currentDeck = deckRef.current;
    if (!currentDeck) return index;
    const clamped = Math.max(0, Math.min(currentDeck.slides.length - 1, index));
    slideIndexRef.current = clamped;
    setSlideIndex(clamped);
    return clamped;
  }, []);

  const handleToolCall = useCallback((message: ToolCallMessage) => {
    const currentDeck = deckRef.current;
    const call = callRef.current;
    if (!currentDeck || !call) return;
    const name = message.properties?.name ?? "";
    const rawArguments = message.properties?.arguments;
    let parsedArguments: Record<string, unknown> = {};
    if (typeof rawArguments === "string") {
      try {
        parsedArguments = JSON.parse(rawArguments) as Record<string, unknown>;
      } catch {
        parsedArguments = {};
      }
    } else if (rawArguments && typeof rawArguments === "object") {
      parsedArguments = rawArguments;
    }

    let landed: number | null = null;
    if (name === "next_slide") landed = goTo(slideIndexRef.current + 1);
    else if (name === "previous_slide") landed = goTo(slideIndexRef.current - 1);
    else if (name === "go_to_slide") {
      const requested = Number(parsedArguments.slide_number);
      if (Number.isFinite(requested)) landed = goTo(Math.round(requested) - 1);
    }
    if (landed === null) return;

    const toolCallId = message.properties?.tool_call_id;
    if (!toolCallId) return;
    const landedSlide = currentDeck.slides[landed];
    call.sendAppMessage(
      {
        message_type: "conversation",
        event_type: "conversation.tool_result",
        conversation_id: conversationIdRef.current ?? message.conversation_id ?? "",
        properties: {
          tool_call_id: toolCallId,
          output: `Slide ${landed + 1} de ${currentDeck.slides.length} em exibição: ${landedSlide?.title ?? ""}`,
          status: "success",
        },
      },
      "*",
    );
  }, [goTo]);

  const attachTrack = useCallback((track: MediaStreamTrack, isLocal: boolean) => {
    if (track.kind === "video") {
      const element = isLocal ? localVideoRef.current : remoteVideoRef.current;
      if (element) element.srcObject = new MediaStream([track]);
    } else if (track.kind === "audio" && !isLocal && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = new MediaStream([track]);
    }
  }, []);

  const start = useCallback(() => {
    setError(null);
    setPhase("starting");
    void (async () => {
      const result = await startPresentationConversation(agentId);
      if (!result.url || !result.deck) {
        setError(result.error ?? "Erro inesperado.");
        setPhase("idle");
        return;
      }
      deckRef.current = result.deck;
      conversationIdRef.current = result.conversationId;
      setDeck(result.deck);
      slideIndexRef.current = 0;
      setSlideIndex(0);
      try {
        const DailyIframe = (await import("@daily-co/daily-js")).default;
        const call = DailyIframe.createCallObject() as unknown as DailyCall;
        callRef.current = call;
        call.on("track-started", ((event: { participant?: { local?: boolean }; track?: MediaStreamTrack }) => {
          if (event.track) attachTrack(event.track, event.participant?.local === true);
        }) as never);
        call.on("app-message", ((event: { data?: ToolCallMessage }) => {
          const data = event.data;
          if (data?.message_type === "conversation" && data.event_type === "conversation.tool_call") {
            handleToolCall(data);
          }
        }) as never);
        call.on("left-meeting", (() => setPhase("ended")) as never);
        await call.join({ url: result.url });
        setPhase("live");
      } catch {
        setError("Não foi possível entrar na sala de vídeo. Verifique câmera e microfone e tente de novo.");
        setPhase("idle");
      }
    })();
  }, [agentId, attachTrack, handleToolCall]);

  const leave = useCallback(() => {
    const call = callRef.current;
    callRef.current = null;
    if (call) {
      void call.leave().then(() => call.destroy());
    }
    setPhase("ended");
  }, []);

  useEffect(() => () => {
    const call = callRef.current;
    callRef.current = null;
    if (call) void call.leave().then(() => call.destroy());
  }, []);

  function toggleMute() {
    const call = callRef.current;
    if (!call) return;
    const next = !muted;
    call.setLocalAudio(!next);
    setMuted(next);
  }

  if (phase === "idle" || phase === "starting") {
    return (
      <section className="card" style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ fontSize: "0.95rem", marginBottom: 4 }}>Apresentação ao vivo 🎬</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.84rem", margin: 0 }}>
            {agentName} conduz a reunião com slides na tela — ela mesma avança a apresentação enquanto conversa com você, como numa sala de conferência real.
          </p>
        </div>
        {error && <p className="form-error" role="alert" style={{ margin: 0, width: "100%" }}>{error}</p>}
        <button type="button" className="btn btn-primary" onClick={start} disabled={phase === "starting"} style={{ padding: "11px 20px" }}>
          {phase === "starting" ? "Montando a sala…" : "Iniciar apresentação"}
        </button>
      </section>
    );
  }

  if (phase === "ended") {
    return (
      <section className="card" style={{ marginTop: 16, padding: 16 }}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.88rem" }}>
          Apresentação encerrada. <button type="button" className="btn" onClick={() => { setPhase("idle"); setDeck(null); }} style={{ marginLeft: 8 }}>Nova apresentação</button>
        </p>
      </section>
    );
  }

  const slide = deck?.slides[slideIndex];

  return (
    <section className="card" style={{ marginTop: 16, padding: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div
          aria-live="polite"
          style={{
            flex: "1 1 420px",
            minHeight: 380,
            borderRadius: 12,
            padding: "36px 40px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: "linear-gradient(135deg, #101024 0%, #1a1440 55%, #241a55 100%)",
            border: "1px solid rgba(129,120,255,0.25)",
          }}
        >
          {slide ? (
            <>
              <p style={{ margin: "0 0 10px", fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(196,189,255,0.75)" }}>
                {deck?.title} · {slideIndex + 1}/{deck?.slides.length}
              </p>
              <h2 style={{ margin: 0, fontSize: slide.kind === "cover" ? "2.1rem" : "1.6rem", lineHeight: 1.15, color: "#f4f2ff" }}>{slide.title}</h2>
              {slide.subtitle && <p style={{ margin: "12px 0 0", fontSize: "1.02rem", color: "rgba(226,222,255,0.85)" }}>{slide.subtitle}</p>}
              {slide.bullets && (
                <ul style={{ margin: "18px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
                  {slide.bullets.map((bullet) => (
                    <li key={bullet} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: "1.0rem", color: "rgba(233,230,255,0.92)" }}>
                      <span aria-hidden style={{ color: "#8f7bff" }}>◆</span>
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
              {slide.note && <p style={{ margin: "18px 0 0", fontSize: "0.78rem", color: "rgba(196,189,255,0.6)" }}>{slide.note}</p>}
            </>
          ) : (
            <p style={{ color: "rgba(226,222,255,0.7)" }}>Preparando os slides…</p>
          )}
        </div>

        <div style={{ flex: "0 1 280px", display: "flex", flexDirection: "column", gap: 10, minWidth: 240 }}>
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{ width: "100%", aspectRatio: "3 / 4", objectFit: "cover", borderRadius: 12, background: "#000" }}
            aria-label={`Vídeo de ${agentName}`}
          />
          <audio ref={remoteAudioRef} autoPlay />
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{ width: 96, aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 8, background: "#111", alignSelf: "flex-end" }}
            aria-label="Sua câmera"
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={toggleMute} style={{ flex: 1 }}>
              {muted ? "Ativar microfone" : "Silenciar"}
            </button>
            <button type="button" className="btn" onClick={leave} style={{ flex: 1, borderColor: "rgba(255,120,120,0.4)", color: "#ff9d9d" }}>
              Encerrar
            </button>
          </div>
          <p style={{ fontSize: "0.74rem", color: "var(--text-faint)", margin: 0 }}>
            {agentName} controla os slides sozinha durante a conversa. Libere câmera e microfone quando o navegador pedir; a sala encerra em 15 minutos.
          </p>
        </div>
      </div>
    </section>
  );
}
