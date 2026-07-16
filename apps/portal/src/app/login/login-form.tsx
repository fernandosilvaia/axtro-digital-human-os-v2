"use client";

import { useActionState } from "react";

import { signIn, type AuthActionState } from "@/lib/actions/auth";

const initialState: AuthActionState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error && <p className="form-error">{state.error}</p>}
      <button type="submit" className="submit-button" disabled={pending}>
        {pending ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
