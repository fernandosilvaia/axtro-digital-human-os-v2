import { NextRequest, NextResponse } from "next/server";

import { AdmissionError, authenticateCrmCaller, issueAdmission, parseAdmissionRequest } from "@/lib/closers/billion-admission";
import { recordAdmission } from "@/lib/closers/billion-store";
import { billionCloserEnabled, resolveBillionAgent } from "@/lib/closers/billion-server";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { readBoundedTextBody } from "@/lib/http/read-bounded-body";
import { isRateLimited } from "@/lib/rate-limit";
import { hashAccountRef } from "@/lib/closers/billion-admission";
import { logEvent } from "@/lib/telemetry";

/**
 * Emite a admissão da closer da Billion (ADR-051). Chamada só pelo backend do CRM, com o segredo
 * de serviço próprio. Sem o aviso de IA confirmado na versão vigente não existe admissão.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
// Pré-filtro barato em memória; o teto que vale é o do banco (recibo durável, migração 0079).
const PREFILTER_PER_ACCOUNT_PER_DAY = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(request: NextRequest): Promise<Response> {
  if (!billionCloserEnabled(process.env)) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
  try {
    authenticateCrmCaller(request.headers.get("authorization"), process.env.BILLION_CLOSER_SERVICE_SECRET);
    if (isRateLimited("billion-closer:admission", 60_000, 60)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    const raw = await readBoundedTextBody(request, MAX_BODY_BYTES);
    if (!raw.ok) return NextResponse.json({ error: raw.reason === "too_large" ? "payload_too_large" : "invalid_body" }, { status: raw.reason === "too_large" ? 413 : 400 });
    let body: unknown;
    try {
      body = JSON.parse(raw.text);
    } catch {
      return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
    }
    const parsed = parseAdmissionRequest(body);
    if (isRateLimited(`billion-closer:account:${hashAccountRef(parsed.accountRef)}`, DAY_MS, PREFILTER_PER_ACCOUNT_PER_DAY)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    const agent = await resolveBillionAgent(process.env);
    if (agent === null) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
    const { token, admission } = issueAdmission(parsed, process.env.BILLION_CLOSER_ADMISSION_KEY);
    // O aviso de IA só vale depois de gravado: sem o recibo durável não sai admissão.
    const receipt = await recordAdmission(createServiceRoleClient(), admission, agent.agentId);
    if (receipt === "limit") return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    if (receipt === "revoked") return NextResponse.json({ error: "account_opted_out" }, { status: 403 });
    if (receipt === "unavailable") return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
    // Só metadado: nunca o identificador da conta, nunca o nome.
    logEvent("billion_closer_admission_issued", { admission_id: admission.id, language: admission.lang, interest: admission.interest, stage: admission.stage, disclosure_version: admission.disc.ver });
    return NextResponse.json({ admission: token, expiresAt: new Date(admission.exp * 1000).toISOString(), disclosureVersion: admission.disc.ver });
  } catch (error) {
    if (error instanceof AdmissionError) return NextResponse.json({ error: error.code }, { status: error.status });
    if (error instanceof ServiceRoleUnavailableError) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
