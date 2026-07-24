import type { Metadata } from "next";

import { fetchTenantOverview, fetchUsageSummary, type UsageSummary } from "@/lib/portal-data";
import { StatusBadge } from "@/components/status-badge";

export const metadata: Metadata = { title: "Visão geral — Axtro Digital Human OS" };

const METRICS = [
  { key: "agents", label: "Agentes", hint: "Apresentadores digitais configurados" },
  { key: "sessions", label: "Sessões", hint: "Interações registradas" },
  { key: "knowledge_sources", label: "Fontes de conhecimento", hint: "Bases autorizadas para RAG" },
  { key: "contacts", label: "Contatos", hint: "Perfis de contato ativos" },
] as const;

const DAILY_TOKEN_CAP = 500_000;

function formatUsd(value: number): string {
  return `US$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

const USAGE_SERVICE_LABELS: Record<string, string> = {
  "portal.agent_preview": "Chat de teste dos agentes",
  "portal.knowledge_embedding": "Ingestão de conhecimento",
  "portal.knowledge_retrieval": "Busca de conhecimento (RAG)",
  "portal.video_conversation": "Conversas em vídeo",
};

export default async function DashboardPage() {
  let overview;
  let usage: UsageSummary | null = null;
  try {
    overview = await fetchTenantOverview();
  } catch {
    return (
      <div className="error-banner" role="alert">
        Não foi possível carregar a visão geral da conta agora. Recarregue a página; se persistir, contate o suporte.
      </div>
    );
  }
  try {
    usage = await fetchUsageSummary();
  } catch {
    // Painel de uso é secundário: se o resumo falhar, o dashboard continua.
    usage = null;
  }

  const tenant = overview.tenant;
  const counts = overview.counts;
  const totalConfigured = counts ? counts.agents + counts.knowledge_sources : 0;
  const readiness = [
    { label: "Conta provisionada", done: Boolean(tenant), href: "/configuracoes", action: "Revisar conta" },
    { label: "Primeiro agente", done: (counts?.agents ?? 0) > 0, href: "/agentes", action: "Abrir agentes" },
    { label: "Conhecimento autorizado", done: (counts?.knowledge_sources ?? 0) > 0, href: "/conhecimento", action: "Abrir conhecimento" },
  ] as const;
  const completedReadiness = readiness.filter((item) => item.done).length;
  const readinessPercent = Math.round((completedReadiness / readiness.length) * 100);
  const nextAction = readiness.find((item) => !item.done) ?? { label: "Workspace configurado", href: "/agentes", action: "Explorar agentes" };

  return (
    <>
      <header className="workspace-hero">
        <div>
          <span className="workspace-eyebrow"><span className="eyebrow-pulse" /> Control plane / overview</span>
          <h1>O palco está pronto para a próxima conversa.</h1>
          <p>
            {tenant ? tenant.legal_name : "Sua conta"} <span className="workspace-divider">/</span> operação em modo de configuração
          </p>
        </div>
        <div className="workspace-status"><span className="status-dot status-dot-live" /> <StatusBadge status={tenant?.status ?? "trial"} /></div>
      </header>

      <div className="grid grid-4 workspace-metrics" style={{ marginBottom: 24 }}>
        {METRICS.map((metric) => (
          <div key={metric.key} className="card card-hover">
            <span className="metric-label">{metric.label}</span>
            <div className="metric-value">{counts ? counts[metric.key] : 0}</div>
            <div className="metric-hint">{metric.hint}</div>
          </div>
        ))}
      </div>

      {usage && (
        <section className="card" style={{ marginBottom: 24 }} aria-labelledby="uso-ia">
          <h2 id="uso-ia" className="section-title">Uso de IA</h2>
          <p className="workspace-section-lead">
            Consumo medido no ledger da conta — cada resposta, ingestão e chamada deixa rastro.
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
              <div className="metric-hint">Chamadas Tavus iniciadas pela conta</div>
            </div>
            <div>
              <span className="metric-label">Custo estimado hoje</span>
              <div className="metric-value">{formatUsd(usage.ai_cost_usd_today + usage.video_cost_floor_usd_today)}</div>
              <div className="metric-hint">Preço público de tabela — não é a fatura real</div>
            </div>
            <div>
              <span className="metric-label">Serviços ativos (7 dias)</span>
              <div className="metric-value">{usage.services_7d.length}</div>
              <div className="metric-hint">Custo (7d): {formatUsd(usage.ai_cost_usd_7d + usage.video_cost_floor_usd_7d)}</div>
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
      )}

      <section className="card workspace-readiness" aria-labelledby="prontidao-operacional">
        <div className="workspace-readiness-top">
          <div>
            <span className="metric-label">Próximo melhor passo</span>
            <h2 id="prontidao-operacional">Leve sua operação até a próxima conversa.</h2>
            <p className="workspace-section-lead">
              Acompanhe o que já está pronto e avance só no que falta para colocar contexto e presença em campo.
            </p>
          </div>
          <a className="btn btn-primary btn-small" href={nextAction.href}>{nextAction.action}</a>
        </div>
        <div className="workspace-readiness-meter" role="progressbar" aria-label="Prontidão operacional" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readinessPercent}>
          <span style={{ width: `${readinessPercent}%` }} />
        </div>
        <div className="workspace-readiness-steps">
          {readiness.map((item) => (
            <div key={item.label} className={`workspace-readiness-step${item.done ? " is-done" : ""}`}>
              <span className="workspace-readiness-icon" aria-hidden="true">{item.done ? "✓" : "○"}</span>
              <span>{item.label}</span>
            </div>
          ))}
          <span className="workspace-readiness-count">{completedReadiness}/{readiness.length} concluídos</span>
        </div>
      </section>

      <div className="workspace-grid">
        <section className="card workspace-primary" aria-labelledby="proximos-passos">
          <h2 id="proximos-passos" className="section-title">Primeiros passos</h2>
          <p className="workspace-section-lead">Configure os blocos que transformam presença em operação.</p>
          <ol style={{ margin: 0, paddingLeft: 20, color: "var(--text-muted)", fontSize: "0.9rem", display: "grid", gap: 10 }}>
            <li>
              <strong style={{ color: "var(--text)" }}>Revise os dados da conta</strong> em Configurações — nome, idioma e fuso horário padrão.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Cadastre seu primeiro agente</strong> quando os provedores de voz e avatar forem conectados.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Adicione fontes de conhecimento</strong> autorizadas para o agente citar com segurança.
            </li>
          </ol>
          {totalConfigured === 0 && (
            <p style={{ fontSize: "0.8rem", color: "var(--text-faint)", marginTop: 14, marginBottom: 0 }}>
              Sua conta está pronta — os recursos de operação são liberados conforme os provedores forem conectados.
            </p>
          )}
        </section>

        <section className="card workspace-side" aria-labelledby="dados-conta">
          <h2 id="dados-conta" className="section-title">Dados da conta</h2>
          {tenant ? (
            <dl style={{ margin: 0, display: "grid", gap: 10, fontSize: "0.88rem" }}>
              <InfoRow label="Identificador" value={<span className="mono">{tenant.slug}</span>} />
              <InfoRow label="Região" value={tenant.home_region} />
              <InfoRow label="Idioma padrão" value={tenant.default_language} />
              <InfoRow label="Fuso horário" value={tenant.default_timezone} />
              <InfoRow
                label="Criada em"
                value={new Date(tenant.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
              />
            </dl>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>Conta ainda não provisionada.</p>
          )}
        </section>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <dt style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: "right" }}>{value}</dd>
    </div>
  );
}
