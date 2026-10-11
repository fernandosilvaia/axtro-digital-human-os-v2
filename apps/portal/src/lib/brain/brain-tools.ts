/**
 * Catálogo de ferramentas que o cérebro próprio pode oferecer ao modelo.
 *
 * A Tavus manda no corpo da requisição as tools anexadas à persona. Esse campo
 * vem do provedor, então é dado não confiável: dele só se aproveita o NOME, e
 * apenas quando o nome está nesta lista fechada. Descrição e JSON Schema que o
 * modelo vê são sempre os nossos, revisados, nunca os que chegaram no corpo.
 *
 * As três de negócio repetem literalmente o contrato do ADR-041 (o mesmo que
 * `scripts/provision-tavus-business-tools.mjs` registra na conta); um teste
 * prova que os dois não divergem. As de cena seguem desligadas no cliente
 * (call-lifecycle recusa sem manifesto validado), então não são oferecidas.
 */
import type { TextGenerationTool } from "@axtro/provider-openrouter";

export const BRAIN_BUSINESS_TOOL_NAMES = ["register_lead", "propose_meeting_slots", "confirm_meeting_slot"] as const;
export const BRAIN_CALCULATION_TOOL_NAMES = ["estimate_coverage_need"] as const;

export type BrainToolName =
  | (typeof BRAIN_BUSINESS_TOOL_NAMES)[number]
  | (typeof BRAIN_CALCULATION_TOOL_NAMES)[number];

const BRAIN_TOOLS: Readonly<Record<BrainToolName, TextGenerationTool>> = Object.freeze({
  register_lead: Object.freeze({
    name: "register_lead",
    description: "Registra um lead qualificado a partir desta conversa. Use quando tiver nome e (email ou telefone) do prospect.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        contactName: { type: "string", minLength: 1, maxLength: 200 },
        contactEmail: { type: "string", format: "email" },
        contactPhone: { type: "string", maxLength: 32 },
        qualificationSummary: { type: "string", maxLength: 2000 },
      }),
      required: ["contactName"],
    }),
  }),
  propose_meeting_slots: Object.freeze({
    name: "propose_meeting_slots",
    description: "Consulta horários disponíveis na agenda do time para uma reunião. Não agenda nada ainda.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        durationMinutes: { type: "integer", enum: [15, 30, 45, 60] },
        contactName: { type: "string", maxLength: 200 },
        contactEmail: { type: "string", format: "email" },
      }),
      required: ["durationMinutes"],
    }),
  }),
  confirm_meeting_slot: Object.freeze({
    name: "confirm_meeting_slot",
    description: "Confirma um horário já oferecido por propose_meeting_slots. Informe o NÚMERO da opção que a pessoa escolheu, na mesma numeração que você leu em voz alta (a primeira opção é 1). Nunca invente um horário fora dos oferecidos.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        slotNumber: { type: "integer", minimum: 1 },
        contactEmail: { type: "string", format: "email" },
      }),
      required: ["slotNumber", "contactEmail"],
    }),
  }),
  estimate_coverage_need: Object.freeze({
    name: "estimate_coverage_need",
    description: "Calculates an educational life insurance need estimate (DIME method) from numbers the person said out loud, and shows the breakdown on their screen. Use only with figures they gave you; never guess missing ones. The result is an estimate, never a quote or a recommendation.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        annualIncome: { type: "number", minimum: 0, description: "Yearly income in US dollars." },
        yearsOfIncome: { type: "integer", minimum: 0, maximum: 40, description: "Years the family would need that income." },
        debts: { type: "number", minimum: 0, description: "Debts other than the mortgage, in US dollars." },
        mortgageBalance: { type: "number", minimum: 0 },
        educationFund: { type: "number", minimum: 0, description: "Total education cost they want covered." },
        finalExpenses: { type: "number", minimum: 0, description: "Funeral and final bills." },
        existingCoverage: { type: "number", minimum: 0, description: "Life insurance they already have." },
        liquidSavings: { type: "number", minimum: 0, description: "Savings set aside that the family could use." },
      }),
    }),
  }),
});

const KNOWN: ReadonlySet<string> = new Set(Object.keys(BRAIN_TOOLS));

/**
 * Nomes de tools que o provedor anexou a esta persona, filtrados pela lista
 * fechada. Aceita o formato OpenAI (`{type: "function", function: {name}}`) e
 * o formato plano (`{name}`); qualquer outra coisa é ignorada.
 */
export function offeredBrainToolNames(rawTools: unknown): readonly BrainToolName[] {
  if (!Array.isArray(rawTools)) return [];
  const names: BrainToolName[] = [];
  for (const raw of rawTools.slice(0, 32)) {
    if (raw === null || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const fn = record.function !== null && typeof record.function === "object" ? record.function as Record<string, unknown> : null;
    const name = fn?.name ?? record.name;
    if (typeof name === "string" && KNOWN.has(name) && !names.includes(name as BrainToolName)) {
      names.push(name as BrainToolName);
    }
  }
  return Object.freeze(names);
}

/** Definições revisadas, na ordem oferecida. */
export function brainToolDefinitions(names: readonly BrainToolName[]): readonly TextGenerationTool[] {
  return Object.freeze(names.map((name) => BRAIN_TOOLS[name]));
}

export function hasBusinessTools(names: readonly BrainToolName[]): boolean {
  return names.some((name) => (BRAIN_BUSINESS_TOOL_NAMES as readonly string[]).includes(name));
}

export function hasCalculatorTool(names: readonly BrainToolName[]): boolean {
  return names.includes("estimate_coverage_need");
}
