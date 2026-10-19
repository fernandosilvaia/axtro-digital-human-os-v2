/**
 * Trava de saída do Closer da Billion Leads Pro (2026-10-18).
 *
 * A simulação de conversas ao vivo mostrou o defeito mais grave: quando o trecho
 * do preço não vem na busca, a closer inventa uma tabela inteira ("10 leads por
 * 99 dólares, 25 por 199", "Solo 29 dólares por mês", "entrega em 24 a 48
 * horas", "o resto é lucro seu"), nas duas versões do prompt. Instrução de
 * prompt não segura isso, então a trava é determinística, como a sentinela do
 * seguro: nenhuma frase com valor fora da tabela verificada, promessa de ganho
 * ou prazo de entrega inventado chega à voz.
 *
 * A tabela abaixo é o retrato de 17/10/2026 (site público e código do CRM). O
 * catálogo ao vivo muda; quando mudar, mude aqui, na base de conhecimento e no
 * teste que amarra os dois, na mesma alteração. Enquanto isso o efeito de um
 * preço novo ser barrado é seguro: a closer manda conferir o valor no checkout.
 */

import { detectReplyLanguage, type SentinelLanguage } from "./compliance-sentinel.ts";

export type BillionViolation = "bl_unknown_amount" | "bl_language_mixup" | "bl_foreign_currency" | "bl_income_promise" | "bl_invented_delivery";

export interface BillionGuardResult {
  readonly reply: string;
  readonly violations: readonly BillionViolation[];
}

export const BILLION_ALLOWED_AMOUNTS: ReadonlySet<number> = new Set([
  // Planos do CRM: mensal, pré-pago e equivalente mensal
  97, 197, 397, 588, 774, 1494, 49, 129, 249,
  // Pacotes Hot em português e em espanhol: total e por lead
  300, 30, 700, 28, 1250, 25, 250, 600, 24, 1100, 22, 2000, 20,
  // Recargas da carteira e exemplo de indicação
  50, 100, 24.25, 22.25, 89,
  // Tarifas previstas de consumo (em validação)
  0.035, 0.03, 0.025, 0.022, 0.02, 0.018, 0.015, 0.29, 0.26, 0.23, 0.39, 0.35, 0.31,
]);

/** "1.250", "1,250", "0,035" e "24,25" viram números. */
export function parseAmount(raw: string): number {
  let value = raw.trim();
  if (/^0[.,]\d+$/.test(value)) return Number(value.replace(",", "."));
  if (value.includes(",") && value.includes(".")) {
    value = value.lastIndexOf(",") > value.lastIndexOf(".") ? value.replaceAll(".", "").replace(",", ".") : value.replaceAll(",", "");
  } else if (value.includes(",")) {
    const after = value.split(",").at(-1) ?? "";
    value = after.length === 3 ? value.replaceAll(",", "") : value.replace(",", ".");
  } else if (value.includes(".")) {
    const after = value.split(".").at(-1) ?? "";
    value = after.length === 3 ? value.replaceAll(".", "") : value;
  }
  return Number(value.replace(/[^\d.]/g, ""));
}

// "25 leads por 600", "100 por 2.000": o valor vem sem símbolo, depois de "por", e não é prazo nem unidade.
const BARE_PRICE_AFTER_POR = /\bpor\s+(\d[\d.,]*\d|\d)\b(?!\s*(?:%|dias?|horas?|meses|m[eê]s|minutos?|segmentos?|a[cç][oõ]es|ac[cç]i[oó]n|leads?|vez(?:es)?|cento|semanas?|anos?))/gi;

// "40 a 100 dólares": uma faixa tem dois valores, e os dois contam.
const RANGE_AMOUNT = /(\d[\d.,]*\d|\d)\s*(?:a|at[eé]|e|ou|-)\s*(\d[\d.,]*\d|\d)\s*(?:d[oó]lares|dollars)/gi;

export function amountsIn(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(RANGE_AMOUNT)) found.push(parseAmount(match[1] as string), parseAmount(match[2] as string));
  for (const match of text.matchAll(BARE_PRICE_AFTER_POR)) {
    const value = parseAmount(match[1] as string);
    if (value >= 20) found.push(value);
  }
  for (const match of text.matchAll(/(?:US\$|\$)\s?(\d[\d.,]*\d|\d)/g)) found.push(parseAmount(match[1] as string));
  for (const match of text.matchAll(/(\d[\d.,]*\d|\d)\s?(?:d[oó]lares|d[oó]lar|dollars)/gi)) found.push(parseAmount(match[1] as string));
  return found.filter((number) => Number.isFinite(number));
}

export function unknownAmounts(text: string): number[] {
  return amountsIn(text).filter((number) => !BILLION_ALLOWED_AMOUNTS.has(number));
}

