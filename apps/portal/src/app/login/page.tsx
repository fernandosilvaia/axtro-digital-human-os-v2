import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirm?: string }>;
}) {
  const { confirm } = await searchParams;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <h1>Entrar</h1>
        <p className="subtitle">Axtro Digital Human OS</p>
        {confirm === "1" && (
          <p className="subtitle">Conta criada. Confirme seu e-mail antes de entrar.</p>
        )}
        <LoginForm />
        <p className="auth-switch">
          Ainda não tem conta? <a href="/signup">Criar conta</a>
        </p>
      </div>
    </div>
  );
}
