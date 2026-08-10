import type { Metadata } from "next";
import Link from "next/link";

import { fetchConversationTranscripts } from "@/lib/portal-data";

export const metadata: Metadata = { title: "Conversas — Axtro Digital Human OS" };

const SURFACE_LABELS: Record<string, string> = {
  chat: "Chat de teste",
  video: "Vídeo",
  meeting: "Reunião externa",
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export default async function ConversationsPage() {
  let transcripts;
  try {
    transcripts = await fetchConversationTranscripts();
  } catch {
    return (
      <div className="error-banner" role="alert">
        Não foi possível carregar o histórico de conversas agora. Recarregue a página; se persistir, contate o suporte.
      </div>
    );
  }

  return (
    <>
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: "1.4rem" }}>Conversas</h1>
        <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: "0.9rem" }}>
          Histórico das conversas conduzidas pelos seus agentes — chat de teste, vídeo e reunião externa.
        </p>
      </header>

      {transcripts.length === 0 ? (
        <div className="empty-state">
          <div className="icon" aria-hidden="true">◈</div>
          <h3>Nenhuma conversa registrada ainda</h3>
          <p>
            Assim que um agente conduzir uma conversa — no chat de teste, numa sala de vídeo ou numa
            reunião externa — ela aparece aqui pra você revisar.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Agente</th>
                  <th>Tipo</th>
                  <th>Turnos</th>
                  <th>Início</th>
                  <th>Encerrada</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {transcripts.map((transcript) => (
                  <tr key={transcript.id}>
                    <td>{transcript.agentName}</td>
                    <td>{SURFACE_LABELS[transcript.surface] ?? transcript.surface}</td>
                    <td className="mono">{transcript.turnCount}</td>
                    <td>{formatDateTime(transcript.startedAt)}</td>
                    <td>{transcript.endedAt ? formatDateTime(transcript.endedAt) : "—"}</td>
                    <td>
                      <Link href={`/conversas/${transcript.id}`} className="btn btn-ghost" style={{ padding: "6px 12px", fontSize: "0.82rem" }}>
                        Ver
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
