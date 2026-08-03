/**
 * Endpoint chamado pelo control-tower (a ligação de voz da Raissa) quando um
 * lead topa emendar pra vídeo na hora. Servidor-a-servidor, sem sessão de
 * usuário — autenticado por um segredo estático único (RAISSA_TOOLS_SECRET),
 * diferente do segredo por agente do M4 (aqui só existe UM chamador
 * conhecido e UMA agente institucional, não é multi-tenant).
 *
 * Núcleo puro (ports injetadas), mesmo padrão de handle-chat-request.ts:
 * falha de autenticação rejeita duro sem tocar Tavus; falha depois de
 * autenticar (persona não configurada, provider fora do ar) degrada para um
 * erro tipado — o chamador decide o fallback (Art. 14: nunca promete o que
 * não existe; aqui o "não existe" vira "agende" do lado do control-tower).
 */
import { constantTimeEquals } from "../security.ts";

export interface RaissaVideoConversation {
  readonly url: string;
  readonly conversationId: string;
}

export interface PlatformAgentPersona {
  readonly personaId: string;
  readonly agentName: string;
}

export interface VideoSessionDeps {
  readonly resolvePlatformAgentPersona: () => Promise<PlatformAgentPersona | null>;
  readonly createConversation: (params: { personaId: string; leadName: string | null; language: string | null; context: string | null }) => Promise<RaissaVideoConversation>;
}

export type VideoSessionErrorCode = "missing_bearer" | "invalid_secret" | "not_configured" | "provider_unavailable";

export class VideoSessionError extends Error {
  readonly code: VideoSessionErrorCode;
  readonly status: number;
  constructor(code: VideoSessionErrorCode, status: number, message: string) {
    super(message);
    this.name = "VideoSessionError";
    this.code = code;
    this.status = status;
  }
}

export interface VideoSessionRequest {
  readonly authorizationHeader: string | null;
  readonly expectedSecret: string | null;
  readonly leadName?: string | null;
  readonly language?: string | null;
  /** Resumo da ligação de voz que já aconteceu (dor, porte, o que o lead disse) — a Raissa Vídeo continua a conversa em vez de recomeçar do zero. Dado não confiável (Art. 15): vira contexto, nunca instrução de sistema. */
  readonly context?: string | null;
}

const BEARER_PREFIX = "Bearer ";
const MAX_LEAD_NAME_CHARS = 120;
const MAX_CONTEXT_CHARS = 4000;
const ALLOWED_LANGUAGES = new Set(["portuguese", "english", "spanish"]);

function extractBearer(authorizationHeader: string | null): string | null {
  if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith(BEARER_PREFIX)) return null;
  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/** Comparação em tempo constante para um segredo estático único — nunca `===` direto num bearer. */
const secretsMatch = constantTimeEquals;

export function authenticateVideoSessionRequest(request: Pick<VideoSessionRequest, "authorizationHeader" | "expectedSecret">): void {
  const expected = request.expectedSecret;
  if (typeof expected !== "string" || expected.length < 16) {
    throw new VideoSessionError("not_configured", 503, "RAISSA_TOOLS_SECRET is not configured in this environment");
  }
  const provided = extractBearer(request.authorizationHeader);
  if (provided === null) {
    throw new VideoSessionError("missing_bearer", 401, "missing or malformed Authorization bearer");
  }
  if (!secretsMatch(provided, expected)) {
    throw new VideoSessionError("invalid_secret", 401, "bearer does not match the configured secret");
  }
}

export async function handleVideoSessionRequest(request: VideoSessionRequest, deps: VideoSessionDeps): Promise<RaissaVideoConversation> {
  authenticateVideoSessionRequest(request);

  const leadName = typeof request.leadName === "string" && request.leadName.trim().length > 0 && request.leadName.length <= MAX_LEAD_NAME_CHARS
    ? request.leadName.trim()
    : null;
  const language = typeof request.language === "string" && ALLOWED_LANGUAGES.has(request.language) ? request.language : null;
  const context = typeof request.context === "string" && request.context.trim().length > 0
    ? request.context.trim().slice(0, MAX_CONTEXT_CHARS)
    : null;

  const persona = await deps.resolvePlatformAgentPersona();
  if (persona === null) {
    throw new VideoSessionError("not_configured", 503, "no platform-presentation agent is configured for video sessions");
  }

  try {
    return await deps.createConversation({ personaId: persona.personaId, leadName, language, context });
  } catch {
    throw new VideoSessionError("provider_unavailable", 502, "video provider failed to create a conversation");
  }
}
