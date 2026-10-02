import { compareCloserCandidates } from "../../packages/evaluation/dist/index.js";
import { comparisonForScenario } from "./fixtures.mjs";

/** Promptfoo custom provider integration. Executes our fixed synthetic evaluator,
 * not a closer model, LLM judge, provider request or user-supplied JavaScript. */
export default class OfflineCloserProvider {
  id() { return "axtro-synthetic-closer"; }
  async callApi(prompt, context) {
    if (typeof prompt !== "string" || prompt.length > 100 || context?.vars?.scenarioId !== prompt) {
      throw new Error("invalid synthetic scenario selector");
    }
    return { output: JSON.stringify(compareCloserCandidates(comparisonForScenario(prompt))) };
  }
}
