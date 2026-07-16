import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Criar conta</h1>
        <p className="subtitle">Axtro Digital Human OS</p>
        <SignupForm />
        <p className="auth-switch">
          Já tem conta? <a href="/login">Entrar</a>
        </p>
      </div>
    </div>
  );
}
