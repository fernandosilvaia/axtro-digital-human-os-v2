"use server";

import { createTavusVideoConversationPort, VideoProviderError } from "@axtro/provider-tavus";

import { fakeProvidersEnabled } from "@/lib/knowledge";
import { isRateLimited } from "@/lib/rate-limit";
import { VIDEO_CAP_MESSAGE } from "@/lib/video-cap";
import { beginProviderEffect, commitProviderEffectOrCompensate, compensateCommittedProviderEffect, fenceProviderFailure, isPaidEffectCommandId, paidEffectIntentKey, providerCorrelationLabel, releaseProviderEffect, retryReleasedProviderEffect, terminateProviderEffectForOperator } from "@/lib/paid-effects";
import { fetchAgents, fetchTenantOverview } from "@/lib/portal-data";
import { buildDeckContext, buildPlatformDeck, buildSalesDeck, type Deck } from "@/lib/presentation/deck";
import { admitPortalChannel, assertPortalProviderDispatchActive, bindPortalProviderChannel, type PortalChannelConsentConfirmation, type PortalChannelGrant, type PortalRuntimeOutcomeCode } from "@/lib/runtime/portal-channel-runtime-bridge";
import { createClient } from "@/lib/supabase/server";
import { logError as trackError } from "@/lib/telemetry";
import { prepareTavusWebhookCallback, registerTranscriptPlaceholder } from "@/lib/transcripts/register";
import { fetchKnowledgeDigest, resolveAgentVideoConfig } from "@/lib/video-config";

export interface VideoConversationResult {
  readonly url: string | null;
  readonly error: string | null;
}

/**
 * Explicit, purpose-scoped confirmation supplied by the signed portal action.
 * The server turns this into immutable disclosure/consent evidence in the
 * same transaction as the channel grant; it is never browser-only authority.
 */
export type VideoChannelConsent = PortalChannelConsentConfirmation;

export interface StopVideoConversationResult {
  readonly stopped: boolean;
  readonly error: string | null;
}

export interface PresentationConversationResult {
  readonly url: string | null;
  readonly conversationId: string | null;
  readonly deck: Deck | null;
  readonly error: string | null;
  /** Modo demonstração sem provider de vídeo: deck navegável manualmente. */
  readonly simulated?: boolean;
}

/**
 * Dedup de curta janela contra duplo-clique/duas abas/retry de rede (achado
 * onda 7, D-V2-116) — mesmo padrão já aplicado a joinExternalMeeting em
 * D-V2-114 (meeting-bot.ts), que ficou de fora dessa correção por engano.
 * Sem isto, duas chamadas a port.createConversation (Tavus, recurso pago
 * real, ~US$0,175/conversa de piso) criavam duas salas pra uma intenção só.
 *
 * `tenant_id` é OBRIGATÓRIO na chave (achado da própria auto-revisão desta
 * onda): `agents.id` NÃO é globalmente único — a PRIMARY KEY é composta
 * `(tenant_id, id)` (database/migrations/0002_control_plane.sql) e
 * `portal_create_agent` aceita um `p_id` escolhido pelo chamador sem checar
 * outros tenants. Uma chave só por agentId permitiria um tenant atacante
 * criar um agente-isca com o `id` de um agente de OUTRO tenant e envenenar
 * o slot de dedup da vítima antes de qualquer chamada real à Tavus — nega
 * o recurso pago principal de um cliente pagante de graça. `timestampsByKey`
 * (rate-limit.ts) é um Map único por processo, sem escopo de tenant algum,
 * então o isolamento tem que vir da própria chave.
 *
 * Checado logo ANTES da chamada paga — depois de todas as validações
 * gratuitas (cap, config, digest) — pra não consumir o slot de dedup numa
 * falha genuína não-relacionada.
 */
const VIDEO_CONVERSATION_DEDUP_WINDOW_MS = 30_000;
const VIDEO_RUNTIME_PURPOSES = ["recording", "persistent_transcription", "behavioral_analysis", "visual_analysis"] as const;

