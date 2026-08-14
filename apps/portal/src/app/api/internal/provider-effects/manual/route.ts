import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(_request: NextRequest): Promise<Response> {
  // Intentionally unavailable. The unattended reconciler credential must
  // never double as an operator capability that can release an unknown paid
  // effect. A future manual surface requires authenticated operator identity,
  // two-person approval and an append-only evidence receipt.
  return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
}
