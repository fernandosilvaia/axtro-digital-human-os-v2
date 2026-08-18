"use client";

/**
 * Sala de apresentação ao vivo. Mensagens de tool do provider são tratadas
 * como não confiáveis no navegador: esta tela nunca altera o palco a partir
 * delas. Uma integração futura só poderá habilitar cena automática pelo
 * bridge ADR-038 (manifesto fechado, geração, fence e recibo durável).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { isTrustedTavusConversationUrl } from "@axtro/provider-tavus";

import type { Deck, DeckSlide, DeckSlideKind } from "@/lib/presentation/deck";
import { startPresentationConversation, stopPresentationConversation, type VideoChannelConsent } from "@/lib/actions/video-conversation";

const INITIAL_CONSENT: VideoChannelConsent = {
  disclosure: false,
  essentialProcessing: false,
  recording: false,
  transcription: false,
  behavioralAnalysis: false,
  visualAnalysis: false,
};

function allConsentConfirmed(consent: VideoChannelConsent): boolean {
  return Object.values(consent).every(Boolean);
}

/**
 * Ícones e cor de destaque por tipo de slide. Puramente decorativos/
 * metafóricos (bússola, colunas, balança) — nunca um gráfico com trend
 * implícito, pra não parecer dado inventado (deck.ts: "zero dado inventado
 * também na tela"). SVG inline: sem asset externo pra hospedar/carregar.
 */
function SlideIcon({ kind, size = 22 }: { kind: DeckSlideKind; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "cover":
      return <svg {...common}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" /></svg>;
    case "agenda":
      return <svg {...common}><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r="1.4" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18" r="1.4" fill="currentColor" stroke="none" /></svg>;
    case "frame":
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.5-4.5" /></svg>;
    case "pillars":
      return <svg {...common}><path d="M4 21h16M6 21V10m4 11V10m4 11V10m4 11V10M3 10l9-6 9 6" /></svg>;
    case "proof":
      return <svg {...common}><path d="M12 3l7 3v6c0 4.6-3 8.2-7 9-4-.8-7-4.4-7-9V6l7-3z" /><path d="M9 12l2 2 4-4.2" /></svg>;
    case "investment":
      return <svg {...common}><path d="M12 3v18M7 7h10" /><path d="M4 7l3 6a3 3 0 006 0L10 7" /><path d="M14 7l3 6a3 3 0 006 0l-3-6" /></svg>;
    case "next":
      return <svg {...common}><rect x="3.5" y="5" width="17" height="15.5" rx="2.2" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M9 15.2l1.8 1.8L15.5 13" /></svg>;
    default:
      return null;
  }
}

const SLIDE_ACCENT: Record<DeckSlideKind, string> = {
  cover: "#8f7bff",
  agenda: "#7c93ff",
  frame: "#67a9ff",
  pillars: "#8f7bff",
  proof: "#5fd4a8",
  investment: "#ffc36b",
  next: "#5fd4a8",
};

function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <div style={{ display: "flex", gap: 6 }} aria-hidden>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          style={{
            width: index === current ? 16 : 6,
            height: 6,
            borderRadius: 3,
            background: index === current ? "#c4bdff" : "rgba(196,189,255,0.28)",
            transition: "width 220ms var(--ease, ease), background 220ms ease",
          }}
        />
      ))}
    </div>
  );
}

