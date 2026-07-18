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
          {pending ? "Processando..." : "Cadastrar"}
        </button>
      </div>
      <div className="field" style={{ margin: "12px 0 0" }}>
        <label htmlFor="source-content">Conteúdo (opcional)</label>
        <textarea
          id="source-content"
          name="content"
          rows={6}
          maxLength={80000}
          placeholder="Cole aqui o conteúdo do documento (texto). Com conteúdo, a fonte é ingerida com embeddings reais e fica ativa — os agentes passam a citar apenas o que estiver aqui."
          style={{ resize: "vertical", fontSize: "0.82rem", lineHeight: 1.5 }}
        />
      </div>
      <p style={{ fontSize: "0.76rem", color: "var(--text-faint)", margin: "10px 0 0" }}>
        Com conteúdo, a fonte é dividida em trechos, indexada com embeddings e ativada na hora — vira a
        única base de fatos dos agentes da conta. Sem conteúdo, ela fica pendente e nada é citado.
      </p>
      {state.error && <p className="form-error" role="alert" style={{ margin: "10px 0 0" }}>{state.error}</p>}
      {state.done && !state.error && (
        <p className="saved-flag" role="status" style={{ marginTop: 10 }}>✓ Fonte registrada.</p>
      )}
    </form>
  );
}
