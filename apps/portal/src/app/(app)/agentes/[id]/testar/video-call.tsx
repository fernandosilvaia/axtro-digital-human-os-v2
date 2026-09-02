"use client";

/**
 * Sala de vídeo livre (sem deck). Espelha o transporte de "call object" do
 * Daily que presentation-room.tsx já usa (ADR-041) -- antes deste arquivo
 * embutia a Tavus num frame HTML puro, que estruturalmente não expõe o data
 * channel do Daily: nenhuma tool call de negócio (register_lead/
 * propose_meeting_slots/confirm_meeting_slot) alcançava o servidor numa
 * chamada em modo vídeo livre, mesmo com o funil pronto do outro lado
 * (business-action-tool-call.ts). Mensagens de tool do provider continuam
 * tratadas como não confiáveis no navegador: sem deck aqui, uma tool de cena
 * (next_slide/previous_slide/go_to_slide) nunca tem o que fazer e é sempre
 * recusada, mesmo padrão de presentation-room.tsx.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { isTrustedTavusConversationUrl } from "@axtro/provider-tavus";

import { startVideoConversation, stopVideoConversation, type VideoChannelConsent } from "@/lib/actions/video-conversation";
import { classifyToolCallName } from "@/lib/runtime/tool-call-names";

import { dispatchToolCall, type ToolCallMessage } from "./tool-call-dispatcher";

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

type DailyCall = {
  join(options: { url: string }): Promise<unknown>;
  leave(): Promise<unknown>;
  destroy(): Promise<unknown>;
  setLocalAudio(enabled: boolean): unknown;
  sendAppMessage(message: unknown, to?: string): unknown;
  on(event: string, handler: (event: never) => void): unknown;
};

export function VideoCall({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [phase, setPhase] = useState<"idle" | "starting" | "live" | "ended">("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [consent, setConsent] = useState<VideoChannelConsent>(INITIAL_CONSENT);
  const [stopping, setStopping] = useState(false);
  const [providerStopConfirmed, setProviderStopConfirmed] = useState(false);

  const callRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const commandIdRef = useRef<string | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  const handleToolCall = useCallback((message: ToolCallMessage) => {
    const call = callRef.current;
    if (!call) return;
    const name = message.properties?.name ?? "";
    const toolCallId = message.properties?.tool_call_id;
    if (!toolCallId) return;

    const category = classifyToolCallName(name);

    if (category === "scene") {
      // Este modo nunca teve deck: uma tool de cena aqui não tem o que
      // fazer, e (igual a presentation-room.tsx) o navegador não tem
      // autoridade pra atender um comando de cena sem manifesto/geração/
      // recibo verificados pelo servidor.
      call.sendAppMessage(
        {
          message_type: "conversation",
          event_type: "conversation.tool_result",
          conversation_id: conversationIdRef.current ?? message.conversation_id ?? "",
          properties: {
            tool_call_id: toolCallId,
            output: "Comando de cena recusado: esta chamada é em modo vídeo livre, sem apresentação de slides.",
            status: "error",
          },
        },
        "*",
      );
      return;
    }

    if (category === "business_action") {
      // ADR-041: register_lead/propose_meeting_slots/confirm_meeting_slot
      // vão até a Server Action pelo mesmo dispatcher compartilhado que
      // presentation-room.tsx já usa. Sem commandId (a chamada ainda não
      // terminou de subir) não há uma chamada viva pra resolver do outro
      // lado -- nada seguro a responder.
      const commandId = commandIdRef.current;
      if (commandId === null) return;
      void dispatchToolCall({ agentId, commandId, mode: "video", message }).then((result) => {
        const activeCall = callRef.current;
        if (result === null || !activeCall) return;
        activeCall.sendAppMessage(
          {
            message_type: "conversation",
            event_type: "conversation.tool_result",
            conversation_id: conversationIdRef.current ?? message.conversation_id ?? "",
            properties: {
              tool_call_id: result.toolCallId,
              output: result.output,
              status: result.status,
            },
          },
          "*",
        );
      });
      return;
    }

    // category === "unknown": nenhum tool_result é enviado, igual ao comportamento anterior a esta migração.
  }, [agentId]);

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
      const result = await startVideoConversation(agentId, commandId, consent);
      if (!result.url) {
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
      conversationIdRef.current = result.conversationId;
      commandIdRef.current = commandId;
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

  const end = useCallback(async () => {
    const commandId = commandIdRef.current;
    if (commandId === null) {
      setError("Não encontramos a chamada ativa para encerrar. Atualize a página antes de tentar de novo.");
      return;
    }

    setError(null);
    setStopping(true);
    try {
      const result = await stopVideoConversation(agentId, commandId);
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
  }, [agentId, disposeClientCall]);

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
          <h3 style={{ fontSize: "0.95rem", marginBottom: 4 }}>Conversa em vídeo ao vivo 🎥</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.84rem", margin: 0 }}>
            {agentName} aparece em vídeo, te escuta e conduz a venda por voz — como numa reunião real.
          </p>
        </div>
        {providerStopConfirmed && (
          <p role="status" style={{ margin: 0, width: "100%", color: "var(--text-muted)", fontSize: "0.82rem" }}>
            O provider confirmou o pedido de encerramento da conversa.
          </p>
        )}
        <fieldset style={{ width: "100%", border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
          <legend style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--text)", padding: 0 }}>
            Consentimento para esta demonstração
          </legend>
          <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", margin: 0 }}>
            Você falará com uma assistente virtual de IA. As confirmações abaixo são registradas para esta sessão e podem ser revogadas antes de uma nova chamada.
          </p>
          {[
            ["disclosure", "Li a identificação da IA e autorizo o processamento essencial para conduzir esta demonstração."],
            ["recording", "Autorizo a gravação de áudio e vídeo desta demonstração."],
            ["transcription", "Autorizo a transcrição persistente da conversa para histórico e acompanhamento."],
            ["behavioralAnalysis", "Autorizo a análise comportamental declarada para melhorar a condução da conversa."],
            ["visualAnalysis", "Autorizo a análise visual declarada durante a demonstração."],
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
          {phase === "starting" ? "Preparando a sala…" : "Iniciar conversa em vídeo"}
        </button>
      </section>
    );
  }

  if (phase === "ended") {
    return (
      <section className="card" style={{ marginTop: 16, padding: 16 }}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.88rem" }}>
          {providerStopConfirmed
            ? "O provider confirmou o pedido de encerramento da conversa."
            : "Conversa finalizada nesta tela."} <button type="button" className="btn" onClick={() => { setPhase("idle"); setProviderStopConfirmed(false); }} style={{ marginLeft: 8 }}>Nova conversa</button>
        </p>
      </section>
    );
  }

  return (
    <section className="card" style={{ marginTop: 16, padding: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          style={{ flex: "1 1 420px", minHeight: 380, width: "100%", objectFit: "cover", borderRadius: 12, background: "#000" }}
          aria-label={`Vídeo de ${agentName}`}
        />
        <audio ref={remoteAudioRef} autoPlay />
        <div style={{ flex: "0 1 200px", display: "flex", flexDirection: "column", gap: 10, minWidth: 160 }}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 8, background: "#111" }}
            aria-label="Sua câmera"
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={toggleMute} disabled={stopping} style={{ flex: 1 }}>
              {muted ? "Ativar microfone" : "Silenciar"}
            </button>
            <button type="button" className="btn" onClick={end} disabled={stopping} style={{ flex: 1, borderColor: "rgba(255,120,120,0.4)", color: "#ff9d9d" }}>
              {stopping ? "Confirmando encerramento…" : "Encerrar"}
            </button>
          </div>
          {error && <p className="form-error" role="alert" style={{ margin: 0 }}>{error}</p>}
          <p style={{ fontSize: "0.74rem", color: "var(--text-faint)", margin: 0 }}>
            Libere câmera e microfone quando o navegador pedir; a sala encerra em 10 minutos.
          </p>
        </div>
      </div>
    </section>
  );
}
