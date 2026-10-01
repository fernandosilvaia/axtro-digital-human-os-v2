/** Individual deletion is closed by the governed data-disposition boundary. */
export function AgentDeletionUnavailable() {
  return (
    <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
      A exclusão individual de agentes está indisponível. Você pode ativar ou pausar seus agentes.
    </p>
  );
}
