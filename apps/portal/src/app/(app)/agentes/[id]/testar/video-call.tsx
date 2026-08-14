"use client";

import { useState, useTransition } from "react";

import { isTrustedTavusConversationUrl } from "@axtro/provider-tavus";

import { startVideoConversation } from "@/lib/actions/video-conversation";

export function VideoCall({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function start() {
    setError(null);
    const commandId = crypto.randomUUID();
    startTransition(async () => {
      const result = await startVideoConversation(agentId, commandId);
      if (isTrustedTavusConversationUrl(result.url)) setUrl(result.url);
      else setError(result.url ? "A sala de vídeo retornou um endereço não confiável." : (result.error ?? "Erro inesperado."));
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "10px 4px 2px" }}>
          <p style={{ fontSize: "0.78rem", color: "var(--text-faint)", margin: 0, flex: 1, minWidth: 220 }}>
            Libere câmera e microfone quando o navegador pedir. A chamada encerra sozinha em 10 minutos.
          </p>
          {/* A sala é uma URL comum do provider: dá pra testar do celular ou
              chamar um colega pra avaliar — não precisa ficar presa ao iframe. */}
          <button type="button" className="btn" onClick={() => copyRoomLink(trustedUrl)} style={{ padding: "7px 12px", fontSize: "0.8rem" }}>
            {copied ? "Link copiado ✓" : "Copiar link da sala"}
          </button>
          <a href={trustedUrl} target="_blank" rel="noreferrer" className="btn" style={{ padding: "7px 12px", fontSize: "0.8rem" }}>
            Abrir em nova aba
          </a>
          <button type="button" className="btn" onClick={() => setUrl(null)} style={{ padding: "7px 12px", fontSize: "0.8rem" }}>
            Encerrar conversa
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
      {error && <p className="form-error" role="alert" style={{ margin: 0, width: "100%" }}>{error}</p>}
      <button type="button" className="btn btn-primary" onClick={start} disabled={pending} style={{ padding: "11px 20px" }}>
        {pending ? "Preparando a sala…" : "Iniciar conversa em vídeo"}
      </button>
    </section>
  );
}
