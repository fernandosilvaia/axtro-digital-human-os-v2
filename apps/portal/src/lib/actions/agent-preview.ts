"use server";

export interface PreviewTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AgentPreviewResult {
  readonly reply: string | null;
  readonly error: string | null;
}

const PORTAL_TEXT_PREVIEW_RECOVERY_MESSAGE =
  "O preview de texto está temporariamente indisponível enquanto a proteção de privacidade é restaurada.";

/**
 * ADR-042 keeps the legacy text preview closed until its complete contract-first
 * runtime is restored. This action intentionally owns no auth, database, ledger
 * or provider dependency, so configuration cannot reopen the legacy path.
 */
export async function sendAgentPreviewMessage(
  _agentId: string,
  _history: readonly PreviewTurn[],
  _userMessage: string,
  _transcriptId?: string,
): Promise<AgentPreviewResult> {
  return { reply: null, error: PORTAL_TEXT_PREVIEW_RECOVERY_MESSAGE };
}