function runtimeAdmissionError(code: PortalRuntimeOutcomeCode): string {
  switch (code) {
    case "denied_disclosure":
      return "Leia e confirme a identificação da IA antes de iniciar a sessão.";
    case "denied_essential_consent":
      return "O processamento essencial precisa ser autorizado para iniciar a sessão.";
    case "denied_optional_consent":
      return "Esta sessão exige confirmação separada para gravação, transcrição e análises declaradas.";
    case "one_mouth_conflict":
      return "Já existe uma apresentação ativa deste agente. Encerre-a antes de iniciar outra.";
    case "kill_switch_active":
      return "Este canal foi pausado pela equipe responsável. Tente novamente mais tarde.";
    case "bridge_disabled":
    case "channel_inactive":
      return "O canal de vídeo protegido ainda não está disponível neste ambiente.";
    default:
      return "A sessão não pôde ser autorizada com segurança. Tente novamente.";
  }
}

async function admitAuthenticatedTavusChannel(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    readonly tenantId: string;
    readonly agentId: string;
    readonly commandId: string;
    readonly consent: VideoChannelConsent;
  },
) {
  const { data: { user } } = await supabase.auth.getUser();
  const actorId = typeof user?.app_metadata?.actor_id === "string" ? user.app_metadata.actor_id : undefined;
  return admitPortalChannel({
    tenantId: input.tenantId,
    agentId: input.agentId,
    commandId: input.commandId,
    ...(actorId === undefined ? {} : { actorId }),
    channel: "tavus_video",
    requestedPurposes: VIDEO_RUNTIME_PURPOSES,
    confirmation: input.consent,
    disclosure: {
      deliveredBy: "authenticated_portal",
      version: "portal-video-v43",
      channel: "visual",
      language: "pt-BR",
    },
  });
}

async function claimTavusRuntimeDispatch(grant: PortalChannelGrant): Promise<PortalRuntimeOutcomeCode | null> {
  const result = await assertPortalProviderDispatchActive({ grant, consumerKind: "tavus" });
  return result.outcome === "consumed" ? null : result.code;
}

async function bindCommittedTavusRuntimeChannel(
  grant: PortalChannelGrant,
  reservationId: string,
  conversationId: string,
  conversationUrl: string,
): Promise<PortalRuntimeOutcomeCode | null> {
  const dispatchFailure = await claimTavusRuntimeDispatch(grant);
  if (dispatchFailure) return dispatchFailure;
  const binding = await bindPortalProviderChannel({
    grant,
    reservationId,
    provider: "tavus",
    providerRef: conversationId,
    providerUrl: conversationUrl,
  });
  return binding.outcome === "bound" || binding.outcome === "replayed" ? null : binding.code;
}

function videoConversationDedupKey(tenantId: string, commandId: string, mode: "video" | "presentation"): string {
  return `video-conversation:${tenantId}:${commandId}:${mode}`;
}

/**
 * Operator stop uses a durable tenant-admin lease. It reports provider request
 * acceptance only; this path does not prove a physical media boundary.
 */
async function stopTavusConversation(
  agentId: string,
  commandId: string,
  mode: "video" | "presentation",
): Promise<StopVideoConversationResult> {
  if (!isPaidEffectCommandId(commandId)) return { stopped: false, error: "A intenção não é válida." };
  const apiKey = process.env.TAVUS_API_KEY ?? "";
  if (apiKey.trim().length === 0) return { stopped: false, error: "O provider de vídeo ainda não está configurado neste ambiente." };

  const [overview, agents] = await Promise.all([fetchTenantOverview(), fetchAgents()]);
  if (!overview.provisioned || !overview.tenant) return { stopped: false, error: "Conta ainda não provisionada." };
  const tenantId = overview.tenant.id;
  if (!agents.some((candidate) => candidate.id === agentId)) return { stopped: false, error: "Agente não encontrado nesta conta." };

  const port = createTavusVideoConversationPort({ apiKey });
  const result = await terminateProviderEffectForOperator({
    tenantId, agentId, commandId, provider: "tavus",
    discriminator: mode === "video" ? "tavus:video" : "tavus:presentation",
    terminate: (providerRef) => port.endConversation(providerRef),
  });
  if (result.outcome === "accepted") return { stopped: true, error: null };
  if (result.outcome === "disabled") return { stopped: false, error: "O encerramento seguro por provider ainda não está disponível neste ambiente." };
  if (result.outcome === "in_progress") return { stopped: false, error: "Uma solicitação de encerramento já está em andamento." };
  if (result.outcome === "retry_after" || result.outcome === "retryable_failure") return { stopped: false, error: "O provider ainda não aceitou o encerramento. Tente novamente em instantes." };
  if (result.outcome === "operator_required") return { stopped: false, error: "O encerramento exige intervenção da equipe responsável." };
  return { stopped: false, error: "Não encontramos uma chamada ativa para encerrar." };
}

