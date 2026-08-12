"use server";

import { createClient } from "@/lib/supabase/server";

export interface DeleteTranscriptState {
  readonly error: string | null;
}

const DELETE_TRANSCRIPT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  "only a tenant_admin can delete conversation transcripts": "Somente administradores podem excluir conversas.",
  "transcript not found for this account": "Conversa não encontrada.",
};

/**
 * Exclusão sob pedido de uma conversa (achado P1 confirmado, auditoria
 * 2026-08-12): a /privacidade promete exclusão de histórico a qualquer
 * momento, mas não existia RPC nem UI pra cumprir isso — migration 0034.
 */
export async function deleteConversationTranscript(id: string): Promise<DeleteTranscriptState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_delete_conversation_transcript", { p_id: id });
  if (error) {
    return { error: DELETE_TRANSCRIPT_ERROR_MESSAGES[error.message] ?? `Não foi possível excluir: ${error.message}` };
  }
  return { error: null };
}
