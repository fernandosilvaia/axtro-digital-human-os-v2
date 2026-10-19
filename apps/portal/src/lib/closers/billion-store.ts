/**
 * Recibo durável da admissão da closer da Billion (ADR-051 etapa 2, migração 0079). Fala só com as
 * quatro funções service_role. Qualquer falha de banco vira "unavailable" e o canal fecha: sem o
 * recibo gravado não existe aviso de IA provado (ADR-038).
 */
import type { BillionAdmission } from "./billion-admission.ts";

interface RpcClient {
  rpc(name: string, args: Readonly<Record<string, unknown>>): PromiseLike<{ readonly data: unknown; readonly error: { readonly message?: string } | null }>;
}

export const ADMISSIONS_PER_ACCOUNT_PER_DAY = 6;
export const VIDEOS_PER_ACCOUNT_PER_DAY = 2;

export type IssueOutcome = "issued" | "limit" | "revoked" | "unavailable";
export type CheckOutcome = { readonly valid: true } | { readonly valid: false; readonly reason: "not_found" | "revoked" | "expired" | "unavailable" };
export type VideoOutcome = "reserved" | "already" | "limit" | "invalid" | "unavailable";

function record(data: unknown): Record<string, unknown> | null {
  return data !== null && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
}

export async function recordAdmission(client: RpcClient, admission: BillionAdmission, agentId: string): Promise<IssueOutcome> {
  const { data, error } = await client.rpc("portal_issue_billion_closer_admission_service", {
    p_id: admission.id,
    p_agent_id: agentId,
    p_account_hash: admission.acct,
    p_language: admission.lang,
    p_interest: admission.interest,
    p_stage: admission.stage,
    p_disclosure_version: admission.disc.ver,
    p_disclosed_at: new Date(admission.disc.at * 1000).toISOString(),
    p_expires_at: new Date(admission.exp * 1000).toISOString(),
    p_max_per_day: ADMISSIONS_PER_ACCOUNT_PER_DAY,
  });
  const outcome = record(data)?.outcome;
  if (error || (outcome !== "issued" && outcome !== "limit" && outcome !== "revoked")) return "unavailable";
  return outcome;
}

export async function checkAdmission(client: RpcClient, admissionId: string): Promise<CheckOutcome> {
  const { data, error } = await client.rpc("portal_check_billion_closer_admission_service", { p_id: admissionId });
  const result = record(data);
  if (error || result === null) return { valid: false, reason: "unavailable" };
  if (result.valid === true) return { valid: true };
  const reason = result.reason;
  return { valid: false, reason: reason === "not_found" || reason === "revoked" || reason === "expired" ? reason : "unavailable" };
}

export async function reserveVideo(client: RpcClient, admissionId: string): Promise<VideoOutcome> {
  const { data, error } = await client.rpc("portal_reserve_billion_closer_video_service", { p_id: admissionId, p_max_per_day: VIDEOS_PER_ACCOUNT_PER_DAY });
  const outcome = record(data)?.outcome;
  if (error || (outcome !== "reserved" && outcome !== "already" && outcome !== "limit" && outcome !== "invalid")) return "unavailable";
  return outcome;
}

export async function revokeAccount(client: RpcClient, accountHash: string): Promise<number | null> {
  const { data, error } = await client.rpc("portal_revoke_billion_closer_account_service", { p_account_hash: accountHash });
  return error || typeof data !== "number" ? null : data;
}
