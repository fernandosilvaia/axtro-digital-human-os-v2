/**
 * Constante e type guard puros, deliberadamente FORA de
 * `lib/actions/data-governance-disposition.ts` (arquivo `"use server"`):
 * o Next.js 16 exige que todo export de um arquivo `"use server"` seja uma
 * Server Action assíncrona, então um helper síncrono ao lado quebra o build
 * de produção (mesmo defeito de `agent-video-config.ts`, D-V2-181 -- só
 * `next build` pega isso, nem `tsc --noEmit` nem lint).
 */
export const TENANT_DISPOSITION_PURPOSE_CODES = ["contract_termination", "retention_expiry", "operator_correction"] as const;
export type TenantDispositionPurposeCode = (typeof TENANT_DISPOSITION_PURPOSE_CODES)[number];

export function isTenantDispositionPurposeCode(value: unknown): value is TenantDispositionPurposeCode {
  return typeof value === "string" && (TENANT_DISPOSITION_PURPOSE_CODES as readonly string[]).includes(value);
}
