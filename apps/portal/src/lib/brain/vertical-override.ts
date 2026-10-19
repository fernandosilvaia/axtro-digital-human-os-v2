/**
 * Troca de vertical por agente, sem migration (2026-10-17).
 *
 * A coluna `agent_video_config.closer_vertical` só aceita três valores e uma
 * vertical nova exige uma migration aplicada no hospedado pelo método da
 * janela. Enquanto isso, o operador liga o Closer da Billion Leads Pro com a
 * variável `BRAIN_VERTICAL_OVERRIDES`, um JSON de id de agente para vertical.
 *
 * A troca é deliberadamente estreita: só sobe um agente que o banco diz ser
 * `metodo_silva` para `billion_leads_sales`. Nunca toca nas verticais de seguro
 * (que carregam a sentinela de compliance) e nunca rebaixa nenhuma. Valor
 * inválido, JSON quebrado ou agente ausente deixam a vertical como está.
 */

import type { CloserVertical } from "./chat-completion-core.ts";

const OVERRIDABLE_TARGETS: ReadonlySet<string> = new Set(["billion_leads_sales"]);

export function applyVerticalOverride(vertical: CloserVertical, agentId: string, raw: string | undefined): CloserVertical {
  if (vertical !== "metodo_silva" || raw === undefined || raw.trim().length === 0) return vertical;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return vertical;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return vertical;
  const target = (parsed as Record<string, unknown>)[agentId];
  return typeof target === "string" && OVERRIDABLE_TARGETS.has(target) ? (target as CloserVertical) : vertical;
}
