export function PreviewChat({ agentName }: { agentId: string; agentName: string }) {
  return (
    <section className="card" aria-labelledby="text-preview-recovery-title">
      <p className="eyebrow">Preview de texto</p>
      <h2 id="text-preview-recovery-title" style={{ marginTop: 6 }}>
        Proteção de privacidade em restauração
      </h2>
      <p style={{ color: "var(--text-muted)", marginBottom: 0, maxWidth: 680 }}>
        O chat de teste de {agentName} está temporariamente indisponível. Nenhum provider,
        ledger ou transcript é acionado enquanto o runtime contract-first passa pela
        validação de disclosure, consentimento, isolamento por tenant e replay.
      </p>
    </section>
  );
}
