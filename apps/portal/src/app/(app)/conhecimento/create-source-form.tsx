"use client";

import { useActionState } from "react";

import { createKnowledgeSource, type ResourceActionState } from "@/lib/actions/resources";

const initialState: ResourceActionState = { error: null, done: false };

export function CreateSourceForm() {
  const [state, formAction, pending] = useActionState(createKnowledgeSource, initialState);

  return (
    <form action={formAction}>
      <h3 style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 10px" }}>
        Nova fonte
      </h3>
      <div className="form-row" style={{ gridTemplateColumns: "2fr 1fr 1fr auto", alignItems: "end" }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="source-name">Nome da fonte</label>
          <input id="source-name" name="display_name" type="text" minLength={2} maxLength={160} autoComplete="off" required />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="source-type">Tipo</label>
          <select id="source-type" name="source_type" defaultValue="document">
            <option value="document">Documento</option>
            <option value="faq">FAQ</option>
            <option value="url">Página web</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="source-classification">Classificação</label>
          <select id="source-classification" name="data_classification" defaultValue="internal">
            <option value="internal">Interno</option>
            <option value="confidential">Confidencial</option>
            <option value="restricted">Restrito</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Cadastrando..." : "Cadastrar"}
        </button>
      </div>
      <p style={{ fontSize: "0.76rem", color: "var(--text-faint)", margin: "10px 0 0" }}>
        A fonte é registrada como pendente. A ingestão do conteúdo é habilitada quando o provedor de
        embeddings for conectado — nada é citado por agentes antes disso.
      </p>
      {state.error && <p className="form-error" role="alert" style={{ margin: "10px 0 0" }}>{state.error}</p>}
      {state.done && !state.error && (
        <p className="saved-flag" role="status" style={{ marginTop: 10 }}>✓ Fonte registrada como pendente.</p>
      )}
    </form>
  );
}
