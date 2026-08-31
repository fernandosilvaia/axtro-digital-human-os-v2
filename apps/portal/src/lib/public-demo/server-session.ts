import type { PortalPublicDemoActionResult } from "@axtro/contracts-ts";
import { createUuidV7 } from "@axtro/domain";
import { cookies } from "next/headers";

import {
  acquirePublicDemoCapacity,
  createInitialPublicDemoState,
  executePublicDemoCommand,
  isPublicDemoEdgePolicyAttested,
  isPublicDemoStateSecretConfigured,
  issuePublicDemoStateToken,
  PUBLIC_DEMO_EDGE_POLICY_ATTESTATION_ENV,
  PUBLIC_DEMO_MAX_COMMANDS,
  PUBLIC_DEMO_STATE_SECRET_ENV,
  verifyPublicDemoStateToken,
  type PublicDemoSignedStatePayload,
} from "./index.ts";

export const PUBLIC_DEMO_COOKIE = "axtro_public_demo";

export type PublicDemoView = Readonly<{
  revision: number;
  surface: PublicDemoSignedStatePayload["surface"];
  step: PublicDemoSignedStatePayload["step"];
  commandsRemaining: number;
}>;

function demoSecret(): string | null {
  const value = process.env[PUBLIC_DEMO_STATE_SECRET_ENV];
  const edgePolicyAttestation = process.env[PUBLIC_DEMO_EDGE_POLICY_ATTESTATION_ENV];
  return isPublicDemoStateSecretConfigured(value)
    && isPublicDemoEdgePolicyAttested(edgePolicyAttestation)
    ? value
    : null;
}

function unavailableResult(): PortalPublicDemoActionResult {
  return Object.freeze({
    schema_version: "2.0.0",
    outcome: "unavailable",
    revision: null,
    surface: null,
    step: null,
    commands_remaining: null,
    reason_code: "demo_unavailable",
  });
}

function viewFromState(state: PublicDemoSignedStatePayload): PublicDemoView {
  return Object.freeze({
    revision: state.revision,
    surface: state.surface,
    step: state.step,
    commandsRemaining: PUBLIC_DEMO_MAX_COMMANDS - state.revision,
  });
}

function cookieAttributes(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/demo",
    expires,
    priority: "high" as const,
  };
}

async function clearDemoCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PUBLIC_DEMO_COOKIE, "", {
    ...cookieAttributes(new Date(0)),
    maxAge: 0,
  });
}

async function setDemoCookie(token: string, state: PublicDemoSignedStatePayload): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PUBLIC_DEMO_COOKIE, token, cookieAttributes(new Date(state.expires_at)));
}

/** Starts a synthetic session without reading or changing Supabase Auth. */
export async function startPublicDemoSession(): Promise<boolean> {
  const lease = acquirePublicDemoCapacity("start");
  if (lease === null) {
    await clearDemoCookie();
    return false;
  }

  const secret = demoSecret();
  try {
    if (secret === null) {
      await clearDemoCookie();
      return false;
    }
    const now = new Date();
    const state = createInitialPublicDemoState(createUuidV7(), now);
    const token = issuePublicDemoStateToken(state, secret, now);
    await setDemoCookie(token, state);
    return true;
  } catch {
    await clearDemoCookie();
    return false;
  } finally {
    lease.release();
  }
}

/** Returns only the browser-safe view. The signed token remains HttpOnly. */
export async function readPublicDemoView(): Promise<PublicDemoView | null> {
  const lease = acquirePublicDemoCapacity("read");
  if (lease === null) return null;

  try {
    const secret = demoSecret();
    if (secret === null) return null;

    const cookieStore = await cookies();
    const token = cookieStore.get(PUBLIC_DEMO_COOKIE)?.value;
    if (token === undefined) return null;

    try {
      return viewFromState(verifyPublicDemoStateToken(token, secret));
    } catch {
      return null;
    }
  } finally {
    lease.release();
  }
}

/** Applies one closed local command and rotates only the dedicated demo cookie. */
export async function runPublicDemoCommand(
  command: unknown,
): Promise<PortalPublicDemoActionResult> {
  const lease = acquirePublicDemoCapacity("command");
  if (lease === null) return unavailableResult();

  try {
    const secret = demoSecret();
    if (secret === null) {
      await clearDemoCookie();
      return unavailableResult();
    }

    const cookieStore = await cookies();
    const stateToken = cookieStore.get(PUBLIC_DEMO_COOKIE)?.value;
    const output = executePublicDemoCommand({
      stateToken,
      command,
      stateSecret: secret,
    });

    if (output.nextStateToken === null) {
      await clearDemoCookie();
      return output.result;
    }

    if (output.result.outcome === "applied") {
      try {
        const state = verifyPublicDemoStateToken(output.nextStateToken, secret);
        await setDemoCookie(output.nextStateToken, state);
      } catch {
        await clearDemoCookie();
        return unavailableResult();
      }
    }

    return output.result;
  } finally {
    lease.release();
  }
}

/** Ends only the simulation. Customer authentication cookies are untouched. */
export async function endPublicDemoSession(): Promise<void> {
  const lease = acquirePublicDemoCapacity("command");
  try {
    await clearDemoCookie();
  } finally {
    lease?.release();
  }
}
