import type { Metadata } from "next";

import { fetchTeam, fetchTenantOverview } from "@/lib/portal-data";
import { TeamSection } from "./team-section";
import { TenantProfileForm } from "./tenant-profile-form";

export const metadata: Metadata = { title: "Configurações — Axtro Digital Human OS" };

export default async function SettingsPage() {
  let overview;
  let team;
  try {
    [overview, team] = await Promise.all([fetchTenantOverview(), fetchTeam()]);
  } catch {
    return (
      <div className="error-banner" role="alert">
        Não foi possível carregar as configurações agora. Recarregue a página; se persistir, contate o suporte.
      </div>
    );
  }

  const tenant = overview.tenant;
  const isAdmin = overview.role === "tenant_admin";

  return (
    <>
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: "1.4rem" }}>Configurações</h1>
        <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: "0.9rem" }}>
          Dados e preferências da conta. Alterações aqui valem para todos os agentes.
        </p>
      </header>

      {tenant ? (
        <div className="grid grid-2" style={{ alignItems: "start" }}>
          <section className="card" aria-labelledby="perfil-conta">
            <h2 id="perfil-conta" className="section-title">Perfil da conta</h2>
            {isAdmin ? (
              <TenantProfileForm
                key={`${tenant.legal_name}|${tenant.default_language}|${tenant.default_timezone}`}
                legalName={tenant.legal_name}
                defaultLanguage={tenant.default_language}
                defaultTimezone={tenant.default_timezone}
              />
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>
                Somente administradores podem editar o perfil da conta. Os dados atuais:
                <br />
                <strong style={{ color: "var(--text)" }}>{tenant.legal_name}</strong> · {tenant.default_language} · {tenant.default_timezone}
              </p>
            )}
          </section>

          <section className="card" aria-labelledby="dados-tecnicos">
            <h2 id="dados-tecnicos" className="section-title">Dados técnicos</h2>
            <dl style={{ margin: 0, display: "grid", gap: 10, fontSize: "0.88rem" }}>
              <TechRow label="ID da conta" value={tenant.id} />
              <TechRow label="Identificador" value={tenant.slug} />
              <TechRow label="Região de dados" value={tenant.home_region} />
            </dl>
            <p style={{ fontSize: "0.78rem", color: "var(--text-faint)", marginTop: 16, marginBottom: 0 }}>
              Esses valores são fixos e usados por integrações e suporte. A região de dados não pode
              ser alterada depois da criação da conta.
            </p>
          </section>

          <TeamSection team={team} isAdmin={isAdmin} />

          <section className="card" aria-labelledby="plano-conta">
            <h2 id="plano-conta" className="section-title">Plano e contratação</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.86rem", margin: "0 0 12px" }}>
              Sua conta está no plano <strong>Avaliação</strong> — completo para validar a operação,
              com limites de proteção:
            </p>
            <ul style={{ margin: "0 0 14px", paddingLeft: 18, fontSize: "0.86rem", color: "var(--text-muted)", display: "grid", gap: 4 }}>
              <li>Até 20 agentes e 50 fontes de conhecimento</li>
              <li>500.000 tokens de IA por dia (chat e RAG)</li>
              <li>20 conversas de vídeo por dia (salas, apresentações e reuniões externas)</li>
              <li>20 convites de equipe e 30 ingestões de conteúdo por dia</li>
            </ul>
            <p style={{ color: "var(--text-muted)", fontSize: "0.86rem", margin: "0 0 14px" }}>
              Para produção com seus clientes reais — limites ampliados, número dedicado e acordo
              comercial — fale com o nosso time. A proposta sai de uma conversa de diagnóstico, não
              de uma tabela genérica.
            </p>
            <a
              className="btn btn-primary"
              href="mailto:fernando@axtroai.com?subject=Contrata%C3%A7%C3%A3o%20Axtro%20Digital%20Human%20OS"
              style={{ padding: "10px 18px" }}
            >
              Falar com o time sobre contratação
            </a>
          </section>
        </div>
      ) : (
        <div className="empty-state">
          <h3>Conta ainda não provisionada</h3>
          <p>Volte para a visão geral para concluir o provisionamento automático.</p>
        </div>
      )}
    </>
  );
}

function TechRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline" }}>
      <dt style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</dt>
      <dd className="mono" style={{ margin: 0, textAlign: "right", wordBreak: "break-all" }}>{value}</dd>
    </div>
  );
}
