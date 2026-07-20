import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchAgents } from "@/lib/portal-data";
import { StatusBadge } from "@/components/status-badge";

import { PresentationRoom } from "./presentation-room";
import { PreviewChat } from "./preview-chat";
import { VideoCall } from "./video-call";

export const metadata: Metadata = { title: "Testar agente — Axtro Digital Human OS" };

export default async function AgentPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agents = await fetchAgents();
  const agent = agents.find((candidate) => candidate.id === id);
  if (!agent) notFound();

  return (
    <>
      <header style={{ marginBottom: 18 }}>
        <p style={{ margin: "0 0 6px", fontSize: "0.82rem" }}>
          <a href="/agentes" style={{ color: "var(--accent)" }}>← Agentes</a>
        </p>
        <h1 style={{ fontSize: "1.4rem", display: "flex", alignItems: "center", gap: 10 }}>
          Testar {agent.name} <StatusBadge status={agent.status} />
        </h1>
        <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: "0.9rem" }}>
          Sandbox de conversa em texto — nada aqui alcança clientes reais nem executa ações externas.
          O agente se apresenta como IA e responde fatos apenas com base nas fontes de conhecimento ativas da conta;
          sem fontes, ele não cita preços nem condições.
        </p>
      </header>
      <PresentationRoom agentId={agent.id} agentName={agent.name} />
      <VideoCall agentId={agent.id} agentName={agent.name} />
      <div style={{ height: 16 }} />
      <PreviewChat agentId={agent.id} agentName={agent.name} />
    </>
  );
}