export async function stopVideoConversation(agentId: string, commandId: string): Promise<StopVideoConversationResult> {
  return stopTavusConversation(agentId, commandId, "video");
}

export async function stopPresentationConversation(agentId: string, commandId: string): Promise<StopVideoConversationResult> {
  return stopTavusConversation(agentId, commandId, "presentation");
}

export async function startVideoConversation(agentId: string, commandId: string, consent: VideoChannelConsent): Promise<VideoConversationResult> {
  if (!isPaidEffectCommandId(commandId)) return { url: null, error: "A intenção da chamada é inválida. Tente novamente." };
  const apiKey = process.env.TAVUS_API_KEY ?? "";
  const defaultReplicaId = process.env.TAVUS_REPLICA_ID ?? "";
  if (apiKey.trim().length === 0) {
    // Achado onda 8 (D-V2-117): sem isto, TAVUS_API_KEY ausente/typo'd
    // falhava toda tentativa de vídeo com uma mensagem genérica pro
    // usuário e zero sinal pro operador. Guard de fake mode (achado da
    // própria auto-revisão): sem ele, o modo demo LEGÍTIMO do produto
    // (PORTAL_FAKE_PROVIDERS=1, sem chave real de propósito) disparava
    // esse mesmo log de erro toda vez — falso positivo tratando ambiente
    // corretamente configurado como quebrado.
    if (!fakeProvidersEnabled()) {
      trackError("video_conversation_tavus_key_missing", new Error("TAVUS_API_KEY not configured"), { agent_id: agentId, mode: "video" });
    }
    return { url: null, error: "O provider de vídeo ainda não está configurado neste ambiente." };
  }

  const [overview, agents] = await Promise.all([fetchTenantOverview(), fetchAgents()]);
  if (!overview.provisioned || !overview.tenant) {
    return { url: null, error: "Conta ainda não provisionada." };
  }
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return { url: null, error: "Agente não encontrado nesta conta." };
  }

  // Config de vídeo específica do agente (persona própria = voz/percepção próprias).
  const supabase = await createClient();

  const configResult = await resolveAgentVideoConfig(supabase, agentId, "video");
  if (!configResult.ok) {
    return { url: null, error: configResult.error };
  }
  const config = configResult.config;

  // Conhecimento ativo da conta vira contexto da chamada (RAG de vídeo).
  const knowledgeDigest = await fetchKnowledgeDigest(supabase, agentId, "video", 3500);

  const personaId = config.configured && config.persona_id ? config.persona_id : undefined;
  const replicaId = config.configured && config.replica_id ? config.replica_id : defaultReplicaId;
  if (!personaId && replicaId.trim().length === 0) {
    return { url: null, error: "Este agente ainda não tem avatar de vídeo configurado." };
  }
  const language = config.language ?? "portuguese";

  const runtimeAdmission = await admitAuthenticatedTavusChannel(supabase, {
    tenantId: overview.tenant.id,
    agentId,
    commandId,
    consent,
  });
  if (runtimeAdmission.outcome === "rejected") {
    return { url: null, error: runtimeAdmissionError(runtimeAdmission.code) };
  }
  const runtimeGrant = runtimeAdmission.grant;

  // createTavusVideoConversationPort é validação local síncrona (chave
  // presente mas curta demais lança aqui) — roda ANTES do guard de dedup,
  // não depois, senão uma falha de config pura já teria consumido o slot
  // de dedup do agente por engano (achado da própria auto-revisão desta
  // onda: mesma preocupação que motivou o posicionamento do guard em si).
  const port = createTavusVideoConversationPort({ apiKey });
  const reservationInput = {
    tenantId: overview.tenant.id,
    agentId,
    provider: "tavus" as const,
    idempotencyKey: paidEffectIntentKey(commandId, "tavus:video"),
    relatedRef: "portal-video",
    maxDurationSeconds: 600,
  };
  const reservation = await retryReleasedProviderEffect(reservationInput, await beginProviderEffect(reservationInput));
  if (reservation.outcome === "capped") return { url: null, error: VIDEO_CAP_MESSAGE };
  if (reservation.outcome === "blocked_unknown" || reservation.reservationId === null) {
    return { url: null, error: "Uma tentativa anterior ainda está em reconciliação. Aguarde antes de tentar novamente." };
  }
  if (reservation.state === "committed" && reservation.providerUrl && reservation.providerRef) {
    const bindingFailure = await bindCommittedTavusRuntimeChannel(runtimeGrant, reservation.reservationId, reservation.providerRef, reservation.providerUrl);
    if (bindingFailure) {
      await compensateVideoConversation(port, reservation.reservationId, reservation.providerRef, "runtime_binding_failed").catch(() => undefined);
      return { url: null, error: runtimeAdmissionError(bindingFailure) };
    }
    if (reservation.customerDeliveryState === "activated") return { url: reservation.providerUrl, error: null };
    const persisted = await registerTranscriptPlaceholder(overview.tenant.id, agentId, "video", reservation.providerRef);
    if (persisted) return { url: reservation.providerUrl, error: null };
    await compensateVideoConversation(port, reservation.reservationId, reservation.providerRef, "replay_persistence_failed").catch(() => undefined);
    return { url: null, error: "A chamada não pôde ser registrada com segurança. Tente novamente." };
  }
  if (isRateLimited(videoConversationDedupKey(overview.tenant.id, commandId, "video"), VIDEO_CONVERSATION_DEDUP_WINDOW_MS, 1)) {
    return { url: null, error: "Uma chamada já está sendo aberta para este agente — aguarde alguns segundos antes de tentar de novo." };
  }
  const dispatchFailure = await claimTavusRuntimeDispatch(runtimeGrant);
  if (dispatchFailure) {
    await releaseProviderEffect(reservation.reservationId, "not_dispatched").catch(() => undefined);
    return { url: null, error: runtimeAdmissionError(dispatchFailure) };
  }
  let callbackUrl: string;
  try {
    callbackUrl = (await prepareTavusWebhookCallback(reservation.reservationId)).callbackUrl;
  } catch (error) {
    trackError("video_webhook_capability_bind_failed", error, { agent_id: agentId });
    return { url: null, error: "A chamada não pôde ser preparada com segurança. Tente novamente." };
  }
  try {
    const conversation = await port.createConversation(
      personaId
        ? {
            // A persona já carrega prompt, voz, percepção e interrupção — reforçamos
            // idioma, duração e (quando houver) o conhecimento autorizado da conta.
            personaId,
            conversationName: providerCorrelationLabel(`preview-${agent.id.slice(0, 8)}`, reservation.reservationId, 120),
            ...(knowledgeDigest ? { conversationalContext: buildKnowledgeContext(knowledgeDigest) } : {}),
            language,
            maxCallDurationSeconds: 600,
            callbackUrl,
          }
        : {
            replicaId,
            conversationName: providerCorrelationLabel(`preview-${agent.id.slice(0, 8)}`, reservation.reservationId, 120),
            conversationalContext: buildVideoSalesContext(agent.name, overview.tenant.legal_name, knowledgeDigest, language),
            // Saudação e contexto no MESMO idioma passado ao provider — um
            // agente configurado em inglês abria a call ouvindo pt-BR
            // (achado da auditoria 2026-08-02, fechado nesta onda).
            greeting: language === "english"
              ? `Hi! I'm ${firstName(agent.name)}, digital consultant at ${overview.tenant.legal_name}. Great to see you! Tell me — what brought you here today?`
              : `Oi! Eu sou ${firstName(agent.name)}, consultora digital da ${overview.tenant.legal_name}. Que bom te ver! Me conta — o que te trouxe até aqui hoje?`,
            language,
            maxCallDurationSeconds: 600,
            callbackUrl,
          },
    );
    await commitProviderEffectOrCompensate(
      reservation.reservationId, "tavus", conversation.conversationId,
      () => port.endConversation(conversation.conversationId), conversation.conversationUrl,
    );
    const bindingFailure = await bindPortalProviderChannel({
      grant: runtimeGrant,
      reservationId: reservation.reservationId,
      provider: "tavus",
      providerRef: conversation.conversationId,
      providerUrl: conversation.conversationUrl,
    });
    if (bindingFailure.outcome === "rejected") {
      await compensateVideoConversation(port, reservation.reservationId, conversation.conversationId, "runtime_binding_failed").catch(() => undefined);
      return { url: null, error: runtimeAdmissionError(bindingFailure.code) };
    }
    // Placeholder do histórico (D-V2-106) — o webhook da Tavus preenche
    // `turns` quando a call terminar (application.transcription_ready).
    if (!(await registerTranscriptPlaceholder(overview.tenant.id, agentId, "video", conversation.conversationId))) {
      try {
        await compensateVideoConversation(port, reservation.reservationId, conversation.conversationId, "transcript_persistence_failed");
      }
      catch (compensationError) { trackError("video_transcript_compensation_failed", compensationError, { agent_id: agentId }); }
      return { url: null, error: "A chamada não pôde ser registrada com segurança. Tente novamente." };
    }
    // Provider cost is committed, but customer billing stays held until the
    // capability-authenticated transcript callback proves a human user turn.
    return { url: conversation.conversationUrl, error: null };
  } catch (error) {
    await fenceProviderFailure(reservation.reservationId, error).catch((fenceError) => trackError("video_effect_fence_failed", fenceError, { agent_id: agentId }));
    if (error instanceof VideoProviderError) {
      if (error.code === "provider_rejected") {
        return { url: null, error: "O provider de vídeo recusou a chamada (limite de conversas simultâneas ou créditos). Tente novamente em instantes." };
      }
      return { url: null, error: "Não foi possível iniciar a conversa em vídeo agora." };
    }
    return { url: null, error: "Erro inesperado ao iniciar o vídeo." };
  }
}

