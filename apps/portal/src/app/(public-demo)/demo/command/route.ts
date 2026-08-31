import { NextResponse } from "next/server";

import {
  isSameOriginPublicDemoMutationRequest,
  readBoundedPublicDemoCommand,
} from "@/lib/public-demo/request";
import { runPublicDemoCommand } from "@/lib/public-demo/server-session";

export async function POST(request: Request): Promise<NextResponse> {
  if (!isSameOriginPublicDemoMutationRequest(request)) {
    return new NextResponse(null, { status: 403, headers: { "cache-control": "no-store" } });
  }
  const command = await readBoundedPublicDemoCommand(request);
  const result = await runPublicDemoCommand(command);
  return NextResponse.json(result, {
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
