import { SITE_NAME } from "@/lib/site";

/**
 * Marca compartilhada das 6 telas de pré-login (login, signup,
 * recuperar-senha, nova-senha, error, not-found): cada uma tinha o mesmo
 * bloco copiado com o nome antigo "Digital Human OS" hardcoded, sobrevivente
 * do rebrand de 2026-08-19 (commit 429c5c6) que renomeou a landing e o
 * workspace autenticado (`components/app-shell.tsx`) para "Axtro Closer AI
 * Human" mas nunca tocou estas 6 telas -- um usuário saindo do login pra ver
 * um erro, ou navegando de volta pra criar conta, via dois nomes de produto
 * diferentes (achado de auditoria, D-V2-183). Fonte única: `SITE_NAME`.
 */
export function AuthBrand({ centered = false }: { readonly centered?: boolean }) {
  return (
    <div className="auth-brand" style={centered ? { justifyContent: "center" } : undefined}>
      <span className="brand-mark" aria-hidden="true">A</span>
      <span className="brand-word">{SITE_NAME}</span>
    </div>
  );
}
