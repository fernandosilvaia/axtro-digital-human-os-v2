/**
 * Terceiro adapter de provider real do projeto: Recall.ai — envia o agente
 * de vídeo (Tavus/Digital Human OS) pra dentro de reuniões externas de
 * verdade (Zoom, Google Meet, Microsoft Teams), como um participante comum.
 * Capacidade central do produto (D-V2-08x): qualquer cliente do Human
 * Digital precisa poder colocar o agente numa reunião normal, não só nas
 * salas hospedadas pelo Tavus.
 *
 * Mecanismo (confirmado na doc oficial, docs.recall.ai/docs/stream-media):
 * o bot entra na reunião-alvo e a "Output Media" API renderiza uma página
 * web como se fosse a câmera dele — a URL que passamos é literalmente a
 * sala de vídeo do agente (ex.: a URL devolvida por
 * /api/leads/video-session ou por startVideoConversation), então o bot
 * "empresta" essa página como rosto pros outros participantes.
 *
 * Mesmos guardrails dos outros dois adapters reais (OpenRouter, Tavus):
 * chave nunca aparece em erro/log, fetch injetável, timeout obrigatório,
 * caps fechados. Diferença: a Recall.ai é sharded por região (a conta do
 * cliente é provisionada numa região fixa) — a região é config explícita,
 * nunca adivinhada.
 */

export type RecallRegion = "us-east-1" | "us-west-2" | "eu-central-1" | "ap-northeast-1";

/**
 * Tamanho da máquina que roda a página de Output Media dentro do bot
 * (doc oficial "Addressing audio and video issues: bot variants"):
 * `web` = 250 millicores/750MB — insuficiente pra uma chamada WebRTC completa
 * (áudio picotado/robotizado, comprovado ao vivo em 2026-07-31);
 * `web_4_core` = 2250 millicores/5250MB; `web_gpu` = 6000 millicores + WebGL.
 */
export type MeetingBotVariant = "web" | "web_4_core" | "web_gpu";

export interface CreateMeetingBotRequest {
  readonly meetingUrl: string;
  readonly botName?: string;
  /** ISO 8601. Quando ausente, o bot tenta entrar imediatamente. */
  readonly joinAtIso?: string;
  /** Quando presente, o bot já entra com a câmera assumida (a sala de vídeo do agente) — sem precisar de uma segunda chamada a startCameraWebpage. Para o bot "sentinela" (entra silencioso, decide depois), deixe ausente. */
  readonly outputMediaWebpageUrl?: string;
  /** Aplicado aos 3 platforms (Zoom/Meet/Teams). Ausente = default do provider (`web`). */
  readonly variant?: MeetingBotVariant;
  /** Habilita transcrição da reunião (docs.recall.ai/docs/async-transcription) — necessária pra capturar o histórico da conversa depois do evento `transcript.done`. */
  readonly enableTranscription?: boolean;
}

export interface MeetingBot {
  readonly botId: string;
}

export interface TranscriptMetadata {
  readonly transcriptId: string;
  /** URL assinada (fora do domínio da Recall.ai) de onde baixar o conteúdo — null enquanto ainda não está pronta. */
  readonly downloadUrl: string | null;
}

export interface TranscriptBlock {
  readonly participantName: string | null;
  readonly isHost: boolean;
  /** Palavras do bloco já unidas em texto corrido. */
  readonly text: string;
}

export type MeetingBotErrorCode =
  | "missing_api_key"
  | "invalid_request"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_unavailable"
  | "malformed_provider_response";

export class MeetingBotError extends Error {
  readonly code: MeetingBotErrorCode;
  constructor(code: MeetingBotErrorCode, message: string) {
    super(message);
    this.name = "MeetingBotError";
    this.code = code;
  }
}

/**
 * Port pro agente entrar em reuniões externas (Zoom/Meet/Teams) e assumir a
 * câmera com a sala de vídeo do agente. `leaveCall` é irreversível (doc
 * oficial) — nunca chamado automaticamente por engano, sempre por decisão
 * explícita do chamador.
 */
export interface MeetingBotPort {
  readonly providerId: string;
  createBot(request: CreateMeetingBotRequest): Promise<MeetingBot>;
  startCameraWebpage(botId: string, webpageUrl: string): Promise<void>;
  stopCameraWebpage(botId: string): Promise<void>;
  leaveCall(botId: string): Promise<void>;
  /** GET /api/v1/transcript/{id}/ — metadados + URL de download (fora do domínio Recall.ai). */
  fetchTranscriptMetadata(transcriptId: string): Promise<TranscriptMetadata>;
  /** Baixa e faz o parse do conteúdo em downloadUrl (docs.recall.ai/docs/async-transcription). */
  downloadTranscript(downloadUrl: string): Promise<readonly TranscriptBlock[]>;
}

