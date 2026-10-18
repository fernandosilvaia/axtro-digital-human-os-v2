// Fatos verificados em 2026-10-17 (site público e código do CRM em origin/main). Todo valor em dólar que a
// closer disser precisa estar aqui. Quando o catálogo mudar, mude aqui e na base, na mesma alteração.

export const ALLOWED_AMOUNTS = Object.freeze(new Set([
  // Planos do CRM: mensal, pré-pago e equivalente mensal
  97, 197, 397, 588, 774, 1494, 49, 129, 249,
  // Pacotes Hot em português e em espanhol: total e por lead
  300, 30, 700, 28, 1250, 25, 250, 600, 24, 1100, 22, 2000, 20,
  // Recargas da carteira e exemplo de indicação
  50, 100, 24.25, 22.25, 89,
  // Tarifas previstas de consumo (em validação)
  0.035, 0.03, 0.025, 0.022, 0.02, 0.018, 0.015, 0.29, 0.26, 0.23, 0.39, 0.35, 0.31,
]));

/** "US$ 1.250", "$1,250", "US$ 0,035" e "300 dólares" viram números. */
export function parseAmount(raw) {
  let value = raw.trim();
  // "0,035" e "0.035" são decimais, não milhares.
  if (/^0[.,]\d+$/.test(value)) return Number(value.replace(",", "."));
  if (value.includes(",") && value.includes(".")) {
    const lastComma = value.lastIndexOf(",");
    const lastDot = value.lastIndexOf(".");
    value = lastComma > lastDot ? value.replaceAll(".", "").replace(",", ".") : value.replaceAll(",", "");
  } else if (value.includes(",")) {
    const after = value.split(",").at(-1) ?? "";
    value = after.length === 3 ? value.replaceAll(",", "") : value.replace(",", ".");
  } else if (value.includes(".")) {
    const after = value.split(".").at(-1) ?? "";
    value = after.length === 3 ? value.replaceAll(".", "") : value;
  }
  return Number(value.replace(/[^\d.]/g, ""));
}

export function amountsIn(text) {
  const found = [];
  for (const match of text.matchAll(/(?:US\$|\$)\s?(\d[\d.,]*\d|\d)/g)) found.push(parseAmount(match[1]));
  for (const match of text.matchAll(/(\d[\d.,]*\d|\d)\s?(?:d[oó]lares|d[oó]lar|dollars)/gi)) found.push(parseAmount(match[1]));
  return found.filter((number) => Number.isFinite(number));
}

export function unknownAmounts(text) {
  return amountsIn(text).filter((number) => !ALLOWED_AMOUNTS.has(number));
}
