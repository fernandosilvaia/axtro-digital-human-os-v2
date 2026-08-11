"use client";

/**
 * Error boundary das rotas públicas de primeiro contato (/login, /signup,
 * /recuperar-senha, /nova-senha) — achado D-V2-107: só o segmento
 * autenticado (app) tinha error.tsx (auditoria 2026-08-02); essas rotas
 * também chamam Supabase Auth direto (lib/actions/auth.ts) e, se as env
 * vars de Supabase ficarem vazias/erradas em produção, caem na tela crua de
 * erro do Next em inglês — exatamente no funil de conversão de novos
 * clientes. Mesma disciplina do (app)/error.tsx: recuperação é um clique,
 * nunca um beco (Art. 14).
 */
import { useEffect } from "react";

export default function PublicError({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => {
    console.error("public_error_boundary", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="auth-shell">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <div className="auth-brand" style={{ justifyContent: "center" }}>
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-word">Digital Human OS</span>
        </div>
        <h1 style={{ fontSize: "1.3rem" }}>Algo falhou ao carregar esta página</h1>
        <p className="subtitle" style={{ margin: "8px 0 18px" }}>
          Pode ser uma instabilidade passageira de conexão. Nada foi perdido — tente de novo.
        </p>
        <button type="button" className="btn btn-primary" onClick={reset} style={{ padding: "10px 22px" }}>
          Tentar de novo
        </button>
        {error.digest && (
          <p style={{ color: "var(--text-faint)", fontSize: "0.72rem", marginTop: 16 }}>
            Se persistir, informe este código ao suporte: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
