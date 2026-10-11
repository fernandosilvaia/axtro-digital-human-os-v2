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

import { useState } from "react";

import { startVideoConversation, stopVideoConversation, type VideoChannelConsent } from "@/lib/actions/video-conversation";

import { useCallLifecycle } from "./call-lifecycle";

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

// Id fixo e distinto do de presentation-room.tsx: as duas salas aparecem na mesma página.
const CONSENT_HINT_ID = "video-call-consent-hint";

export function VideoCall({ tenantId, agentId, agentName }: { tenantId: string; agentId: string; agentName: string }) {
  const [consent, setConsent] = useState<VideoChannelConsent>(INITIAL_CONSENT);
  const { phase, error, muted, stopping, providerStopConfirmed, storageReady, start, end, reset, toggleMute, remoteVideoRef, remoteAudioRef, localVideoRef } = useCallLifecycle({
    tenantId, agentId, mode: "video", consent, startAction: startVideoConversation, stopAction: stopVideoConversation,
  });

  if (phase === "recovery") {
    return <section className="card" style={{ marginTop: 16 }}>
      <p role="status">Há uma intenção de chamada pendente nesta aba. Confirme o pedido de encerramento antes de iniciar outra conversa.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="button" className="btn" onClick={end} disabled={stopping}>{stopping ? "Confirmando encerramento…" : "Tentar encerrar chamada pendente"}</button>
    </section>;
  }

  if (phase === "idle" || phase === "starting") {
    const consentMissing = !allConsentConfirmed(consent);
    return (
      <section className="card" style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ fontSize: "0.95rem", marginBottom: 4 }}>Conversa em vídeo ao vivo 🎥</h3>
          <p style={{ color: "var(--text-muted)", fontSize: "0.84rem", margin: 0 }}>
            {agentName} aparece em vídeo, te escuta e conduz a venda por voz, como numa reunião real.
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
        <button
          type="button"
          className="btn btn-primary"
          onClick={start}
          disabled={!storageReady || phase === "starting" || consentMissing}
          aria-describedby={consentMissing ? CONSENT_HINT_ID : undefined}
          style={{ padding: "11px 20px" }}
        >
          {phase === "starting" ? "Preparando a sala…" : "Iniciar conversa em vídeo"}
        </button>
        {consentMissing && (
          <p id={CONSENT_HINT_ID} style={{ margin: 0, width: "100%", color: "var(--text-muted)", fontSize: "0.78rem" }}>
            Marque as cinco confirmações para iniciar.
          </p>
        )}
      </section>
    );
  }

  if (phase === "ended") {
    return (
      <section className="card" style={{ marginTop: 16, padding: 16 }}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.88rem" }}>
          {providerStopConfirmed
            ? "O provider confirmou o pedido de encerramento da conversa."
            : "Conversa finalizada nesta tela."} <button type="button" className="btn" onClick={reset} style={{ marginLeft: 8 }}>Nova conversa</button>
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