/**
 * Sala de APRESENTAÇÃO: a agente conduz um deck de slides ao vivo (tools
 * next_slide/previous_slide/go_to_slide anexadas à persona) enquanto vende
 * pela Reunião Silva. Exige persona configurada — o modo réplica não tem
 * tools. O digest de conhecimento divide o teto de 6000 chars do contexto
 * com o roteiro do deck.
 */
export async function startPresentationConversation(agentId: string, commandId: string, consent: VideoChannelConsent): Promise<PresentationConversationResult> {
  if (!isPaidEffectCommandId(commandId)) return { url: null, conversationId: null, deck: null, error: "A intenção da apresentação é inválida. Tente novamente." };
  const apiKey = process.env.TAVUS_API_KEY ?? "";
  const fakeMode = fakeProvidersEnabled();
  if (apiKey.trim().length === 0 && !fakeMode) {
    trackError("video_conversation_tavus_key_missing", new Error("TAVUS_API_KEY not configured"), { agent_id: agentId, mode: "presentation" });
    return { url: null, conversationId: null, deck: null, error: "O provider de vídeo ainda não está configurado neste ambiente." };
  }

  const [overview, agents] = await Promise.all([fetchTenantOverview(), fetchAgents()]);
  if (!overview.provisioned || !overview.tenant) {
    return { url: null, conversationId: null, deck: null, error: "Conta ainda não provisionada." };
  }
  const agent = agents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    return { url: null, conversationId: null, deck: null, error: "Agente não encontrado nesta conta." };
  }

  const supabase = await createClient();
  const configResult = await resolveAgentVideoConfig(supabase, agentId, "presentation");
  if (!configResult.ok) {
    return { url: null, conversationId: null, deck: null, error: configResult.error };
  }
  const config = configResult.config;
  const language: "portuguese" | "english" = config.language === "english" ? "english" : "portuguese";

  const deck = config.presentation_kind === "platform"
    ? buildPlatformDeck(firstName(agent.name))
    : buildSalesDeck({ agentName: firstName(agent.name), tenantName: overview.tenant.legal_name, language });

  // Modo demonstração (T3): sem sala de vídeo real — o deck volta navegável
  // manualmente, sem tocar o provider nem o ledger.
  if (fakeMode) {
    return { url: null, conversationId: "simulated", deck, error: null, simulated: true };
  }

  const personaId = config.configured ? config.persona_id ?? null : null;
  if (!personaId) {
    return { url: null, conversationId: null, deck: null, error: "Este agente ainda não tem persona de vídeo configurada — o modo apresentação exige uma." };
  }

  const runtimeAdmission = await admitAuthenticatedTavusChannel(supabase, {
    tenantId: overview.tenant.id,
    agentId,
    commandId,
    consent,
  });
  if (runtimeAdmission.outcome === "rejected") {
    return { url: null, conversationId: null, deck: null, error: runtimeAdmissionError(runtimeAdmission.code) };
  }
  const runtimeGrant = runtimeAdmission.grant;

  // Digest menor que no modo livre: o roteiro do deck divide o mesmo teto de
  // 6000 chars do conversational_context do adapter.
  const knowledgeDigest = await fetchKnowledgeDigest(supabase, agentId, "presentation", 2400);

  const contextParts = [buildDeckContext(deck, language)];
  if (knowledgeDigest) contextParts.push("", buildKnowledgeContext(knowledgeDigest));
  const conversationalContext = contextParts.join("\n").slice(0, 5900);

  // Validação local síncrona ANTES do guard de dedup — mesma razão da
  // startVideoConversation acima (achado da auto-revisão desta onda).
  const port = createTavusVideoConversationPort({ apiKey });
  const reservationInput = {
    tenantId: overview.tenant.id,
    agentId,
    provider: "tavus" as const,
    idempotencyKey: paidEffectIntentKey(commandId, "tavus:presentation"),
    relatedRef: "portal-presentation",
    maxDurationSeconds: 900,
  };
  const reservation = await retryReleasedProviderEffect(reservationInput, await beginProviderEffect(reservationInput));
  if (reservation.outcome === "capped") return { url: null, conversationId: null, deck: null, error: VIDEO_CAP_MESSAGE };
  if (reservation.outcome === "blocked_unknown" || reservation.reservationId === null) return { url: null, conversationId: null, deck: null, error: "Uma tentativa anterior ainda está em reconciliação." };
  if (reservation.state === "committed" && reservation.providerUrl && reservation.providerRef) {
    const bindingFailure = await bindCommittedTavusRuntimeChannel(runtimeGrant, reservation.reservationId, reservation.providerRef, reservation.providerUrl);
    if (bindingFailure) {
      await compensateVideoConversation(port, reservation.reservationId, reservation.providerRef, "runtime_binding_failed").catch(() => undefined);
      return { url: null, conversationId: null, deck: null, error: runtimeAdmissionError(bindingFailure) };
    }
    if (reservation.customerDeliveryState === "activated") return { url: reservation.providerUrl, conversationId: reservation.providerRef, deck, error: null };
    const persisted = await registerTranscriptPlaceholder(overview.tenant.id, agentId, "video", reservation.providerRef);
    if (persisted) return { url: reservation.providerUrl, conversationId: reservation.providerRef, deck, error: null };
    await compensateVideoConversation(port, reservation.reservationId, reservation.providerRef, "replay_persistence_failed").catch(() => undefined);
    return { url: null, conversationId: null, deck: null, error: "A apresentação não pôde ser registrada com segurança." };
  }
  if (isRateLimited(videoConversationDedupKey(overview.tenant.id, commandId, "presentation"), VIDEO_CONVERSATION_DEDUP_WINDOW_MS, 1)) {
    return { url: null, conversationId: null, deck: null, error: "Uma apresentação já está sendo aberta para este agente — aguarde alguns segundos antes de tentar de novo." };
  }
  const dispatchFailure = await claimTavusRuntimeDispatch(runtimeGrant);
  if (dispatchFailure) {
    await releaseProviderEffect(reservation.reservationId, "not_dispatched").catch(() => undefined);
    return { url: null, conversationId: null, deck: null, error: runtimeAdmissionError(dispatchFailure) };
  }
  let callbackUrl: string;
  try {
    callbackUrl = (await prepareTavusWebhookCallback(reservation.reservationId)).callbackUrl;
  } catch (error) {
    trackError("presentation_webhook_capability_bind_failed", error, { agent_id: agentId });
    return { url: null, conversationId: null, deck: null, error: "A apresentação não pôde ser preparada com segurança." };
  }
  try {
    const conversation = await port.createConversation({
      personaId,
      conversationName: providerCorrelationLabel(`apresentacao-${agent.id.slice(0, 8)}`, reservation.reservationId, 120),
      conversationalContext,
      language,
      maxCallDurationSeconds: 900,
      callbackUrl,
    });
    await commitProviderEffectOrCompensate(
      reservation.reservationId, "tavus", conversation.conversationId,
      () => port.endConversation(conversation.conversationId), conversation.conversationUrl,
    );
    const bindingFailure = await bindPortalProviderChannel({
      grant: runtimeGrant,
      reservationId: reservation.reservationId,
      provider: "tavus",
      providerRef: conversation.conversationId,
      providerUrl: conversation.conversationUrl,
    });
    if (bindingFailure.outcome === "rejected") {
      await compensateVideoConversation(port, reservation.reservationId, conversation.conversationId, "runtime_binding_failed").catch(() => undefined);
      return { url: null, conversationId: null, deck: null, error: runtimeAdmissionError(bindingFailure.code) };
    }
    if (!(await registerTranscriptPlaceholder(overview.tenant.id, agentId, "video", conversation.conversationId))) {
      try {
        await compensateVideoConversation(port, reservation.reservationId, conversation.conversationId, "transcript_persistence_failed");
      }
      catch (compensationError) { trackError("presentation_transcript_compensation_failed", compensationError, { agent_id: agentId }); }
      return { url: null, conversationId: null, deck: null, error: "A apresentação não pôde ser registrada com segurança." };
    }
    // Delivery/billing is activated only by the authenticated Tavus callback
    // after a non-empty human turn is durably present in the transcript.
    return { url: conversation.conversationUrl, conversationId: conversation.conversationId, deck, error: null };
  } catch (error) {
    await fenceProviderFailure(reservation.reservationId, error).catch((fenceError) => trackError("presentation_effect_fence_failed", fenceError, { agent_id: agentId }));
    if (error instanceof VideoProviderError && error.code === "provider_rejected") {
      return { url: null, conversationId: null, deck: null, error: "O provider de vídeo recusou a chamada (limite de conversas simultâneas ou créditos). Tente novamente em instantes." };
    }
    return { url: null, conversationId: null, deck: null, error: "Não foi possível iniciar a apresentação agora." };
  }
}

