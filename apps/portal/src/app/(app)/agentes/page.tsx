import type { Metadata } from "next";

import { fetchAgents } from "@/lib/portal-data";
import { StatusBadge } from "@/components/status-badge";

export const metadata: Metadata = { title: "Agentes — Axtro Digital Human OS" };

const ROLE_TYPE_LABELS: Record<string, string> = {
  sales_closer: "Sales Closer",
  presenter: "Apresentador",
};

export default async function AgentsPage() {
  let agents;
  try {
    agents = await fetchAgents();
  } catch {
    return (
      <div className="error-banner" role="alert">
        Não foi possível carregar seus agentes agora. Recarregue a página; se persistir, contate o suporte.
      </div>
    );
  }

  return (
    <>
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: "1.4rem" }}>Agentes</h1>
        <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: "0.9rem" }}>
          Apresentadores digitais da sua conta — cada um com papel, políticas e provedores próprios.
        </p>
      </header>

      {agents.length === 0 ? (
        <div className="empty-state">
          <div className="icon" aria-hidden="true">◇</div>
          <h3>Nenhum agente ainda</h3>
          <p>
            A criação de agentes é liberada quando os provedores de voz e avatar forem conectados à
            plataforma. A estrutura da sua conta já está pronta para recebê-los.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Papel</th>
                  <th>Status</th>
                  <th>Criado em</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td>{agent.name}</td>
                    <td>{ROLE_TYPE_LABELS[agent.role_type] ?? agent.role_type}</td>
                    <td><StatusBadge status={agent.status} /></td>
                    <td>{new Date(agent.created_at).toLocaleDateString("pt-BR")}</td>
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
