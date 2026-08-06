import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { StatusBadge } from "@/components/status-badge";

import { ExternalMeeting } from "./external-meeting";
import { MeetingSessions } from "./meeting-sessions";
import { PresentationRoom } from "./presentation-room";
import { PreviewChat } from "./preview-chat";
import { VideoCall } from "./video-call";

export const metadata: Metadata = { title: "Testar agente — Axtro Digital Human OS" };

export default async function AgentPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Falha transitória da RPC não pode virar a tela de erro genérica do Next
  // (mesmo padrão de banner das páginas irmãs; auditoria 2026-08-02).
  let agents;
  let overview;
  try {
    [agents, overview] = await Promise.all([fetchAgents(), fetchTenantOverview()]);
  } catch {
    return (
      <div className="error-banner" role="alert">
        Não foi possível carregar o agente agora. Recarregue a página; se persistir, contate o suporte.
      </div>
    );
  }
  const agent = agents.find((candidate) => candidate.id === id);
  if (!agent) notFound();
  // Fuso da CONTA pro agendamento/painel de reuniões — "15:00" tem que ser
  // 15:00 no relógio do dono da conta (auditoria 2026-08-02).
  const timeZone = overview.tenant?.default_timezone ?? "America/New_York";

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
          Chat e salas de vídeo são sandbox — não alcançam clientes reais. Já a seção de reunião
          externa coloca o agente numa reunião de verdade: use com um link seu para testar.
          O agente se apresenta como IA e responde fatos apenas com base nas fontes de conhecimento ativas da conta;
          sem fontes, ele não cita preços nem condições.
        </p>
      </header>
      <ExternalMeeting agentId={agent.id} agentName={agent.name} timeZone={timeZone} />
      <MeetingSessions agentId={agent.id} timeZone={timeZone} />
      <PresentationRoom agentId={agent.id} agentName={agent.name} />
      <VideoCall agentId={agent.id} agentName={agent.name} />
      <div style={{ height: 16 }} />
      <PreviewChat agentId={agent.id} agentName={agent.name} />
    </>
  );
}
