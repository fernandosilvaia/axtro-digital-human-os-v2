import type { Metadata } from "next";
import Link from "next/link";

import { formatDateTime, formatLongDate } from "@/lib/format-date";
import {
  fetchConversationTranscripts,
  fetchTenantOverview,
  fetchUsageSummary,
  type UsageSummary,
} from "@/lib/portal-data";
import { StatusBadge } from "@/components/status-badge";

export const metadata: Metadata = { title: "Visão geral — Axtro Closer AI Human" };

const METRICS = [
  { key: "agents", label: "Agentes configurados", hint: "Presenças digitais sob controle da equipe" },
  { key: "sessions", label: "Sessões registradas", hint: "Interações registradas pela operação" },
  { key: "knowledge_sources", label: "Fontes autorizadas", hint: "Contexto liberado para recuperação" },
  { key: "contacts", label: "Contatos", hint: "Perfis de contato ativos" },
] as const;

const DAILY_TOKEN_CAP = 500_000;

const SURFACE_LABELS: Record<string, string> = {
  chat: "Chat de teste",
  video: "Vídeo",
  meeting: "Reunião externa",
};

type ReadinessState = "done" | "pending" | "unknown";

function formatUsd(value: number): string {
  return `US$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

const USAGE_SERVICE_LABELS: Record<string, string> = {
  "portal.agent_preview": "Chat de teste dos agentes",
  "portal.knowledge_embedding": "Ingestão de conhecimento",
  "portal.knowledge_retrieval": "Busca de conhecimento (RAG)",
  "portal.video_conversation": "Conversas em vídeo",
  "portal.meeting_bot_session": "Reuniões externas",
};

export default async function DashboardPage() {
  const [overviewResult, usageResult, transcriptsResult] = await Promise.allSettled([
    fetchTenantOverview(),
    fetchUsageSummary(),
    fetchConversationTranscripts(undefined, 4),
  ]);

  if (overviewResult.status === "rejected") {
    return (
      <section className="error-banner" role="alert" aria-labelledby="dashboard-indisponivel">
        <h1 id="dashboard-indisponivel">A central da operação está temporariamente indisponível.</h1>
        <p>Não exibimos etapas ou métricas parciais quando não conseguimos confirmar os dados da conta. Recarregue a página; se persistir, contate o suporte.</p>
      </section>
    );
  }

  const overview = overviewResult.value;
  const usage: UsageSummary | null = usageResult.status === "fulfilled" ? usageResult.value : null;
  const transcripts = transcriptsResult.status === "fulfilled" ? transcriptsResult.value : null;

  const tenant = overview.tenant;
  const counts = overview.counts;
  const timeZone = tenant?.default_timezone ?? "America/Sao_Paulo";
  const readiness = [
    {
      label: "Primeiro agente configurado",
      state: readinessState(counts ? counts.agents > 0 : null),
      href: "/agentes",
      action: "Configurar agente",
    },
    {
      label: "Conhecimento autorizado",
      state: readinessState(counts ? counts.knowledge_sources > 0 : null),
      href: "/conhecimento",
      action: "Adicionar contexto",
    },
    {
      label: "Primeira conversa registrada",
      state: readinessState(transcripts ? transcripts.length > 0 : null),
      href: "/conversas",
      action: "Abrir conversas",
    },
  ] as const;
  const completedReadiness = readiness.filter((item) => item.state === "done").length;
  const unverifiedReadiness = readiness.filter((item) => item.state === "unknown").length;
  const readinessPercent = Math.round((completedReadiness / readiness.length) * 100);
  const nextAction = readiness.find((item) => item.state === "pending") ?? {
    label: "Revisar conversas registradas",
    href: "/conversas",
    action: "Abrir conversas",
  };
  const nextActionDescription = readiness.some((item) => item.state === "pending")
    ? "Conclua a etapa abaixo para deixar a próxima conversa mais bem preparada."
    : unverifiedReadiness > 0
      ? "Há dados que não puderam ser verificados agora. Revise as conversas enquanto a central se reconecta."
      : "A preparação essencial está confirmada. Use o histórico para transformar cada conversa em próximo passo.";
  const readinessSummary = unverifiedReadiness > 0
    ? `${completedReadiness} etapa(s) confirmada(s); ${unverifiedReadiness} não verificada(s)`
    : `${completedReadiness}/${readiness.length} etapas concluídas`;

  return (
    <>
      <header className="workspace-hero">
        <div>
          <span className="workspace-eyebrow">Central de operação / conversas</span>
          <h1>Central da sua operação de conversa.</h1>
          <p>
            {tenant ? tenant.legal_name : "Sua conta"} <span className="workspace-divider">/</span> contexto, presença e histórico em um só lugar
          </p>
        </div>
        {tenant && (
          <div className="workspace-status">
            <span className="workspace-status-label">Status da conta</span>
            <StatusBadge status={tenant.status} />
          </div>
        )}
      </header>

      <div className="grid grid-4 workspace-metrics" style={{ marginBottom: 24 }}>
        {METRICS.map((metric) => (
          <div key={metric.key} className="card card-hover">
            <span className="metric-label">{metric.label}</span>
            <div className="metric-value">{counts ? counts[metric.key] : "—"}</div>
            <div className="metric-hint">{counts ? metric.hint : "Dado indisponível no momento"}</div>
          </div>
        ))}
      </div>

      {usage ? (
        <section className="card" style={{ marginBottom: 24 }} aria-labelledby="uso-ia">
          <h2 id="uso-ia" className="section-title">Uso de IA</h2>
          <p className="workspace-section-lead">
            Consumo já registrado no ledger da conta, separado de qualquer fatura conciliada.
          </p>
          <div className="grid grid-4" style={{ marginBottom: usage.services_7d.length > 0 ? 16 : 0 }}>
            <div>
              <span className="metric-label">Tokens hoje</span>
              <div className="metric-value">{usage.tokens_today.toLocaleString("pt-BR")}</div>
              <div className="metric-hint">
                {Math.min(100, Math.round((usage.tokens_today / DAILY_TOKEN_CAP) * 100))}% do teto diário de{" "}
                {DAILY_TOKEN_CAP.toLocaleString("pt-BR")}
              </div>
            </div>
            <div>
              <span className="metric-label">Conversas em vídeo hoje</span>
              <div className="metric-value">{usage.conversations_today.toLocaleString("pt-BR")}</div>
              <div className="metric-hint">Conversas registradas no ledger da conta</div>
            </div>
            <div>
              <span className="metric-label">Custo atribuído hoje</span>
              <div className="metric-value">{formatUsd(usage.total_cost_usd_today)}</div>
              <div className="metric-hint">Ledger estimado/reportado — não é a fatura conciliada</div>
            </div>
            <div>
              <span className="metric-label">Serviços com atividade (7 dias)</span>
              <div className="metric-value">{usage.services_7d.length}</div>
              <div className="metric-hint">Custo atribuído (7d): {formatUsd(usage.total_cost_usd_7d)}</div>
            </div>
          </div>
          {usage.services_7d.length > 0 && (
            <dl style={{ margin: 0, display: "grid", gap: 8, fontSize: "0.85rem" }}>
              {usage.services_7d.map((row) => (
                <div key={`${row.service}-${row.unit_type}`} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <dt style={{ color: "var(--text-muted)" }}>{USAGE_SERVICE_LABELS[row.service] ?? row.service}</dt>
                  <dd style={{ margin: 0, textAlign: "right" }}>
                    {row.quantity.toLocaleString("pt-BR")} {row.unit_type === "token" ? "tokens" : row.unit_type === "conversation" ? "conversas" : row.unit_type}
                    {row.amount_usd > 0 && <span style={{ color: "var(--text-faint)" }}> · {formatUsd(row.amount_usd)}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p style={{ margin: "14px 0 0", fontSize: "0.72rem", color: "var(--text-faint)" }}>{usage.cost_estimate_note}</p>
        </section>
      ) : (
        <section className="card workspace-data-notice" style={{ marginBottom: 24 }} aria-labelledby="uso-ia-indisponivel">
          <h2 id="uso-ia-indisponivel" className="section-title">Uso de IA</h2>
          <p className="workspace-section-lead" role="status">
            O resumo de uso não está disponível agora. A central continua exibindo somente os dados que foram confirmados.
          </p>
        </section>
      )}

      <section className="card workspace-readiness" aria-labelledby="prontidao-operacional">
        <div className="workspace-readiness-top">
          <div>
            <span className="metric-label">Próximo melhor passo</span>
            <h2 id="prontidao-operacional">{nextAction.label}</h2>
            <p className="workspace-section-lead">
              {nextActionDescription}
            </p>
          </div>
          <a className="btn btn-primary btn-small" href={nextAction.href}>{nextAction.action}</a>
        </div>
        <div className="workspace-readiness-meter" role="progressbar" aria-label="Prontidão operacional confirmada" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readinessPercent} aria-valuetext={readinessSummary}>
          <span style={{ width: `${readinessPercent}%` }} />
        </div>
        <div className="workspace-readiness-steps">
          {readiness.map((item) => (
            <div key={item.label} className={`workspace-readiness-step${item.state === "done" ? " is-done" : ""}${item.state === "unknown" ? " is-unknown" : ""}`}>
              <span className="workspace-readiness-icon" aria-hidden="true">{item.state === "done" ? "✓" : item.state === "unknown" ? "—" : "○"}</span>
              <span>{item.label}</span>
            </div>
          ))}
          <span className="workspace-readiness-count">{readinessSummary}</span>
        </div>
      </section>

      <div className="workspace-grid">
        <section className="card workspace-primary" aria-labelledby="proximos-passos">
          <h2 id="proximos-passos" className="section-title">Pontos de controle</h2>
          <p className="workspace-section-lead">Mantenha a operação pronta sem perder o contexto que sustenta cada conversa.</p>
          <ol style={{ margin: 0, paddingLeft: 20, color: "var(--text-muted)", fontSize: "0.9rem", display: "grid", gap: 10 }}>
            <li>
              <strong style={{ color: "var(--text)" }}>Defina a presença</strong> em Agentes — a equipe decide qual agente pode conduzir cada contexto.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Autorize o conhecimento</strong> que pode apoiar a conversa antes de colocá-lo em campo.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Revise o histórico</strong> para transformar o que foi dito no próximo passo da equipe.
            </li>
          </ol>
        </section>

        <section className="card workspace-side" aria-labelledby="dados-conta">
          <h2 id="dados-conta" className="section-title">Dados da conta</h2>
          {tenant ? (
            <dl style={{ margin: 0, display: "grid", gap: 10, fontSize: "0.88rem" }}>
              <InfoRow label="Identificador" value={<span className="mono">{tenant.slug}</span>} />
              <InfoRow label="Região" value={tenant.home_region} />
              <InfoRow label="Idioma padrão" value={tenant.default_language} />
              <InfoRow label="Fuso horário" value={tenant.default_timezone} />
              <InfoRow label="Criada em" value={formatLongDate(tenant.created_at, tenant.default_timezone)} />
            </dl>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>Os dados da conta ainda não puderam ser confirmados.</p>
          )}
        </section>
      </div>

      <section className="card workspace-conversation-feed" aria-labelledby="conversas-recentes">
        <div className="workspace-conversation-feed-head">
          <div>
            <span className="metric-label">Histórico operacional</span>
            <h2 id="conversas-recentes" className="section-title">Conversas registradas recentemente</h2>
            <p className="workspace-section-lead">Retome o contexto que sua equipe já pode revisar, sem inventar prioridade ou resultado.</p>
          </div>
          <Link href="/conversas" className="btn btn-ghost btn-small">Ver todas</Link>
        </div>
        {transcripts === null ? (
          <p className="workspace-section-lead" role="status">Não foi possível carregar as conversas recentes agora.</p>
        ) : transcripts.length === 0 ? (
          <p className="workspace-section-lead">Nenhuma conversa foi registrada ainda. Assim que houver uma interação persistida, ela aparecerá aqui.</p>
        ) : (
          <ul className="workspace-conversation-list">
            {transcripts.map((transcript) => (
              <li key={transcript.id}>
                <Link href={`/conversas/${transcript.id}`} className="workspace-conversation-row">
                  <span className="workspace-conversation-agent">{transcript.agentName}</span>
                  <span className="workspace-conversation-surface">{SURFACE_LABELS[transcript.surface] ?? transcript.surface}</span>
                  <span className="workspace-conversation-meta">{transcript.turnCount} {transcript.turnCount === 1 ? "turno" : "turnos"}</span>
                  <time className="workspace-conversation-meta" dateTime={transcript.startedAt}>{formatDateTime(transcript.startedAt, timeZone)}</time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function readinessState(value: boolean | null): ReadinessState {
  if (value === null) return "unknown";
  return value ? "done" : "pending";
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: "right" }}>{value}</dd>
    </div>
  );
}
