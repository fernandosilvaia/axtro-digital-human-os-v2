import type { Metadata } from "next";

import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { StatusBadge } from "@/components/status-badge";

import { AgentStatusToggle } from "./agent-status-toggle";
import { AgentDeleteButton } from "./agent-delete-button";
import { CreateAgentForm } from "./create-agent-form";

export const metadata: Metadata = { title: "Agentes — Axtro Digital Human OS" };

const ROLE_TYPE_LABELS: Record<string, string> = {
  sales: "Sales Closer",
  sales_closer: "Sales Closer",
  presenter: "Apresentador",
};

export default async function AgentsPage() {
  let agents;
  let isAdmin = false;
  try {
    const [agentRows, overview] = await Promise.all([fetchAgents(), fetchTenantOverview()]);
    agents = agentRows;
    isAdmin = overview.role === "tenant_admin";
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
            {isAdmin
              ? "Crie o primeiro agente como rascunho abaixo e ative quando quiser: o cérebro de vendas e as fontes de conhecimento da conta já ficam disponíveis no ambiente de teste."
              : "Nenhum agente foi criado nesta conta ainda. Peça a um administrador para criar o primeiro rascunho."}
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
                  <th aria-label="Ações"></th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id}>
                    <td>{agent.name}</td>
                    <td>{ROLE_TYPE_LABELS[agent.role_type] ?? agent.role_type}</td>
                    <td><StatusBadge status={agent.status} /></td>
                    <td>{new Date(agent.created_at).toLocaleDateString("pt-BR")}</td>
                    <td style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <a className="btn btn-ghost" href={`/agentes/${agent.id}/testar`} style={{ padding: "5px 11px", fontSize: "0.8rem" }}>
                        Testar
                      </a>
                      {isAdmin && <AgentStatusToggle agentId={agent.id} status={agent.status} />}
                      {isAdmin && agent.status === "draft" && <AgentDeleteButton agentId={agent.id} agentName={agent.name} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isAdmin && (
        <section className="card" style={{ marginTop: 16 }} aria-labelledby="novo-agente">
          <CreateAgentForm />
        </section>
      )}
    </>
  );
}
