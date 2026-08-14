import { NextResponse } from "next/server";

/**
 * Liveness puro: responde enquanto o processo Next consegue executar uma
 * Route Handler. Não consulta config, banco nem providers; dependências são
 * responsabilidade de /api/ready.
 */
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({
    ok: true,
    service: "axtro-portal",
    time: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}
