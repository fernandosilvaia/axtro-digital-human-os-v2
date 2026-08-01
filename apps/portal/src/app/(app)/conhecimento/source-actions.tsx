"use client";

import { useActionState, useState, useTransition } from "react";

import {
  deleteKnowledgeSource,
  setKnowledgeSourceStatus,
  updateKnowledgeSourceContent,
  type ResourceActionState,
} from "@/lib/actions/resources";

const initialState: ResourceActionState = { error: null, done: false };

interface SourceActionsProps {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly status: string;
}

export function SourceActions({ sourceId, sourceName, status }: SourceActionsProps) {
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [updateState, updateAction, updatePending] = useActionState(updateKnowledgeSourceContent, initialState);
  const [showUpdate, setShowUpdate] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const canDisable = status === "active" || status === "stale";
  const canActivate = status === "disabled" || status === "stale";
  // Exclusão só de fonte já revogada ou nunca ingerida — a promessa de
  // revogação explícita fica preservada (a RPC recusa qualquer outro estado).
  const canDelete = status === "disabled" || status === "pending";

  const onDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setStatusError(null);
    startTransition(async () => {
      const result = await deleteKnowledgeSource(sourceId);
      if (result.error) {
        setStatusError(result.error);
        setConfirmingDelete(false);
      }
    });
  };

  const changeStatus = (next: "active" | "disabled") => {
    setStatusError(null);
    startTransition(async () => {
      const result = await setKnowledgeSourceStatus(sourceId, next);
      if (result.error) setStatusError(result.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {canDisable && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={pending}
            onClick={() => changeStatus("disabled")}
            aria-label={`Revogar a fonte ${sourceName}`}
          >
            {pending ? "..." : "Revogar"}
          </button>
        )}
        {canActivate && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={pending}
            onClick={() => changeStatus("active")}
            aria-label={`Reativar a fonte ${sourceName}`}
          >
            {pending ? "..." : "Reativar"}
          </button>
        )}
        {status !== "deleted" && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => setShowUpdate((current) => !current)}
            aria-expanded={showUpdate}
            aria-label={`Atualizar o conteúdo da fonte ${sourceName}`}
          >
            {showUpdate ? "Fechar" : "Atualizar conteúdo"}
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={pending}
            onClick={onDelete}
            aria-label={confirmingDelete ? `Confirmar exclusão da fonte ${sourceName}` : `Excluir a fonte ${sourceName}`}
            style={{ borderColor: "rgba(255,120,120,0.4)", color: "#ff9d9d" }}
          >
            {pending ? "..." : confirmingDelete ? "Confirmar exclusão?" : "Excluir"}
          </button>
        )}
      </div>
      {statusError && <p className="form-error" role="alert" style={{ margin: 0, fontSize: "0.76rem" }}>{statusError}</p>}
      {showUpdate && (
        <form action={updateAction} style={{ width: "100%", minWidth: 260 }}>
          <input type="hidden" name="source_id" value={sourceId} />
          <textarea
            name="content"
            rows={4}
            required
            maxLength={80000}
            placeholder="Cole o novo conteúdo — substitui a versão anterior por completo."
            style={{ width: "100%", resize: "vertical", fontSize: "0.78rem", lineHeight: 1.45 }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            <button type="submit" className="btn btn-primary btn-small" disabled={updatePending}>
              {updatePending ? "Reingerindo..." : "Reingerir"}
            </button>
            {updateState.done && !updateState.error && (
              <span className="saved-flag" role="status">✓ Conteúdo atualizado.</span>
            )}
          </div>
          {updateState.error && (
            <p className="form-error" role="alert" style={{ margin: "6px 0 0", fontSize: "0.76rem" }}>{updateState.error}</p>
          )}
        </form>
      )}
    </div>
  );
}
