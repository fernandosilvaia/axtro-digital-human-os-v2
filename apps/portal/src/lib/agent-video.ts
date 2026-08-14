// Módulo exclusivo de servidor (importado apenas por server actions):
// auto-provisão de persona de vídeo quando um agente é ativado sem config.
// Antes disso, só os agentes demo (configurados à mão) tinham vídeo — um
// cliente novo ativava o agente e ficava sem videochamada, apresentação e
// reunião externa. Agora a ativação cria a persona no provider com o
// Cérebro Método Silva, voz, percepção e tools de slides, e grava a config
// via RPC (supabase-only 0022).
import { createTavusVideoConversationPort } from "@axtro/provider-tavus";

import { buildCloserVideoSystemPrompt, buildPerceptionQueries, tenantLanguageToBrainLanguage } from "@/lib/brain/metodo-silva";
import type { createClient } from "@/lib/supabase/server";
import { logError as trackError, logEvent } from "@/lib/telemetry";
import { resolveAgentVideoConfig } from "@/lib/video-config";

/**
 * Tools de controle de slides registradas na conta Tavus da plataforma
 * (D-V2-074: next_slide, previous_slide, go_to_slide). Ids estáveis da
 * conta — se a conta do provider mudar, re-registrar e atualizar aqui.
 */
const SLIDE_TOOL_IDS = ["tc73be288e9ee", "te6d66b7519f4", "t99c0623a882c"] as const;

/** Voz padrão das agentes pt-BR (ElevenLabs "Raissa", D-V2-067). */
const DEFAULT_VOICE_ID = "jXrDvfgyizjxORhXsh4y";

export interface ProvisionResult {
  readonly provisioned: boolean;
  readonly personaId?: string;
  /**
   * true quando esta chamada realmente tentou criar a persona (não é o modo
   * fake nem um agente que já tinha vídeo configurado) e não conseguiu —
   * distingue "nada a fazer" de "quebrou" pro chamador poder avisar o
   * usuário em vez de deixar a falha muda (achado ao vivo W7 2026-08-14:
   * ativação sempre mostrava sucesso mesmo com a persona nunca criada).
   */
  readonly attempted?: boolean;
}

/**
 * Cria a persona de vídeo do agente e grava a config. Best-effort por
 * contrato: falha aqui NUNCA desfaz a ativação do agente — o chat continua
 * funcionando e o vídeo pode ser provisionado depois (re-ativar o agente
 * tenta de novo).
 */
export async function provisionAgentVideoIfMissing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  agent: { readonly id: string; readonly name: string },
  tenantName: string,
  /** default_language do tenant (ex.: "pt-BR", "en-US") — achado D-V2-115: antes hardcoded como português, ignorando esta config. */
  tenantDefaultLanguage: string,
): Promise<ProvisionResult> {
  const tavusApiKey = (process.env.TAVUS_API_KEY ?? "").trim();
  const replicaId = (process.env.TAVUS_REPLICA_ID ?? "").trim();
  if (process.env.PORTAL_FAKE_PROVIDERS === "1") return { provisioned: false };
  if (tavusApiKey.length === 0 || replicaId.length === 0) {
    // Achado onda 8 (D-V2-117): diferente do modo fake (intencional, acima),
    // chave/replica ausentes aqui é config quebrada de verdade — sem log,
    // toda ativação de agente falhava a auto-provisão de vídeo em silêncio.
    trackError("agent_video_autoprovision_config_missing", new Error("TAVUS_API_KEY or TAVUS_REPLICA_ID not configured"), { agent_id: agent.id });
    return { provisioned: false, attempted: true };
  }

  // Falha de LEITURA não é "não configurado": seguir adiante criaria uma
  // persona duplicada no provider e sobrescreveria uma persona curada à mão.
  // Ativação continua mesmo assim — provisão fica pra próxima ativação/pausa+ativação.
  const configResult = await resolveAgentVideoConfig(supabase, agent.id, "auto-provision");
  if (!configResult.ok) return { provisioned: false, attempted: true };
  if (configResult.config.configured) return { provisioned: false };

  const firstName = agent.name.split(/[\s—-]+/)[0] ?? agent.name;
  const elevenKey = (process.env.ELEVENLABS_API_KEY ?? "").trim();
  const voiceId = (process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID).trim();
  const language = tenantLanguageToBrainLanguage(tenantDefaultLanguage);

  try {
    const port = createTavusVideoConversationPort({ apiKey: tavusApiKey });
    const persona = await port.createPersona({
      personaName: `${firstName} — ${tenantName} (auto)`.slice(0, 120),
      systemPrompt: buildCloserVideoSystemPrompt({ agentName: firstName, tenantName, language }),
      defaultReplicaId: replicaId,
      ambientAwarenessQueries: buildPerceptionQueries(language),
      ...(elevenKey.length > 0 ? { elevenLabs: { apiKey: elevenKey, voiceId } } : {}),
    });

    // Tools de slides: sem elas o modo apresentação não anda — mas a persona
    // já fala e ouve; falha aqui não descarta a provisão.
    try {
      await port.attachToolsToPersona(persona.personaId, [...SLIDE_TOOL_IDS]);
    } catch (toolsError) {
      trackError("agent_video_tools_attach_failed", toolsError, { agent_id: agent.id, persona_id: persona.personaId });
    }

    const { error: rpcError } = await supabase.rpc("portal_set_agent_video_config", {
      p_agent_id: agent.id,
      p_persona_id: persona.personaId,
      p_language: language,
      p_presentation_kind: "sales",
    });
    if (rpcError) {
      trackError("agent_video_config_save_failed", rpcError, { agent_id: agent.id, persona_id: persona.personaId });
      return { provisioned: false, attempted: true };
    }

    logEvent("agent_video_provisioned", { agent_id: agent.id, persona_id: persona.personaId });
    return { provisioned: true, personaId: persona.personaId };
  } catch (error) {
    trackError("agent_video_provision_failed", error, { agent_id: agent.id });
    return { provisioned: false, attempted: true };
  }
}
