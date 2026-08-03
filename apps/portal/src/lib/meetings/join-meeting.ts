/**
 * Núcleo puro (ports injetadas) que coloca um agente numa reunião externa
 * de verdade. Entrada IMEDIATA: cria a sala de vídeo do agente (Tavus) e o
 * bot do Recall.ai já com a câmera ligada nessa sala. Entrada AGENDADA:
 * cria SÓ o bot sentinela com join_at — a sala Tavus NÃO é criada agora
 * (auditoria 2026-08-02: a sala expirava — máx. 1800s — muito antes do
 * horário marcado, dinheiro gasto numa sala morta); quem liga a câmera é o
 * webhook de status do Recall quando o bot entra de verdade na reunião.
 */
export interface JoinMeetingRequest {
  readonly agentId: string;
  readonly meetingUrl: string;
  /** ISO 8601 em UTC. Ausente = entra agora. Presente = bot sentinela agendado, sem câmera ainda. */
  readonly joinAtIso?: string | null;
}

export interface AgentPersonaForMeeting {
  readonly personaId: string;
  readonly agentName: string;
}

export interface JoinMeetingDeps {
  readonly resolveAgentPersona: (agentId: string) => Promise<AgentPersonaForMeeting | null>;
  /**
   * `url` é a página que o bot renderiza como câmera (o palco do rosto);
   * `humanUrl`, quando presente, é a sala em si — para um humano acompanhar.
   */
  readonly createVideoConversation: (persona: AgentPersonaForMeeting) => Promise<{ url: string; conversationId: string; humanUrl?: string }>;
  readonly createMeetingBot: (params: {
    meetingUrl: string;
    botName: string;
    joinAtIso?: string;
    outputMediaWebpageUrl?: string;
    /** Máquina maior pro bot quando ele transmite a página da agente. */
    variant?: "web" | "web_4_core" | "web_gpu";
  }) => Promise<{ botId: string }>;
  readonly recordSession: (params: {
    agentId: string;
    botId: string;
    meetingUrl: string;
    conversationId: string | null;
  }) => Promise<void>;
  /** Encerra a sala Tavus já criada quando o bot falha — sem isto a sala paga ficava aberta (auditoria 2026-08-02). Best-effort. */
  readonly endVideoConversation: (conversationId: string) => Promise<void>;
}

export type JoinMeetingErrorCode = "invalid_request" | "agent_not_configured" | "provider_unavailable";

export class JoinMeetingError extends Error {
  readonly code: JoinMeetingErrorCode;
  constructor(code: JoinMeetingErrorCode, message: string) {
    super(message);
    this.name = "JoinMeetingError";
    this.code = code;
  }
}

export interface JoinMeetingResult {
  readonly botId: string;
  /** Sala para um humano acompanhar (null no agendado: a sala só nasce quando o bot entra). */
  readonly conversationUrl: string | null;
  readonly scheduled: boolean;
}

const MAX_MEETING_URL_CHARS = 500;

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_MEETING_URL_CHARS) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export async function handleJoinMeeting(request: JoinMeetingRequest, deps: JoinMeetingDeps): Promise<JoinMeetingResult> {
  if (!isHttpsUrl(request.meetingUrl)) {
    throw new JoinMeetingError("invalid_request", "meetingUrl must be an https URL");
  }
  if (typeof request.agentId !== "string" || request.agentId.length === 0) {
    throw new JoinMeetingError("invalid_request", "agentId is required");
  }
  const joinAtIso = typeof request.joinAtIso === "string" && request.joinAtIso.length > 0 ? request.joinAtIso : undefined;
  const scheduled = joinAtIso !== undefined;

  const persona = await deps.resolveAgentPersona(request.agentId);
  if (persona === null) {
    throw new JoinMeetingError("agent_not_configured", "this agent has no video persona configured");
  }

  // Agendado: NÃO cria a sala Tavus agora — ela expiraria (máx. 1800s) antes
  // do horário. O webhook de status do Recall cria a sala e liga a câmera
  // quando o bot realmente entra (auditoria 2026-08-02).
  let conversation: { url: string; conversationId: string; humanUrl?: string } | null = null;
  if (!scheduled) {
    try {
      conversation = await deps.createVideoConversation(persona);
    } catch {
      throw new JoinMeetingError("provider_unavailable", "failed to create the agent's video room");
    }
  }

  let bot: { botId: string };
  try {
    bot = await deps.createMeetingBot({
      meetingUrl: request.meetingUrl,
      botName: persona.agentName,
      ...(joinAtIso ? { joinAtIso } : {}),
      // Entrada imediata: já liga a câmera na criação do bot. Com a câmera
      // ligada, o bot roda uma chamada WebRTC completa dentro da página — o
      // variant default (250 millicores) produz áudio picotado e robotizado
      // (comprovado ao vivo, D-V2-093); 4 cores resolve.
      ...(conversation ? { outputMediaWebpageUrl: conversation.url, variant: "web_4_core" as const } : {}),
    });
  } catch (botError) {
    if (conversation) {
      // A sala Tavus já existe e é paga — encerra best-effort em vez de
      // deixá-la aberta sem ninguém (endConversation é idempotente).
      try {
        await deps.endVideoConversation(conversation.conversationId);
      } catch {
        // best-effort: a falha primária (bot) é a que sobe.
      }
    }
    throw botError instanceof JoinMeetingError
      ? botError
      : new JoinMeetingError("provider_unavailable", "failed to create the meeting bot");
  }

  try {
    await deps.recordSession({
      agentId: request.agentId,
      botId: bot.botId,
      meetingUrl: request.meetingUrl,
      conversationId: conversation?.conversationId ?? null,
    });
  } catch {
    // O bot já entrou de verdade — não desfazemos por falha de log (mesma
    // disciplina do resto do projeto: recibo pode falhar sem desfazer o efeito).
  }

  return {
    botId: bot.botId,
    conversationUrl: conversation ? (conversation.humanUrl ?? conversation.url) : null,
    scheduled,
  };
}
