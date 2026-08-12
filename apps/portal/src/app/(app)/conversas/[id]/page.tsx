import type { Metadata } from "next";
import Link from "next/link";

import { fetchConversationTranscript } from "@/lib/portal-data";

export const metadata: Metadata = { title: "Conversa — Axtro Digital Human OS" };

const SURFACE_LABELS: Record<string, string> = {
  chat: "Chat de teste",
  video: "Vídeo",
  meeting: "Reunião externa",
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let transcript;
  try {
    transcript = await fetchConversationTranscript(id);
  } catch {
    return (
      <div className="error-banner" role="alert">
        Não foi possível carregar esta conversa — ela pode não existir ou pertencer a outra conta.{" "}
        <Link href="/conversas" style={{ color: "inherit", textDecoration: "underline" }}>Voltar</Link>
      </div>
    );
  }

  return (
    <>
      <header style={{ marginBottom: 22 }}>
        <Link href="/conversas" style={{ color: "var(--accent)", fontSize: "0.84rem" }}>← Conversas</Link>
        <h1 style={{ fontSize: "1.4rem", marginTop: 8 }}>
          {transcript.agentName} · {SURFACE_LABELS[transcript.surface] ?? transcript.surface}
        </h1>
        <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: "0.86rem" }}>
          Início em {formatDateTime(transcript.startedAt)}
          {transcript.endedAt ? ` · encerrada em ${formatDateTime(transcript.endedAt)}` : " · em andamento"}
        </p>
      </header>

      {transcript.turns.length === 0 ? (
        <div className="empty-state">
          <div className="icon" aria-hidden="true">◈</div>
          <h3>Sem turnos registrados ainda</h3>
          <p>
            {transcript.surface === "chat"
              ? "Essa conversa ainda não tem mensagens."
              : "A transcrição chega quando a chamada termina — pode levar alguns instantes depois do encerramento."}
          </p>
        </div>
      ) : (
        <section className="card" style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 760 }}>
          {transcript.turns.map((turn, index) => (
            <div
              key={index}
              style={{
                alignSelf: turn.role === "user" ? "flex-end" : "flex-start",
                background: turn.role === "user" ? "var(--accent-soft)" : "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "9px 13px",
                maxWidth: "85%",
                fontSize: "0.9rem",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              <span className="sr-only">{turn.role === "user" ? "Cliente: " : `${transcript.agentName}: `}</span>
              {turn.content}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
