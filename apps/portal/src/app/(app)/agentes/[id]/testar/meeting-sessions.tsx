import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";

/**
 * Painel das reuniões externas deste agente. A RPC (0021) e o webhook de
 * status do Recall.ai já existiam em produção — mas nenhuma UI lia a lista:
 * quem agendava um bot fechava a aba e perdia toda a visibilidade (achado
 * "RPC órfã" da auditoria 2026-08-02). Server component, refletindo o status
 * mais recente a cada carregamento da página.
 */

interface MeetingSessionRow {
  readonly id: string;
  readonly agentId: string;
  readonly meetingUrl: string;
  readonly status: string;
  readonly createdAt: string;
  readonly endedAt: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  created: "Criada",
  joining: "Entrando",
  in_call: "Na reunião",
  ended: "Encerrada",
  failed: "Falhou",
};

function formatInZone(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function meetingHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 40);
  }
}

export async function MeetingSessions({ agentId, timeZone }: { agentId: string; timeZone: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_list_meeting_bot_sessions");
  if (error) {
    trackError("portal_list_meeting_bot_sessions_failed", error, { agent_id: agentId });
    return null; // Painel é informativo — falha de leitura não polui a página de teste.
  }
  const sessions = (Array.isArray(data) ? (data as MeetingSessionRow[]) : []).filter(
    (session) => session.agentId === agentId,
  ).slice(0, 8);
  if (sessions.length === 0) return null;

  return (
    <section className="card" style={{ marginTop: 16 }} aria-labelledby="reunioes-externas">
      <h3 id="reunioes-externas" style={{ fontSize: "0.95rem", marginBottom: 4 }}>Reuniões externas deste agente</h3>
      <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0 0 10px" }}>
        Status atualizado pelo provider de reuniões (horários no fuso {timeZone}). Recarregue a página para ver o mais recente.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Reunião</th>
              <th>Status</th>
              <th>Criada</th>
              <th>Encerrada</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td className="mono" style={{ fontSize: "0.8rem" }}>{meetingHost(session.meetingUrl)}</td>
                <td>{STATUS_LABEL[session.status] ?? session.status}</td>
                <td style={{ fontSize: "0.82rem" }}>{formatInZone(session.createdAt, timeZone)}</td>
                <td style={{ fontSize: "0.82rem" }}>{session.endedAt ? formatInZone(session.endedAt, timeZone) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
