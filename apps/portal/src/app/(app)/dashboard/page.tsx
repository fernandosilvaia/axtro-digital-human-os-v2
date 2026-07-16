import type { Metadata } from "next";

import { fetchTenantOverview } from "@/lib/portal-data";
import { StatusBadge } from "@/components/status-badge";

export const metadata: Metadata = { title: "Visão geral — Axtro Digital Human OS" };

const METRICS = [
  { key: "agents", label: "Agentes", hint: "Apresentadores digitais configurados" },
  { key: "sessions", label: "Sessões", hint: "Interações registradas" },
  { key: "knowledge_sources", label: "Fontes de conhecimento", hint: "Bases autorizadas para RAG" },
  { key: "contacts", label: "Contatos", hint: "Perfis de contato ativos" },
] as const;

export default async function DashboardPage() {
  let overview;
  try {
    overview = await fetchTenantOverview();
  } catch {
    return (
      <div className="error-banner" role="alert">
        Não foi possível carregar a visão geral da conta agora. Recarregue a página; se persistir, contate o suporte.
      </div>
    );
  }

  const tenant = overview.tenant;
  const counts = overview.counts;
  const totalConfigured = counts ? counts.agents + counts.knowledge_sources : 0;

  return (
    <>
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: "1.4rem" }}>Visão geral</h1>
        <p className="subtitle" style={{ color: "var(--text-muted)", margin: "4px 0 0" }}>
          {tenant ? tenant.legal_name : "Sua conta"} · <StatusBadge status={tenant?.status ?? "trial"} />
        </p>
      </header>

      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        {METRICS.map((metric) => (
          <div key={metric.key} className="card card-hover">
            <span className="metric-label">{metric.label}</span>
            <div className="metric-value">{counts ? counts[metric.key] : 0}</div>
            <div className="metric-hint">{metric.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-2">
        <section className="card" aria-labelledby="proximos-passos">
          <h2 id="proximos-passos" className="section-title">Primeiros passos</h2>
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

        <section className="card" aria-labelledby="dados-conta">
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
