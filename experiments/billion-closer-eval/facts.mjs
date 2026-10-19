// Fatos verificados em 2026-10-17 (site público e código do CRM em origin/main). A tabela de valores e o leitor
// de números moram no app (`billion-guard.ts`), porque a trava de saída da closer os usa em produção; o avaliador
// importa a mesma fonte, então os dois não se separam.

export { BILLION_ALLOWED_AMOUNTS as ALLOWED_AMOUNTS, amountsIn, parseAmount, unknownAmounts } from "../../apps/portal/src/lib/brain/billion-guard.ts";
