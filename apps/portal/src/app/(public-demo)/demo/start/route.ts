import { NextResponse } from "next/server";

import { isSameOriginPublicDemoMutationRequest, publicDemoRedirectUrl } from "@/lib/public-demo/request";
import { startPublicDemoSession } from "@/lib/public-demo/server-session";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginPublicDemoMutationRequest(request)) {
    return new NextResponse(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const available = await startPublicDemoSession();
  const target = publicDemoRedirectUrl(available ? "/demo" : "/demo?status=unavailable", request);
  return NextResponse.redirect(target, 303);
}
