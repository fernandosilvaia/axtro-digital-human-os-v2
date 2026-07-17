"use client";

import { useState, useTransition } from "react";

import { startVideoConversation } from "@/lib/actions/video-conversation";

export function VideoCall({ agentId, agentName }: { agentId: string; agentName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setError(null);
    startTransition(async () => {
      const result = await startVideoConversation(agentId);
      if (result.url) setUrl(result.url);
      else setError(result.error ?? "Erro inesperado.");
    });
  }

  if (url) {
    return (
      <section className="card" style={{ marginTop: 16, padding: 12 }}>
        <iframe
          src={url}
          allow="camera; microphone; fullscreen; display-capture"
          style={{ width: "100%", height: 480, border: "none", borderRadius: 10, background: "#000" }}
          title={`Conversa em vídeo com ${agentName}`}
        />
        <p style={{ fontSize: "0.78rem", color: "var(--text-faint)", margin: "10px 4px 2px" }}>
          Libere câmera e microfone quando o navegador pedir. A chamada encerra sozinha em 10 minutos.
        </p>
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
