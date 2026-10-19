import { NextRequest, NextResponse } from "next/server";

import { AdmissionError, authenticateCrmCaller, hashAccountRef } from "@/lib/closers/billion-admission";
import { revokeAccount } from "@/lib/closers/billion-store";
import { billionCloserEnabled } from "@/lib/closers/billion-server";
import { readBoundedTextBody } from "@/lib/http/read-bounded-body";
import { isRateLimited } from "@/lib/rate-limit";
import { createServiceRoleClient, ServiceRoleUnavailableError } from "@/lib/supabase/service";
import { logEvent } from "@/lib/telemetry";

/**
 * Pedido de parar (ADR-051): o CRM manda quando a pessoa fecha o painel com "não quero falar" ou
 * pede para parar. Revoga as admissões vigentes da conta e bloqueia nova emissão por 24 horas.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  if (!billionCloserEnabled(process.env)) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
  try {
    authenticateCrmCaller(request.headers.get("authorization"), process.env.BILLION_CLOSER_SERVICE_SECRET);
    if (isRateLimited("billion-closer:revoke", 60_000, 60)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    const raw = await readBoundedTextBody(request, 2 * 1024);
    if (!raw.ok) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    let accountRef: unknown;
    try {
      accountRef = (JSON.parse(raw.text) as { accountRef?: unknown } | null)?.accountRef;
    } catch {
      return NextResponse.json({ error: "invalid_json_body" }, { status: 400 });
    }
    if (typeof accountRef !== "string" || accountRef.length < 8 || accountRef.length > 128) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const revoked = await revokeAccount(createServiceRoleClient(), hashAccountRef(accountRef));
    if (revoked === null) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
    logEvent("billion_closer_account_revoked", { revoked });
    return NextResponse.json({ revoked });
  } catch (error) {
    if (error instanceof AdmissionError) return NextResponse.json({ error: error.code }, { status: error.status });
    if (error instanceof ServiceRoleUnavailableError) return NextResponse.json({ error: "closer_unavailable" }, { status: 503 });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
