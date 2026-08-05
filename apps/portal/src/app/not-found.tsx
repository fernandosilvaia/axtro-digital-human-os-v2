/**
 * 404 em pt-BR — sem ele, agente inexistente ou link quebrado caía na tela
 * padrão do Next em inglês ("This page could not be found"), destoando de
 * todo o resto do produto (auditoria 2026-08-02).
 */
export default function NotFound() {
  return (
    <div className="auth-shell">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <div className="auth-brand" style={{ justifyContent: "center" }}>
          <span className="brand-mark" aria-hidden="true">A</span>
          <span className="brand-word">Digital Human OS</span>
        </div>
        <h1 style={{ fontSize: "1.3rem" }}>Página não encontrada</h1>
        <p className="subtitle" style={{ margin: "8px 0 18px" }}>
          O endereço pode ter mudado ou o recurso não existe mais nesta conta.
        </p>
        <a className="btn btn-primary" href="/dashboard" style={{ display: "inline-block" }}>
          Ir para a visão geral
        </a>
      </div>
    </div>
  );
}
