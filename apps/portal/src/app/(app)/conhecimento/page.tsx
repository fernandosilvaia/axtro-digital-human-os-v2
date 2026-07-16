import type { Metadata } from "next";

import { fetchKnowledgeSources } from "@/lib/portal-data";
import { StatusBadge } from "@/components/status-badge";

export const metadata: Metadata = { title: "Conhecimento — Axtro Digital Human OS" };

const SOURCE_TYPE_LABELS: Record<string, string> = {
  document: "Documento",
  url: "Página web",
  faq: "FAQ",
  catalog: "Catálogo",
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  internal: "Interno",
  confidential: "Confidencial",
  restricted: "Restrito",
  public: "Público",
};

export default async function KnowledgePage() {
  let sources;
  try {
    sources = await fetchKnowledgeSources();
  } catch {
    return (
      <div className="error-banner" role="alert">
        Não foi possível carregar as fontes de conhecimento agora. Recarregue a página; se persistir, contate o suporte.
      </div>
    );
  }

  return (
    <>
      <header style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: "1.4rem" }}>Base de conhecimento</h1>
        <p style={{ color: "var(--text-muted)", margin: "4px 0 0", fontSize: "0.9rem" }}>
          Fontes autorizadas que seus agentes podem citar — sempre com rastreabilidade e revogação imediata.
        </p>
      </header>

      {sources.length === 0 ? (
        <div className="empty-state">
          <div className="icon" aria-hidden="true">▤</div>
          <h3>Nenhuma fonte cadastrada</h3>
          <p>
            Quando a ingestão de conteúdo for habilitada para sua conta, cada documento aprovado
            aparece aqui com classificação de dados e status de validade.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Fonte</th>
                  <th>Tipo</th>
                  <th>Classificação</th>
                  <th>Status</th>
                  <th>Adicionada em</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id}>
                    <td>{source.display_name}</td>
                    <td>{SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}</td>
                    <td>
                      <span className="badge badge-neutral">
                        {CLASSIFICATION_LABELS[source.data_classification] ?? source.data_classification}
                      </span>
                    </td>
                    <td><StatusBadge status={source.status} /></td>
                    <td>{new Date(source.created_at).toLocaleDateString("pt-BR")}</td>
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
