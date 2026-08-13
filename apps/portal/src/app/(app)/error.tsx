"use client";

/**
 * Error boundary do workspace logado (auditoria 2026-08-02: o layout
 * autenticado chama o Supabase sem try/catch e o portal não tinha NENHUM
 * error.tsx — uma falha transitória derrubava todas as páginas logadas na
 * tela crua do Next). Mesma linguagem visual do resto; a recuperação é um
 * clique (Art. 14: reconexão é estado explícito, não beco).
 *
 * Copy revisada na onda 7 (D-V2-116): "nada foi perdido" era uma promessa
 * falsa num cenário real e verificado — sessão morta no meio de uma Server
 * Action (formulário de /configuracoes ou /conhecimento, entre outros) cai
 * exatamente aqui, e o que estava sendo digitado/colado JÁ tinha sido limpo
 * do estado otimista do componente antes do erro. "Tentar de novo" também
 * não ajuda nesse caso — a sessão continua morta. Link direto pro login
 * cobre o caso real sem prometer o que não é garantido. (O chat de teste em
 * /agentes/[id]/testar ganhou seu PRÓPRIO try/catch na mesma onda —
 * preview-chat.tsx — e não cai mais aqui; citado como exemplo até este
 * comentário ser corrigido pela auto-revisão da própria onda que o
 * introduziu, achado real de doc desatualizada no mesmo commit.)
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
          Pode ser uma instabilidade passageira de conexão — ou sua sessão pode ter expirado. Algo que você estava digitando pode não ter sido salvo.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={reset} style={{ padding: "10px 22px" }}>
            Tentar de novo
          </button>
          <a href="/login" className="btn" style={{ padding: "10px 22px" }}>
            Fazer login de novo
          </a>
        </div>
        {error.digest && (
          <p style={{ color: "var(--text-faint)", fontSize: "0.72rem", marginTop: 16 }}>
            Se persistir, informe este código ao suporte: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
