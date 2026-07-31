/**
 * Núcleo puro (ports injetadas) que coloca um agente numa reunião externa
 * de verdade: cria a sala de vídeo do agente (Tavus), cria o bot do
 * Recall.ai apontado pra essa reunião, e — só na entrada IMEDIATA — já liga
 * a câmera do bot pra sala do agente na mesma chamada de criação. Entrada
 * AGENDADA cria o bot silencioso (sentinela); ligar a câmera depois é
 * responsabilidade de quem trata o fallback (ex.: humano não apareceu),
 * não deste núcleo.
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
  /** Sala para um humano acompanhar (cai no palco se não houver separada). */
  readonly conversationUrl: string;
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

  let conversation: { url: string; conversationId: string; humanUrl?: string };
  try {
    conversation = await deps.createVideoConversation(persona);
  } catch {
    throw new JoinMeetingError("provider_unavailable", "failed to create the agent's video room");
  }

  let bot: { botId: string };
  try {
    bot = await deps.createMeetingBot({
      meetingUrl: request.meetingUrl,
      botName: persona.agentName,
      ...(joinAtIso ? { joinAtIso } : {}),
      // Entrada imediata: já liga a câmera na criação do bot. Entrada agendada:
      // bot entra silencioso (sentinela) — quem trata o fallback liga a câmera depois.
      // Com a câmera ligada, o bot roda uma chamada WebRTC completa dentro da
      // página — o variant default (250 millicores) produz áudio picotado e
      // robotizado (comprovado ao vivo, D-V2-093); 4 cores resolve.
      ...(scheduled ? {} : { outputMediaWebpageUrl: conversation.url, variant: "web_4_core" as const }),
    });
  } catch {
    throw new JoinMeetingError("provider_unavailable", "failed to create the meeting bot");
  }

  try {
    await deps.recordSession({
      agentId: request.agentId,
      botId: bot.botId,
      meetingUrl: request.meetingUrl,
      conversationId: conversation.conversationId,
    });
  } catch {
    // O bot já entrou de verdade — não desfazemos por falha de log (mesma
    // disciplina do resto do projeto: recibo pode falhar sem desfazer o efeito).
  }

  return { botId: bot.botId, conversationUrl: conversation.humanUrl ?? conversation.url, scheduled };
}
