import { NextResponse } from "next/server";

import { isSameOriginPublicDemoMutationRequest, publicDemoRedirectUrl } from "@/lib/public-demo/request";
import { endPublicDemoSession } from "@/lib/public-demo/server-session";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginPublicDemoMutationRequest(request)) {
    return new NextResponse(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
  await endPublicDemoSession();
  return NextResponse.redirect(publicDemoRedirectUrl("/", request), 303);
}