async function compensateVideoConversation(
  port: ReturnType<typeof createTavusVideoConversationPort>,
  reservationId: string,
  conversationId: string,
  failureCode: string,
): Promise<void> {
  await compensateCommittedProviderEffect({
    reservationId,
    provider: "tavus",
    providerRef: conversationId,
    failureCode,
    terminate: () => port.endConversation(conversationId),
  });
}

function firstName(agentName: string): string {
  return agentName.split(/[\s—-]+/)[0] ?? agentName;
}

function buildKnowledgeContext(digest: string): string {
  return [
    "CONHECIMENTO AUTORIZADO DA CONTA — sua única fonte de fatos sobre produtos, preços, condições e políticas nesta chamada.",
    "Cite apenas o que está aqui; o que não estiver, diga com naturalidade que confirma com o time e conduza para o próximo passo. Nunca invente números.",
    "",
    digest,
  ].join("\n");
}

function buildVideoSalesContext(agentName: string, tenantLegalName: string, knowledgeDigest: string | null, language: string = "portuguese"): string {
  // Mesma doutrina nos dois idiomas — um agente configurado em inglês
  // recebia contexto mandando falar pt-BR (auditoria 2026-08-02).
  const context = language === "english"
    ? [
        `You are "${agentName}", a digital sales closer for the account "${tenantLegalName}" on the Axtro Digital Human OS platform. You are on a LIVE sales VIDEO CALL with a potential customer.`,
        "Your mission is to drive the COMPLETE SALE in this conversation: build rapport, uncover the real need, present the solution connected to that need, handle objections with empathy and confidence, and CLOSE.",
        "PERSONALITY: warm and consultative. You genuinely care about the customer's problem — listen, validate what you heard, and only then move forward. Calm confidence, never arrogance.",
        "VIDEO PACING (critical): speak in VERY SHORT turns — at most 1 to 2 sentences at a time, and ONE question per turn. Never dump lists or spoken paragraphs. Let the customer talk more than you.",
        "FIRM CLOSING: whenever there is a buying signal or a resolved objection, ask for the commitment clearly — for example: \"Can I schedule your technical visit this week?\" or \"I'll send you the formal proposal today, deal?\". Don't wait for the customer to ask; lead. If they decline, understand why and try an alternative close before backing off.",
        "Inviolable rules:",
        "1. You are an AI agent and never pretend to be human — if asked, confirm naturally in one sentence and get back to the sale.",
        knowledgeDigest
          ? "2. The AUTHORIZED KNOWLEDGE at the end of this context is your only source of facts about products, prices and terms. Quote only what is in it; anything else, say naturally that you'll confirm with the team and move to the next step. Never invent numbers."
          : "2. This account has not connected its official pricing sources yet: do NOT quote prices or ranges. When asked about price, turn it into progress: \"the price depends on sizing — I'll get you the exact number in the proposal; can I schedule the technical visit?\".",
        "3. Never promise what has not been configured on the account. No invented discounts, invented deadlines or invented guarantees.",
        "4. Speak natural, warm English, like on a real video call.",
        "5. Every one of your turns ends by leading: a discovery question, an objection treatment or a closing ask.",
      ]
    : [
        `Você é "${agentName}", vendedora digital (Sales Closer) da conta "${tenantLegalName}" na plataforma Axtro Digital Human OS. Você está numa VIDEOCHAMADA de vendas ao vivo com um cliente em potencial.`,
        "Sua missão é conduzir a VENDA COMPLETA nesta conversa: criar rapport, descobrir a necessidade real, apresentar a solução conectada a essa necessidade, tratar objeções com empatia e segurança, e FECHAR.",
        "PERSONALIDADE: calorosa e consultiva. Você genuinamente se importa com o problema do cliente — escuta, valida o que ouviu, e só então avança. Confiança tranquila, nunca arrogância.",
        "RITMO DE VÍDEO (crítico): fale em turnos BEM CURTOS — no máximo 1 a 2 frases por vez, e UMA pergunta por turno. Nunca despeje listas ou parágrafos falados. Deixe o cliente falar mais do que você.",
        "FECHAMENTO FIRME: toda vez que houver sinal de interesse ou uma objeção resolvida, peça o compromisso com clareza — por exemplo: \"Posso agendar sua visita técnica ainda essa semana?\" ou \"Te mando a proposta formal hoje, fechado?\". Não espere o cliente pedir; conduza. Se ele recusar, entenda o porquê e tente um fechamento alternativo antes de recuar.",
        "Regras invioláveis:",
        "1. Você é uma agente de IA e nunca finge ser humana — se perguntarem, confirme com naturalidade em uma frase e volte pra venda.",
        knowledgeDigest
          ? "2. O CONHECIMENTO AUTORIZADO ao final deste contexto é sua única fonte de fatos sobre produtos, preços e condições. Cite apenas o que está nele; o que não estiver, diga com naturalidade que confirma com o time e conduza para o próximo passo. Nunca invente números."
          : "2. Esta conta ainda não conectou as fontes oficiais de preços: NÃO cite valores, nem faixas. Quando pedirem preço, transforme em avanço: \"o valor depende do dimensionamento — te entrego o número exato na proposta; posso agendar a visita técnica?\".",
        "3. Nunca prometa o que não foi configurado na conta. Nada de descontos inventados, prazos inventados ou garantias inventadas.",
        "4. Fale português brasileiro natural e caloroso, como numa conversa de vídeo real.",
        "5. Todo turno seu termina conduzindo: uma pergunta de descoberta, um tratamento de objeção ou um pedido de fechamento.",
      ];
  if (knowledgeDigest) {
    context.push("", buildKnowledgeContext(knowledgeDigest));
  }
  return context.join("\n");
}