const FOREIGN_CURRENCY = /\bR\$\s?\d|\d\s?reais\b/i;
const INCOME_PROMISE = /garant(?:o|imos|ido|ida|e|ia)\s+(?:que\s+)?(?:voc[eê]\s+)?(?:vai\s+)?(?:vend|fech|lucr|ganh|recuper|retorno|renda)|voc[eê]\s+vai\s+(?:vender|fechar|ganhar|lucrar|recuperar|multiplicar)|retorno garantido|dinheiro certo|todo lead vira venda|[eé] lucro (?:seu|puro|certo)|o resto [eé] lucro|cem por cento (?:de )?lucro|lucro garantido|recuper(?:a|ar) (?:o )?investimento|guaranteed to (?:pay|make|earn)|you will (?:make|earn|close)|vas a (?:vender|ganar|cerrar)/i;
// Afirmação inventada sobre comissão do cliente e conta de equilíbrio feita sobre ela. Só vale para frase
// afirmativa: a pergunta "quanto você costuma receber de comissão?" é exatamente o que a closer deve fazer.
const COMMISSION_CLAIM = /comiss[aã]o[^.?!]{0,60}\b(?:costuma|normalmente|geralmente|em m[eé]dia|varia entre|fica entre)\b|\b(?:costuma|normalmente|geralmente|em m[eé]dia)\b[^.?!]{0,40}comiss[aã]o/i;
const INVENTED_BREAKEVEN = /\b(?:com|basta|bastam)\s+\d+\s*(?:a|ou|-)?\s*\d*\s*vendas?\b[^.?!]{0,40}(?:cobre|paga|pagam|se paga|recupera|empata)/i;
const NEGATION = /\b(?:n[aã]o|nunca|nem|jamais|sem|ningu[eé]m|nenhum|nenhuma|no|not|never)\b/i;
const DELIVERY_DEADLINE = /\b(?:entrega|entregamos|entregues?|chegam?|chegar[aá]|chegar[aã]o)\b[^.?!]{0,40}\b\d+\s*(?:a|ou|-|at[eé])?\s*\d*\s*(?:horas|dias|h)\b/i;
const WINDOW_CONTEXT = /reposi|sinaliz|inv[aá]lid|pedir|prazo de|teste|gr[aá]tis|dias? a partir/i;

const FALLBACK: Readonly<Record<SentinelLanguage, string>> = {
  portuguese: "Para não te passar um valor errado, confere o preço exato na tela do catálogo, que mostra o total e o preço por lead antes de pagar. Quer que eu te guie até lá?",
  english: "To avoid giving you a wrong number, please check the exact price on the catalog screen, which shows the total and the price per lead before you pay. Want me to walk you there?",
  spanish: "Para no darle un valor equivocado, confirme el precio exacto en la pantalla del catálogo, que muestra el total y el precio por lead antes de pagar. ¿Le guío hasta allí?",
};

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

// Preço certo no idioma errado também é erro: US$ 20 é o pacote de 100 em espanhol, não existe em português.
const PT_ONLY_AMOUNTS: ReadonlySet<number> = new Set([300, 30, 700, 28, 1250]);
const ES_ONLY_AMOUNTS: ReadonlySet<number> = new Set([250, 600, 1100, 2000, 24, 22, 20]);

function mixesLanguagePrices(sentence: string): boolean {
  const amounts = amountsIn(sentence);
  const portuguese = /portugu[eê]s|portuguese/i.test(sentence);
  const spanish = /espanhol|espa[ñn]ol|spanish/i.test(sentence);
  if (portuguese && !spanish && amounts.some((amount) => ES_ONLY_AMOUNTS.has(amount))) return true;
  if (spanish && !portuguese && amounts.some((amount) => PT_ONLY_AMOUNTS.has(amount))) return true;
  return false;
}

function sentenceViolations(sentence: string): BillionViolation[] {
  const found: BillionViolation[] = [];
  if (mixesLanguagePrices(sentence)) found.push("bl_language_mixup");
  if (FOREIGN_CURRENCY.test(sentence)) found.push("bl_foreign_currency");
  if (unknownAmounts(sentence).length > 0) found.push("bl_unknown_amount");
  const promise = INCOME_PROMISE.exec(sentence);
  if (promise !== null && !NEGATION.test(sentence.slice(0, promise.index))) found.push("bl_income_promise");
  else if (!sentence.trimEnd().endsWith("?") && (COMMISSION_CLAIM.test(sentence) || INVENTED_BREAKEVEN.test(sentence))) found.push("bl_income_promise");
  if (DELIVERY_DEADLINE.test(sentence) && !WINDOW_CONTEXT.test(sentence)) found.push("bl_invented_delivery");
  return found;
}

export function enforceBillionLeadsGuard(reply: string, fallbackLanguage: SentinelLanguage): BillionGuardResult {
  const kept: string[] = [];
  const violations = new Set<BillionViolation>();
  for (const sentence of splitSentences(reply)) {
    const found = sentenceViolations(sentence);
    if (found.length === 0) kept.push(sentence);
    else for (const violation of found) violations.add(violation);
  }
  if (violations.size === 0) return { reply, violations: [] };
  const remainder = kept.join(" ").trim();
  // Uma sobra curta demais soaria cortada: melhor o recuo inteiro, no idioma da resposta.
  const safe = remainder.length >= 25 ? remainder : FALLBACK[detectReplyLanguage(reply, fallbackLanguage)];
  return { reply: safe, violations: [...violations] };
}
