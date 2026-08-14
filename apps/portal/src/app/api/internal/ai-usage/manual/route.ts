import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(_request: NextRequest): Promise<Response> {
  // Deliberately unavailable in M5-01. A global bearer can authorize
  // read-only aggregate observation, but it is not an operator identity and
  // cannot authorize a financial state transition. M5-02 must introduce an
  // authenticated operator, dual approval and an auditable approval receipt
  // before this route may inspect a request body or call the service-only RPC.
  return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
}
