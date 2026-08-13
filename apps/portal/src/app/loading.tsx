/**
 * Fallback de carregamento GENUINAMENTE na raiz (achado P1 confirmado, onda
 * 7, D-V2-116) — não em (app)/loading.tsx. No App Router, loading.tsx nunca
 * envolve o layout.tsx do MESMO segmento, só layouts ANINHADOS abaixo dele
 * (confirmado ao vivo e na doc da versão instalada, next@16.3.0). Como
 * (app)/layout.tsx faz 2 chamadas de rede reais ao Supabase antes de
 * renderizar (getUser + fetchTenantOverview), os 5 loading.tsx já existentes
 * (dashboard/, agentes/, configuracoes/, conhecimento/, conversas/) nunca
 * chegam a montar enquanto esse gate não resolve — e um (app)/loading.tsx
 * espelhando o padrão de (app)/error.tsx também NÃO resolveria, pelo mesmo
 * motivo. Só um loading.tsx aninhado ACIMA do layout lento cobre o gate.
 * De brinde, cobre também "/" e /nova-senha (achado P2 da mesma onda), que
 * fazem a mesma checagem de sessão sem loading.tsx próprio.
 */
export default function RootLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Carregando"
      style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div className="skeleton" style={{ height: 40, width: 40, borderRadius: "50%" }} />
        <div className="skeleton" style={{ height: 12, width: 160 }} />
      </div>
    </div>
  );
}
