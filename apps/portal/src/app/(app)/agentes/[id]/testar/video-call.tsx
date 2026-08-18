"use client";

import { useState, useTransition } from "react";

import { isTrustedTavusConversationUrl } from "@axtro/provider-tavus";

import { startVideoConversation, stopVideoConversation, type VideoChannelConsent } from "@/lib/actions/video-conversation";

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

export function VideoCall({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerStopConfirmed, setProviderStopConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [consent, setConsent] = useState<VideoChannelConsent>(INITIAL_CONSENT);
  const [pending, startTransition] = useTransition();
  const [stopping, startStopTransition] = useTransition();

  function start() {
    setError(null);
    setProviderStopConfirmed(false);
    const commandId = crypto.randomUUID();
    startTransition(async () => {
      const result = await startVideoConversation(agentId, commandId, consent);
      if (isTrustedTavusConversationUrl(result.url)) {
        setUrl(result.url);
        setActiveCommandId(commandId);
      } else {
        setError(result.url ? "A sala de vídeo retornou um endereço não confiável." : (result.error ?? "Erro inesperado."));
      }
    });
  }

  function end() {
    const commandId = activeCommandId;
    if (commandId === null) return;
    setError(null);
    startStopTransition(async () => {
      try {
        const result = await stopVideoConversation(agentId, commandId);
        if (!result.stopped) {
          setError(result.error ?? "Não foi possível confirmar o encerramento agora. Tente novamente.");
          return;
        }
        // A URL e o commandId só saem da UI depois da confirmação do
        // provider. Em uma falha transitória o mesmo gesto humano continua
        // disponível para retry com a mesma chave de idempotência.
        setProviderStopConfirmed(true);
        setUrl(null);
        setActiveCommandId(null);
      } catch {
        setError("Não foi possível confirmar o encerramento agora. Tente novamente.");
      }
    });
  }

  async function copyRoomLink(roomUrl: string) {
    try {
      await navigator.clipboard.writeText(roomUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard bloqueado (permissão/contexto): o link segue disponível em "Abrir em nova aba".
    }
  }

  const trustedUrl = isTrustedTavusConversationUrl(url) ? url : null;
  if (trustedUrl) {
    return (
      <section className="card" style={{ marginTop: 16, padding: 12 }}>
        <iframe
          src={trustedUrl}
          allow="camera; microphone; fullscreen"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          referrerPolicy="no-referrer"
          style={{ width: "100%", height: 480, border: "none", borderRadius: 10, background: "#000" }}
          title={`Conversa em vídeo com ${agentName}`}
        />
        {error && <p className="form-error" role="alert" style={{ margin: "10px 4px 0" }}>{error}</p>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "10px 4px 2px" }}>
          <p style={{ fontSize: "0.78rem", color: "var(--text-faint)", margin: 0, flex: 1, minWidth: 220 }}>
            Libere câmera e microfone quando o navegador pedir. Ao solicitar o encerramento, esta tela aguarda a confirmação do provider.
          </p>
          {/* A sala é uma URL comum do provider: dá pra testar do celular ou
              chamar um colega pra avaliar — não precisa ficar presa ao iframe. */}
          <button type="button" className="btn" onClick={() => copyRoomLink(trustedUrl)} style={{ padding: "7px 12px", fontSize: "0.8rem" }}>
            {copied ? "Link copiado ✓" : "Copiar link da sala"}
          </button>
          <a href={trustedUrl} target="_blank" rel="noreferrer" className="btn" style={{ padding: "7px 12px", fontSize: "0.8rem" }}>
            Abrir em nova aba
          </a>
          <button type="button" className="btn" onClick={end} disabled={stopping} style={{ padding: "7px 12px", fontSize: "0.8rem" }}>
            {stopping ? "Confirmando encerramento…" : "Encerrar conversa"}
          </button>
        </div>
      </section>
    );
  }

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
      <button type="button" className="btn btn-primary" onClick={start} disabled={pending || !allConsentConfirmed(consent)} style={{ padding: "11px 20px" }}>
        {pending ? "Preparando a sala…" : "Iniciar conversa em vídeo"}
      </button>
    </section>
  );
}
