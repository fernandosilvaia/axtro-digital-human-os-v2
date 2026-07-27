"use server";

import { generateBrainSecret, hashBrainSecret } from "@/lib/brain/secret";
import { createClient } from "@/lib/supabase/server";

/**
 * Gestão do segredo do cérebro customizado por agente (M4-03, 0018_agent_brain_config).
 * O segredo bruto é gerado aqui, hasheado antes de qualquer chamada ao
 * banco, e devolvido ao chamador só nesta resposta — nunca persistido em
 * texto puro, nunca lido de volta depois. As guardas de dado (tenant_admin,
 * tenant scoping) vivem nas RPCs SECURITY DEFINER da migration.
 */

export interface BrainSecretActionState {
  readonly error: string | null;
  /** Presente só na resposta de rotação bem-sucedida — exibição única. */
  readonly secret: string | null;
}

export interface BrainToggleActionState {
  readonly error: string | null;
}

export interface BrainStatusResult {
  readonly configured: boolean;
  readonly enabled: boolean | null;
  readonly rotatedAt: string | null;
}

function mapRpcError(message: string): string {
  if (message.includes("only a tenant_admin")) {
    return "Somente administradores podem gerenciar o cérebro customizado deste agente.";
  }
  if (message.includes("agent not found")) {
    return "Agente não encontrado nesta conta.";
  }
  if (message.includes("not configured")) {
    return "Gere um segredo antes de habilitar o cérebro customizado.";
  }
  return `Não foi possível concluir a operação: ${message}`;
}

export async function rotateAgentBrainSecret(agentId: string): Promise<BrainSecretActionState> {
  const rawSecret = generateBrainSecret();
  const secretHash = hashBrainSecret(rawSecret);
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_rotate_agent_brain_secret", {
    p_agent_id: agentId,
    p_secret_hash: secretHash,
  });
  if (error) {
    return { error: mapRpcError(error.message), secret: null };
  }
  return { error: null, secret: rawSecret };
}

export async function setAgentBrainEnabled(agentId: string, enabled: boolean): Promise<BrainToggleActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_set_agent_brain_enabled", {
    p_agent_id: agentId,
    p_enabled: enabled,
  });
  if (error) {
    return { error: mapRpcError(error.message) };
  }
  return { error: null };
}

export async function fetchAgentBrainStatus(agentId: string): Promise<BrainStatusResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_agent_brain_status", { p_agent_id: agentId });
  if (error || data === null || typeof data !== "object") {
    return { configured: false, enabled: null, rotatedAt: null };
  }
  const record = data as { configured: boolean; enabled?: boolean; rotated_at?: string };
  return {
    configured: record.configured === true,
    enabled: typeof record.enabled === "boolean" ? record.enabled : null,
    rotatedAt: typeof record.rotated_at === "string" ? record.rotated_at : null,
  };
}
