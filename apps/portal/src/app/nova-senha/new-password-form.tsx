"use client";

import { useActionState } from "react";

import { updatePassword, type UpdatePasswordState } from "@/lib/actions/auth";

const initialState: UpdatePasswordState = { error: null };

export function NewPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="password">Nova senha</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <span className="hint">Pelo menos 8 caracteres.</span>
      </div>
      <div className="field">
        <label htmlFor="password_confirmation">Confirmar nova senha</label>
        <input
          id="password_confirmation"
          name="password_confirmation"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button type="submit" className="submit-button" disabled={pending}>
        {pending ? "Salvando..." : "Salvar nova senha"}
      </button>
    </form>
  );
}