/** Conteúdo do slide varia por tipo: pilares viram cards em grade, prova vira selos — não apenas uma lista de texto repetida 7 vezes. */
function SlideBody({ slide, accent }: { slide: DeckSlide; accent: string }) {
  if (slide.kind === "pillars" && slide.bullets) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(slide.bullets.length, 3)}, minmax(0, 1fr))`, gap: 12, marginTop: 20 }}>
        {slide.bullets.map((bullet, index) => (
          <div
            key={bullet}
            style={{
              padding: "16px 14px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(143,123,255,0.22)",
            }}
          >
            <span
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 24, height: 24, borderRadius: "50%", fontSize: "0.72rem", fontWeight: 600,
                background: "rgba(143,123,255,0.18)", color: "#c4bdff", marginBottom: 10,
              }}
            >
              {index + 1}
            </span>
            <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.4, color: "rgba(233,230,255,0.92)" }}>{bullet}</p>
          </div>
        ))}
      </div>
    );
  }

  if (slide.kind === "proof" && slide.bullets) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
        {slide.bullets.map((bullet) => (
          <div key={bullet} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 999, background: "rgba(95,212,168,0.1)", border: "1px solid rgba(95,212,168,0.28)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5fd4a8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
            <span style={{ fontSize: "0.9rem", color: "rgba(233,230,255,0.92)" }}>{bullet}</span>
          </div>
        ))}
      </div>
    );
  }

  if (slide.kind === "investment") {
    return (
      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(255,195,107,0.12)", border: "1px solid rgba(255,195,107,0.32)", display: "flex", alignItems: "center", justifyContent: "center", color: "#ffc36b" }}>
          <SlideIcon kind="investment" size={26} />
        </div>
      </div>
    );
  }

  if (!slide.bullets) return null;
  return (
    <ul style={{ margin: "18px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
      {slide.bullets.map((bullet, index) => (
        <li key={bullet} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "1.0rem", color: "rgba(233,230,255,0.92)" }}>
          <span
            aria-hidden
            style={{
              flexShrink: 0, marginTop: 2, width: 20, height: 20, borderRadius: "50%",
              background: `${accent}26`, color: accent, fontSize: "0.68rem", fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {index + 1}
          </span>
          {bullet}
        </li>
      ))}
    </ul>
  );
}

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
  const [simulated, setSimulated] = useState(false);
  const [consent, setConsent] = useState<VideoChannelConsent>(INITIAL_CONSENT);
  const [stopping, setStopping] = useState(false);
  const [providerStopConfirmed, setProviderStopConfirmed] = useState(false);

  const callRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const commandIdRef = useRef<string | null>(null);
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
    const toolCallId = message.properties?.tool_call_id;
    if (!toolCallId || !["next_slide", "previous_slide", "go_to_slide"].includes(name)) return;

    // A mensagem vem do provider e pode conter instruções ou argumentos
    // adversariais. Não há grant/manifest/receipt verificável no browser,
    // logo ela não possui autoridade para modificar a cena local.
    call.sendAppMessage(
      {
        message_type: "conversation",
        event_type: "conversation.tool_result",
        conversation_id: conversationIdRef.current ?? message.conversation_id ?? "",
        properties: {
          tool_call_id: toolCallId,
          output: `Comando de cena recusado: a apresentação requer o bridge de cenas aprovado pelo servidor. Slide atual: ${slideIndexRef.current + 1} de ${currentDeck.slides.length}.`,
          status: "error",
        },
      },
      "*",
    );
  }, []);

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
    setProviderStopConfirmed(false);
    setPhase("starting");
    const commandId = crypto.randomUUID();
    void (async () => {
      const result = await startPresentationConversation(agentId, commandId, consent);
      if (result.simulated && result.deck) {
        // Modo demonstração: deck navegável manualmente, sem sala de vídeo.
        deckRef.current = result.deck;
        setDeck(result.deck);
        slideIndexRef.current = 0;
        setSlideIndex(0);
        setSimulated(true);
        setPhase("live");
        return;
      }
      if (!result.url || !result.deck) {
        setError(result.error ?? "Erro inesperado.");
        setPhase("idle");
        return;
      }
      const conversationUrl = result.url;
      if (!isTrustedTavusConversationUrl(conversationUrl)) {
        setError("A sala de vídeo retornou um endereço não confiável.");
        setPhase("idle");
        return;
      }
      deckRef.current = result.deck;
      conversationIdRef.current = result.conversationId;
      commandIdRef.current = commandId;
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
        await call.join({ url: conversationUrl });
        setPhase("live");
      } catch {
        setError("Não foi possível entrar na sala de vídeo. Verifique câmera e microfone e tente de novo.");
        setPhase("idle");
      }
    })();
  }, [agentId, attachTrack, consent, handleToolCall]);

  const disposeClientCall = useCallback(() => {
    const call = callRef.current;
    callRef.current = null;
    if (call) {
      void call.leave().catch(() => undefined).finally(() => {
        void call.destroy().catch(() => undefined);
      });
    }
  }, []);

  const leave = useCallback(async () => {
    if (simulated) {
      disposeClientCall();
      setPhase("ended");
      return;
    }
    const commandId = commandIdRef.current;
    if (commandId === null) {
      setError("Não encontramos a apresentação ativa para encerrar. Atualize a página antes de tentar de novo.");
      return;
    }

    setError(null);
    setStopping(true);
    try {
      const result = await stopPresentationConversation(agentId, commandId);
      if (!result.stopped) {
        setError(result.error ?? "Não foi possível confirmar o encerramento agora. Tente novamente.");
        return;
      }
      // Mantém a chamada e sua chave de idempotência até a parada remota ser
      // confirmada. Assim, uma falha de rede/provider não descarta o único
      // caminho seguro para o operador repetir o comando.
      commandIdRef.current = null;
      disposeClientCall();
      setProviderStopConfirmed(true);
      setPhase("ended");
    } catch {
      setError("Não foi possível confirmar o encerramento agora. Tente novamente.");
    } finally {
      setStopping(false);
    }
  }, [agentId, disposeClientCall, simulated]);

  useEffect(() => () => {
    // Navegação/fechamento de aba não oferece uma confirmação de provider;
    // não pode disparar um stop fire-and-forget que consuma o commandId sem
    // deixar feedback ou retry para o operador.
    disposeClientCall();
  }, [disposeClientCall]);

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
        <fieldset style={{ width: "100%", border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
          <legend style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text)", padding: 0 }}>
            Consentimento para esta apresentação
          </legend>
          <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", margin: 0 }}>
            Você falará com uma assistente virtual de IA. As confirmações são registradas por finalidade antes de uma sala de vídeo ser criada.
          </p>
          {[
            ["disclosure", "Li a identificação da IA e autorizo o processamento essencial desta apresentação."],
            ["recording", "Autorizo a gravação de áudio e vídeo desta apresentação."],
            ["transcription", "Autorizo a transcrição persistente da apresentação."],
            ["behavioralAnalysis", "Autorizo a análise comportamental declarada."],
            ["visualAnalysis", "Autorizo a análise visual declarada."],
          ].map(([key, label]) => {
            const consentKey = key as keyof VideoChannelConsent;
            const checked = consentKey === "disclosure"
              ? consent.disclosure && consent.essentialProcessing
              : consent[consentKey];
            return (
              <label key={key} style={{ display: "flex", alignItems: "flex-start", gap: 8, color: "var(--text-muted)", fontSize: "0.8rem", lineHeight: 1.4 }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setConsent((current) => consentKey === "disclosure"
                    ? { ...current, disclosure: event.target.checked, essentialProcessing: event.target.checked }
                    : { ...current, [consentKey]: event.target.checked })}
                />
                {label}
              </label>
            );
          })}
        </fieldset>
        {error && <p className="form-error" role="alert" style={{ margin: 0, width: "100%" }}>{error}</p>}
        <button type="button" className="btn btn-primary" onClick={start} disabled={phase === "starting" || !allConsentConfirmed(consent)} style={{ padding: "11px 20px" }}>
          {phase === "starting" ? "Montando a sala…" : "Iniciar apresentação"}
        </button>
      </section>
    );
  }

  if (phase === "ended") {
    return (
      <section className="card" style={{ marginTop: 16, padding: 16 }}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.88rem" }}>
          {providerStopConfirmed
            ? "O provider confirmou o pedido de encerramento da apresentação."
            : "Apresentação finalizada nesta tela."} <button type="button" className="btn" onClick={() => { setPhase("idle"); setDeck(null); setSimulated(false); setProviderStopConfirmed(false); }} style={{ marginLeft: 8 }}>Nova apresentação</button>
        </p>
      </section>
    );
  }

  const slide = deck?.slides[slideIndex];
  const accent = slide ? SLIDE_ACCENT[slide.kind] : "#8f7bff";

  return (
    <section className="card" style={{ marginTop: 16, padding: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div
          aria-live="polite"
          style={{
            position: "relative",
            overflow: "hidden",
            flex: "1 1 420px",
            minHeight: 380,
            borderRadius: 12,
            padding: "36px 40px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            background: "linear-gradient(160deg, #0d0e1c 0%, #161230 52%, #201a45 100%)",
            border: "1px solid rgba(129,120,255,0.25)",
          }}
        >
          <div
            aria-hidden
            style={{
              position: "absolute", inset: 0, pointerEvents: "none",
              backgroundImage: `radial-gradient(560px 320px at 88% -10%, ${accent}22, transparent 60%), radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)`,
              backgroundSize: "auto, 22px 22px",
              transition: "background-image 260ms ease",
            }}
          />
          {slide ? (
            <div style={{ position: "relative" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: slide.kind === "cover" ? 22 : 14 }}>
                <span
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: slide.kind === "cover" ? 52 : 36, height: slide.kind === "cover" ? 52 : 36,
                    borderRadius: "50%", background: `${accent}20`, border: `1px solid ${accent}45`, color: accent,
                    flexShrink: 0, transition: "all 220ms ease",
                  }}
                >
                  <SlideIcon kind={slide.kind} size={slide.kind === "cover" ? 26 : 18} />
                </span>
                <p style={{ margin: 0, fontSize: "0.72rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(196,189,255,0.7)" }}>
                  {deck?.title} · {slideIndex + 1}/{deck?.slides.length}
                </p>
              </div>
              <h2 style={{ margin: 0, fontSize: slide.kind === "cover" ? "2.15rem" : "1.55rem", lineHeight: 1.15, color: "#f4f2ff", letterSpacing: "-0.01em" }}>{slide.title}</h2>
              {slide.subtitle && <p style={{ margin: "12px 0 0", fontSize: "1.02rem", color: "rgba(226,222,255,0.85)" }}>{slide.subtitle}</p>}
              <SlideBody slide={slide} accent={accent} />
              {slide.note && (
                <p style={{ margin: "18px 0 0", fontSize: "0.78rem", color: "rgba(196,189,255,0.55)", display: "flex", alignItems: "center", gap: 6 }}>
                  <span aria-hidden style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(196,189,255,0.55)", flexShrink: 0 }} />
                  {slide.note}
                </p>
              )}
              {deck && deck.slides.length > 1 && (
                <div style={{ marginTop: 26 }}>
                  <ProgressDots total={deck.slides.length} current={slideIndex} />
                </div>
              )}
            </div>
          ) : (
            <p style={{ color: "rgba(226,222,255,0.7)" }}>Preparando os slides…</p>
          )}
        </div>

        <div style={{ flex: "0 1 280px", display: "flex", flexDirection: "column", gap: 10, minWidth: 240 }}>
          {simulated ? (
            <div
              role="note"
              style={{ width: "100%", aspectRatio: "3 / 4", borderRadius: 12, background: "#0c0c1c", border: "1px dashed rgba(129,120,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem" }}
            >
              Modo demonstração — sem provider de vídeo. Navegue o deck manualmente para revisar a apresentação de {agentName}.
            </div>
          ) : (
            <>
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
            </>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => goTo(slideIndexRef.current - 1)} disabled={stopping || slideIndex === 0} style={{ flex: 1 }}>
              ← Anterior
            </button>
            <button type="button" className="btn btn-primary" onClick={() => goTo(slideIndexRef.current + 1)} disabled={stopping || (deck !== null && slideIndex >= deck.slides.length - 1)} style={{ flex: 1 }}>
              Próximo →
            </button>
            {!simulated && (
              <button type="button" className="btn" onClick={toggleMute} disabled={stopping} style={{ flex: 1 }}>
                {muted ? "Ativar microfone" : "Silenciar"}
              </button>
            )}
            <button type="button" className="btn" onClick={leave} disabled={stopping} style={{ flex: 1, borderColor: "rgba(255,120,120,0.4)", color: "#ff9d9d" }}>
              {stopping ? "Confirmando encerramento…" : "Encerrar"}
            </button>
          </div>
          {error && <p className="form-error" role="alert" style={{ margin: 0 }}>{error}</p>}
          <p style={{ fontSize: "0.74rem", color: "var(--text-faint)", margin: 0 }}>
            {simulated
              ? "Modo demonstração — navegue o deck manualmente para revisar a apresentação."
              : `Navegue os slides manualmente. Comandos de cena originados pelo modelo permanecem bloqueados até receberem manifesto, geração e recibo validados pelo servidor. Libere câmera e microfone quando o navegador pedir; a sala encerra em 15 minutos.`}
          </p>
        </div>
      </div>
    </section>
  );
}
