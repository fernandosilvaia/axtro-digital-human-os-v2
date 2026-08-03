"use client";

import { useActionState } from "react";

import { createAgent, type ResourceActionState } from "@/lib/actions/resources";

const initialState: ResourceActionState = { error: null, done: false };

export function CreateAgentForm() {
  const [state, formAction, pending] = useActionState(createAgent, initialState);

  return (
    <form action={formAction}>
      <h3 style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 10px" }}>
        Novo agente
      </h3>
      <div className="form-row" style={{ gridTemplateColumns: "2fr 1fr auto", alignItems: "end" }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="agent-name">Nome do agente</label>
          <input id="agent-name" name="name" type="text" minLength={2} maxLength={120} autoComplete="off" required />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="agent-role">Papel</label>
          <select id="agent-role" name="role_type" defaultValue="sales" disabled>
            <option value="sales">Sales Closer</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Criando..." : "Criar rascunho"}
        </button>
      </div>
      <p style={{ fontSize: "0.76rem", color: "var(--text-faint)", margin: "10px 0 0" }}>
        O agente é criado como rascunho — ative quando quiser. A persona de vídeo (voz e avatar) é
        provisionada automaticamente na ativação.
      </p>
      {state.error && <p className="form-error" role="alert" style={{ margin: "10px 0 0" }}>{state.error}</p>}
      {state.done && !state.error && (
        <p className="saved-flag" role="status" style={{ marginTop: 10 }}>✓ Rascunho criado.</p>
      )}
    </form>
  );
}
