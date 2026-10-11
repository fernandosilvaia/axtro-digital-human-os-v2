import type { CoverageNeedEstimate } from "@/lib/insurance/coverage-need";

/**
 * A conta que a persona fez ao vivo, na tela da pessoa. Mostrar a decomposição
 * é o ponto: o número deixa de ser palpite de quem vende e vira uma conta que a
 * própria pessoa acompanha. É estimativa educativa; quem recomenda é o agente
 * licenciado.
 */
const LABELS = {
  english: {
    title: "Your coverage estimate",
    debts: "Debts",
    income: "Income replacement",
    mortgage: "Mortgage",
    education: "Education",
    finalExpenses: "Final expenses",
    existing: "Existing coverage",
    savings: "Savings",
    total: "Total need",
    gap: "Estimated gap",
    note: "Educational estimate (DIME method), not a quote. A licensed agent confirms the amount and the right product.",
  },
  spanish: {
    title: "Su estimación de cobertura",
    debts: "Deudas",
    income: "Reemplazo de ingresos",
    mortgage: "Hipoteca",
    education: "Educación",
    finalExpenses: "Gastos finales",
    existing: "Cobertura existente",
    savings: "Ahorros",
    total: "Necesidad total",
    gap: "Brecha estimada",
    note: "Estimación educativa (método DIME), no es una cotización. Un agente con licencia confirma el monto y el producto adecuado.",
  },
  portuguese: {
    title: "Estimativa de cobertura",
    debts: "Dívidas",
    income: "Reposição de renda",
    mortgage: "Hipoteca",
    education: "Educação",
    finalExpenses: "Despesas finais",
    existing: "Cobertura existente",
    savings: "Reservas",
    total: "Necessidade total",
    gap: "Lacuna estimada",
    note: "Estimativa educativa (método DIME), não é cotação. Um agente licenciado confirma o valor e o produto certo.",
  },
} as const;

function usd(value: number): string {
  return `$${value.toLocaleString("en-US")}`;
}

export function CoverageEstimateCard({ estimate, language }: { estimate: CoverageNeedEstimate; language: "english" | "spanish" | "portuguese" }) {
  const label = LABELS[language];
  const rows: [string, number][] = [
    [label.debts, estimate.components.debts],
    [label.income, estimate.components.income],
    [label.mortgage, estimate.components.mortgage],
    [label.education, estimate.components.education],
    [label.finalExpenses, estimate.components.finalExpenses],
  ];
  return (
    <section className="card" aria-live="polite" aria-labelledby="coverage-estimate-title" style={{ marginTop: 12 }}>
      <h3 id="coverage-estimate-title" style={{ margin: "0 0 10px" }}>{label.title}</h3>
      <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 16px", margin: 0 }}>
        {rows.filter(([, value]) => value > 0).map(([name, value]) => (
          <div key={name} style={{ display: "contents" }}>
            <dt style={{ color: "var(--text-muted)" }}>{name}</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{usd(value)}</dd>
          </div>
        ))}
        <dt><strong>{label.total}</strong></dt>
        <dd style={{ margin: 0, textAlign: "right" }}><strong>{usd(estimate.totalNeed)}</strong></dd>
        {estimate.offsets.existingCoverage > 0 && (
          <div style={{ display: "contents" }}>
            <dt style={{ color: "var(--text-muted)" }}>{label.existing}</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{`- ${usd(estimate.offsets.existingCoverage)}`}</dd>
          </div>
        )}
        {estimate.offsets.liquidSavings > 0 && (
          <div style={{ display: "contents" }}>
            <dt style={{ color: "var(--text-muted)" }}>{label.savings}</dt>
            <dd style={{ margin: 0, textAlign: "right" }}>{`- ${usd(estimate.offsets.liquidSavings)}`}</dd>
          </div>
        )}
        <dt><strong>{label.gap}</strong></dt>
        <dd style={{ margin: 0, textAlign: "right" }}><strong>{usd(estimate.gap)}</strong></dd>
      </dl>
      <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "10px 0 0" }}>{label.note}</p>
    </section>
  );
}
