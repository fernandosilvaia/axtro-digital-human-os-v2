"use client";

import { useActionState } from "react";

import { requestPasswordReset, type PasswordResetRequestState } from "@/lib/actions/auth";

const initialState: PasswordResetRequestState = { error: null, sent: false };

export function RecoveryForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  if (state.sent) {
    return (
      <p className="notice" role="status">
        Se o e-mail estiver cadastrado, o link de recuperação foi enviado. Confira sua caixa de entrada e o spam.
      </p>
    );
  }

  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {state.error && <p className="form-error" role="alert">{state.error}</p>}
      <button type="submit" className="submit-button" disabled={pending}>
        {pending ? "Enviando..." : "Enviar link de recuperação"}
      </button>
    </form>
  );
}
