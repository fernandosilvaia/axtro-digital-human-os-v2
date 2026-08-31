"use server";

import type {
  PortalTextPreviewActionResult,
  PortalTextPreviewBrowserCommand,
} from "@axtro/contracts-ts";

const PORTAL_TEXT_PREVIEW_RECOVERY_MESSAGE =
  "O preview de texto está temporariamente indisponível enquanto a proteção de privacidade é restaurada.";

/**
 * ADR-044 keeps the public preview closed until M6-06 proves every operational
 * rollout gate. This action intentionally owns no auth, database, ledger or
 * provider dependency, so configuration cannot reopen the legacy path.
 */
export async function sendAgentPreviewMessage(
  _command: PortalTextPreviewBrowserCommand,
): Promise<PortalTextPreviewActionResult> {
  return Object.freeze({
    schema_version: "2.0.0",
    outcome: "failure",
    reply: null,
    error: PORTAL_TEXT_PREVIEW_RECOVERY_MESSAGE,
    stateToken: null,
    persistence: "disabled",
  });
}
