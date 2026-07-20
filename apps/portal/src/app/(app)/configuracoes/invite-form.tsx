"use client";

import { useActionState } from "react";

import { inviteMember, type TeamActionState } from "@/lib/actions/team";

const initialState: TeamActionState = { error: null, done: false };

export function InviteForm() {
  const [state, formAction, pending] = useActionState(inviteMember, initialState);

  return (
    <form action={formAction}>
      <h3 style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 10px" }}>
        Convidar membro
      </h3>
      <div className="form-row" style={{ gridTemplateColumns: "2fr 1fr auto", alignItems: "end" }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="invite-email">E-mail</label>
          <input id="invite-email" name="email" type="email" autoComplete="off" required />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="invite-role">Papel</label>
          <select id="invite-role" name="role" defaultValue="tenant_operator">
            <option value="tenant_operator">Operador</option>
            <option value="tenant_admin">Administrador</option>
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Enviando..." : "Convidar"}
        </button>
      </div>
      {state.error && <p className="form-error" role="alert" style={{ margin: "10px 0 0" }}>{state.error}</p>}
      {state.done && !state.error && (
        <p className="saved-flag" role="status" style={{ marginTop: 10 }}>
          {state.emailSent
            ? "✓ Convite registrado e e-mail enviado — a pessoa entra no seu espaço ao criar a conta com esse e-mail."
            : "✓ Convite registrado — avise a pessoa para criar a conta com esse e-mail (o envio automático de e-mail não está configurado neste ambiente)."}
        </p>
      )}
    </form>
  );
}
