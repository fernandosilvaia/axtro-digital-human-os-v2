"use client";

import { useActionState } from "react";

import { signUp, type AuthActionState } from "@/lib/actions/auth";

const initialState: AuthActionState = { error: null };

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, initialState);

  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </div>
      {state.error && <p className="form-error">{state.error}</p>}
      <p style={{ fontSize: "0.76rem", color: "var(--text-muted)", margin: "0 0 10px" }}>
        Ao criar a conta você concorda com os <a href="/termos" style={{ color: "var(--accent)" }}>Termos de Uso</a> e o{" "}
        <a href="/privacidade" style={{ color: "var(--accent)" }}>Aviso de Privacidade</a>.
      </p>
      <button type="submit" className="submit-button" disabled={pending}>
        {pending ? "Criando..." : "Criar conta"}
      </button>
    </form>
  );
}
