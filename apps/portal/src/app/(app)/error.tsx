"use client";

/**
 * Error boundary do workspace logado (auditoria 2026-08-02: o layout
 * autenticado chama o Supabase sem try/catch e o portal não tinha NENHUM
 * error.tsx — uma falha transitória derrubava todas as páginas logadas na
 * tela crua do Next). Mesma linguagem visual do resto; a recuperação é um
 * clique (Art. 14: reconexão é estado explícito, não beco).
 */
import { useEffect } from "react";

export default function WorkspaceError({ error, reset }: { readonly error: Error & { digest?: string }; readonly reset: () => void }) {
  useEffect(() => {
    // Telemetria client-side mínima: o digest permite correlacionar com o log do servidor.
    console.error("workspace_error_boundary", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <main style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 460, padding: 28, textAlign: "center" }}>
        <h1 style={{ fontSize: "1.15rem", marginBottom: 8 }}>Algo falhou ao carregar o painel</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: 18 }}>
          Pode ser uma instabilidade passageira de conexão. Seus dados estão seguros — nada foi perdido.
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
    </main>
  );
}