export interface RecallAdapterOptions {
  readonly apiKey: string;
  readonly region: RecallRegion;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

const MAX_MEETING_URL_CHARS = 500;
const MAX_BOT_NAME_CHARS = 100;
const MAX_WEBPAGE_URL_CHARS = 2000;
const MAX_DOWNLOAD_URL_CHARS = 4000;
const MAX_TRANSCRIPT_BYTES = 5_000_000;
const DEFAULT_TIMEOUT_MS = 20_000;
// Recall.ai bot/transcript ids são UUIDs (confirmado na doc oficial: "id (UUID of bot)").
const BOT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isHttpsUrl(value: string, maxChars: number): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > maxChars) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function createRecallMeetingBotPort(options: RecallAdapterOptions): MeetingBotPort {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) throw new MeetingBotError("missing_api_key", "Recall.ai API key is not configured");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const base = `https://${options.region}.recall.ai/api/v1`;

  async function call(method: "POST" | "DELETE" | "GET", path: string, body?: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImplementation(`${base}${path}`, {
        method,
        signal: controller.signal,
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new MeetingBotError("provider_timeout", `Recall.ai timed out after ${timeoutMs}ms`);
      }
      throw new MeetingBotError("provider_unavailable", "Recall.ai request failed before a response");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const code: MeetingBotErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
      throw new MeetingBotError(code, `Recall.ai respondeu HTTP ${response.status}`);
    }
    if (response.status === 204) return null;
    try {
      const text = await response.text();
      return text.length > 0 ? JSON.parse(text) : null;
    } catch {
      throw new MeetingBotError("malformed_provider_response", "Recall.ai returned non-JSON output");
    }
  }

  function validateBotId(botId: string): void {
    if (typeof botId !== "string" || !BOT_ID_PATTERN.test(botId)) {
      throw new MeetingBotError("invalid_request", "botId must be a plain Recall.ai bot id");
    }
  }

  function isHttpsDownloadUrl(value: string): boolean {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_DOWNLOAD_URL_CHARS) return false;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }

  return Object.freeze({
    providerId: "recall",
    async createBot(request: CreateMeetingBotRequest): Promise<MeetingBot> {
      if (!isHttpsUrl(request.meetingUrl, MAX_MEETING_URL_CHARS)) {
        throw new MeetingBotError("invalid_request", "meetingUrl must be an https URL");
      }
      if (request.botName !== undefined && (request.botName.length === 0 || request.botName.length > MAX_BOT_NAME_CHARS)) {
        throw new MeetingBotError("invalid_request", `botName must be 1..${MAX_BOT_NAME_CHARS} chars`);
      }
      if (request.joinAtIso !== undefined && !ISO_8601_PATTERN.test(request.joinAtIso)) {
        throw new MeetingBotError("invalid_request", "joinAtIso must be a valid ISO 8601 timestamp");
      }
      if (request.outputMediaWebpageUrl !== undefined && !isHttpsUrl(request.outputMediaWebpageUrl, MAX_WEBPAGE_URL_CHARS)) {
        throw new MeetingBotError("invalid_request", "outputMediaWebpageUrl must be an https URL");
      }

      if (request.variant !== undefined && !["web", "web_4_core", "web_gpu"].includes(request.variant)) {
        throw new MeetingBotError("invalid_request", "variant must be web, web_4_core or web_gpu");
      }

      const payload = await call("POST", "/bot/", {
        meeting_url: request.meetingUrl,
        ...(request.botName ? { bot_name: request.botName } : {}),
        ...(request.joinAtIso ? { join_at: request.joinAtIso } : {}),
        ...(request.outputMediaWebpageUrl
          ? { output_media: { camera: { kind: "webpage", config: { url: request.outputMediaWebpageUrl } } } }
          : {}),
        ...(request.variant
          ? { variant: { zoom: request.variant, google_meet: request.variant, microsoft_teams: request.variant } }
          : {}),
        ...(request.enableTranscription
          ? { recording_config: { transcript: { provider: { recallai_streaming: {} } } } }
          : {}),
        // Teto duro de bot-hora (auditoria 2026-08-02: sem isto e sem nenhum
        // call site de leaveCall, o bot ficava na reunião cobrando por hora
        // indefinidamente). Campos oficiais da doc (reference/bot_create):
        // sala Tavus vive no máx. 1800s, então 2400s de teto em call cobre
        // a conversa inteira com folga e ainda corta o pior caso.
        automatic_leave: {
          waiting_room_timeout: 900,
          noone_joined_timeout: 900,
          everyone_left_timeout: { timeout: 30 },
          in_call_not_recording_timeout: 2400,
        },
      });
      const record = (payload ?? {}) as Record<string, unknown>;
      const botId = record.id;
      if (typeof botId !== "string" || botId.length === 0) {
        throw new MeetingBotError("malformed_provider_response", "Recall.ai bot payload has no id");
      }
      return Object.freeze({ botId });
    },

    async startCameraWebpage(botId: string, webpageUrl: string): Promise<void> {
      validateBotId(botId);
      if (!isHttpsUrl(webpageUrl, MAX_WEBPAGE_URL_CHARS)) {
        throw new MeetingBotError("invalid_request", "webpageUrl must be an https URL");
      }
      await call("POST", `/bot/${botId}/output_media/`, {
        camera: { kind: "webpage", config: { url: webpageUrl } },
      });
    },

    async stopCameraWebpage(botId: string): Promise<void> {
      validateBotId(botId);
      await call("DELETE", `/bot/${botId}/output_media/`, { camera: true });
    },

    async leaveCall(botId: string): Promise<void> {
      validateBotId(botId);
      await call("POST", `/bot/${botId}/leave_call/`);
    },

    async fetchTranscriptMetadata(transcriptId: string): Promise<TranscriptMetadata> {
      if (typeof transcriptId !== "string" || !BOT_ID_PATTERN.test(transcriptId)) {
        throw new MeetingBotError("invalid_request", "transcriptId must be a plain Recall.ai transcript id");
      }
      const payload = await call("GET", `/transcript/${transcriptId}/`);
      const record = (payload ?? {}) as Record<string, unknown>;
      const id = record.id;
      if (typeof id !== "string" || id.length === 0) {
        throw new MeetingBotError("malformed_provider_response", "Recall.ai transcript payload has no id");
      }
      const downloadUrl = record.download_url;
      return Object.freeze({
        transcriptId: id,
        downloadUrl: typeof downloadUrl === "string" && downloadUrl.length > 0 ? downloadUrl : null,
      });
    },

    async downloadTranscript(downloadUrl: string): Promise<readonly TranscriptBlock[]> {
      if (!isHttpsDownloadUrl(downloadUrl)) {
        throw new MeetingBotError("invalid_request", "downloadUrl must be an https URL");
      }
      // URL assinada de storage (fora do domínio da Recall.ai) — sem header
      // de Authorization da API, e SEM base/timeout compartilhado do call().
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImplementation(downloadUrl, { signal: controller.signal });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new MeetingBotError("provider_timeout", `Recall.ai transcript download timed out after ${timeoutMs}ms`);
        }
        throw new MeetingBotError("provider_unavailable", "Recall.ai transcript download failed before a response");
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        const code: MeetingBotErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
        throw new MeetingBotError(code, `Recall.ai transcript download respondeu HTTP ${response.status}`);
      }
      // Checa Content-Length ANTES de bufferizar (achado P2 da revisão
      // adversarial 2026-08-10): não evita 100% (um servidor podia mentir
      // no header), mas corta o caso comum sem segurar o corpo inteiro em
      // memória primeiro. O teto pós-buffer abaixo continua como rede de
      // segurança pro caso do header ausente ou mentiroso.
      const declaredLength = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_TRANSCRIPT_BYTES) {
        throw new MeetingBotError("malformed_provider_response", "Recall.ai transcript exceeds the sanity size cap");
      }
      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new MeetingBotError("provider_unavailable", "Recall.ai transcript download body failed to read");
      }
      if (text.length > MAX_TRANSCRIPT_BYTES) {
        throw new MeetingBotError("malformed_provider_response", "Recall.ai transcript exceeds the sanity size cap");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new MeetingBotError("malformed_provider_response", "Recall.ai transcript download is not valid JSON");
      }
      if (!Array.isArray(parsed)) {
        throw new MeetingBotError("malformed_provider_response", "Recall.ai transcript download must be a JSON array");
      }
      return Object.freeze(parsed.map((block): TranscriptBlock => {
        const record = (block ?? {}) as Record<string, unknown>;
        const participant = (record.participant ?? {}) as Record<string, unknown>;
        const words = Array.isArray(record.words) ? record.words : [];
        const text = words
          .map((word) => (word as Record<string, unknown>)?.text)
          .filter((value): value is string => typeof value === "string")
          .join(" ");
        return Object.freeze({
          participantName: typeof participant.name === "string" ? participant.name : null,
          isHost: participant.is_host === true,
          text,
        });
      }));
    },
  });
}
