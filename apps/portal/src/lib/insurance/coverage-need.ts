/**
 * Calculadora educativa de necessidade de cobertura (método DIME), usada pela
 * tool `estimate_coverage_need` da closer de Life Insurance.
 *
 * Por que existe: um LLM fazendo conta de cabeça erra, e um número errado dito
 * com confiança numa call de seguro é exatamente o tipo de afirmação que a
 * regulação olha. Aqui a conta é determinística, roda no navegador sem custo e
 * sem guardar dado, e o prospect VÊ a decomposição na tela. O resultado é
 * sempre uma estimativa educativa: quem recomenda valor e produto é o agente
 * licenciado.
 *
 * DIME: Dívidas + Renda (anos que a família precisaria x renda anual) +
 * Hipoteca + Educação, mais despesas finais, menos cobertura existente e
 * reservas líquidas destinadas a isso.
 */

export interface CoverageNeedInput {
  readonly annualIncome?: number;
  readonly yearsOfIncome?: number;
  readonly debts?: number;
  readonly mortgageBalance?: number;
  readonly educationFund?: number;
  readonly finalExpenses?: number;
  readonly existingCoverage?: number;
  readonly liquidSavings?: number;
}

export interface CoverageNeedEstimate {
  readonly outcome: "estimated";
  readonly components: Readonly<{
    debts: number;
    income: number;
    mortgage: number;
    education: number;
    finalExpenses: number;
  }>;
  readonly offsets: Readonly<{ existingCoverage: number; liquidSavings: number }>;
  readonly totalNeed: number;
  readonly gap: number;
  /** Lacuna arredondada para o múltiplo de 5 mil mais próximo, para falar em voz alta. */
  readonly roundedGap: number;
}

export type CoverageNeedResult = CoverageNeedEstimate | { readonly outcome: "insufficient_data" | "invalid_input"; readonly reason: string };

const MAX_AMOUNT = 100_000_000;
const MAX_YEARS = 40;
const AMOUNT_FIELDS = ["annualIncome", "debts", "mortgageBalance", "educationFund", "finalExpenses", "existingCoverage", "liquidSavings"] as const;

function amount(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) return null;
  return Math.round(value);
}

/** Aceita o objeto de argumentos vindo do modelo (não confiável) e valida cada campo. */
export function estimateCoverageNeed(input: unknown): CoverageNeedResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { outcome: "invalid_input", reason: "arguments must be an object" };
  }
  const record = input as Record<string, unknown>;
  const values: Record<string, number> = {};
  for (const field of AMOUNT_FIELDS) {
    const parsed = amount(record[field]);
    if (parsed === null) return { outcome: "invalid_input", reason: `${field} must be a number between 0 and ${MAX_AMOUNT}` };
    values[field] = parsed;
  }
  const rawYears = record.yearsOfIncome;
  let years = 0;
  if (rawYears !== undefined && rawYears !== null) {
    if (typeof rawYears !== "number" || !Number.isInteger(rawYears) || rawYears < 0 || rawYears > MAX_YEARS) {
      return { outcome: "invalid_input", reason: `yearsOfIncome must be an integer between 0 and ${MAX_YEARS}` };
    }
    years = rawYears;
  }
  if ((values.annualIncome ?? 0) > 0 && years === 0) {
    return { outcome: "insufficient_data", reason: "ask for how many years the family would need the income" };
  }
  const components = Object.freeze({
    debts: values.debts ?? 0,
    income: (values.annualIncome ?? 0) * years,
    mortgage: values.mortgageBalance ?? 0,
    education: values.educationFund ?? 0,
    finalExpenses: values.finalExpenses ?? 0,
  });
  const totalNeed = Object.values(components).reduce((sum, value) => sum + value, 0);
  if (totalNeed === 0) {
    return { outcome: "insufficient_data", reason: "ask about income, debts, mortgage, education or final expenses first" };
  }
  const offsets = Object.freeze({ existingCoverage: values.existingCoverage ?? 0, liquidSavings: values.liquidSavings ?? 0 });
  const gap = Math.max(0, totalNeed - offsets.existingCoverage - offsets.liquidSavings);
  return Object.freeze({
    outcome: "estimated",
    components,
    offsets,
    totalNeed,
    gap,
    roundedGap: Math.round(gap / 5_000) * 5_000,
  });
}

function usd(value: number): string {
  return `$${value.toLocaleString("en-US")}`;
}

/** Texto do resultado devolvido ao modelo: dados, não instrução, e sempre com a ressalva. */
export function coverageNeedToolOutput(result: CoverageNeedResult): string {
  if (result.outcome !== "estimated") {
    return `Coverage estimate not calculated (${result.outcome}): ${result.reason}.`;
  }
  const parts = [
    `debts ${usd(result.components.debts)}`,
    `income ${usd(result.components.income)}`,
    `mortgage ${usd(result.components.mortgage)}`,
    `education ${usd(result.components.education)}`,
    `final expenses ${usd(result.components.finalExpenses)}`,
  ];
  return [
    `Educational estimate (DIME method), not a quote or a recommendation: total need ${usd(result.totalNeed)} (${parts.join(", ")}),`,
    `minus existing coverage ${usd(result.offsets.existingCoverage)} and savings ${usd(result.offsets.liquidSavings)},`,
    `leaves a gap of about ${usd(result.roundedGap)}. The person can see this breakdown on screen.`,
    "Say it as an estimate in their language and let the licensed agent refine the amount and the product.",
  ].join(" ");
}
