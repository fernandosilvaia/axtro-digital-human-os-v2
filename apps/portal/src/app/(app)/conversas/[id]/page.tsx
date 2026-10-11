import type { Metadata } from "next";
import Link from "next/link";

import { formatDateTime } from "@/lib/format-date";
import { fetchConversationTranscript, fetchTenantOverview } from "@/lib/portal-data";
import { SITE_NAME } from "@/lib/site";

export const metadata: Metadata = { title: `Conversa, ${SITE_NAME}` };

const SURFACE_LABELS: Record<string, string> = {
  chat: "Chat de teste",
  video: "Vídeo",
  meeting: "Reunião externa",
};

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let transcript;
  try {
    transcript = await fetchConversationTranscript(id);
  } catch {
    return (
      <div className="error-banner" role="alert">
        Não foi possível carregar esta conversa: ela pode não existir ou pertencer a outra conta.{" "}
        <Link href="/conversas" style={{ color: "inherit", textDecoration: "underline" }}>Voltar</Link>
      </div>
    );
  }

  const overview = await fetchTenantOverview().catch(() => null);
  const isAdmin = overview?.role === "tenant_admin";
  const timeZone = overview?.tenant?.default_timezone || "America/Sao_Paulo";

  return (
    <>
      <header style={{ marginBottom: 22, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <Link href="/conversas" style={{ color: "var(--accent)", fontSize: "0.84rem" }}>← Conversas</Link>
          <h1 style={{ fontSize: "1.4rem", marginTop: 8 }}>
            {transcript.agentName} · {SURFACE_LABELS[transcript.surface] ?? transcript.surface}
          </h1>
          <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: "0.86rem" }}>
            Início em {formatDateTime(transcript.startedAt, timeZone)}
            {transcript.endedAt ? ` · encerrada em ${formatDateTime(transcript.endedAt, timeZone)}` : " · em andamento"}
          </p>
        </div>
        {isAdmin && (
          // Desde a migration 0059 a exclusão direta de uma conversa está desligada:
          // o único caminho é o pedido formal de governança em Configurações.
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
            <Link
              href="/configuracoes#governanca-de-dados"
              className="btn btn-ghost"
              aria-describedby="transcript-data-request-note"
              style={{ padding: "6px 12px", fontSize: "0.82rem" }}
            >
              Pedir exclusão de dados
            </Link>
            <span id="transcript-data-request-note" style={{ color: "var(--text-muted)", fontSize: "0.72rem", maxWidth: 240, textAlign: "right" }}>
              Conversas não são excluídas uma a uma. O pedido é feito em Configurações.
            </span>
          </div>
        )}
      </header>

      {transcript.turns.length === 0 ? (
        <div className="empty-state">
          <div className="icon" aria-hidden="true">◈</div>
          <h3>Sem turnos registrados ainda</h3>
          <p>
            {transcript.surface === "chat"
              ? "Essa conversa ainda não tem mensagens."
              : "A transcrição chega quando a chamada termina, pode levar alguns instantes depois do encerramento."}
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
