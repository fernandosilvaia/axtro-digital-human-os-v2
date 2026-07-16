const STATUS_STYLES: Record<string, { className: string; label: string }> = {
  trial: { className: "badge badge-warning", label: "Período de avaliação" },
  active: { className: "badge badge-success", label: "Ativa" },
  suspended: { className: "badge badge-danger", label: "Suspensa" },
  closing: { className: "badge badge-danger", label: "Encerrando" },
  draft: { className: "badge badge-neutral", label: "Rascunho" },
  disabled: { className: "badge badge-neutral", label: "Desativado" },
  archived: { className: "badge badge-neutral", label: "Arquivado" },
  pending: { className: "badge badge-warning", label: "Pendente" },
  stale: { className: "badge badge-warning", label: "Desatualizada" },
  deleted: { className: "badge badge-danger", label: "Removida" },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { className: "badge badge-neutral", label: status };
  return (
    <span className={style.className}>
      <span className="badge-dot" aria-hidden="true" />
      {style.label}
    </span>
  );
}
