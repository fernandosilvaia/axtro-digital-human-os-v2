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
  /** Bot canônico cujo recording contém este transcript. */
  readonly botId: string;
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
  /** Provider HTTP status when a response was received; absent for local/network failures. */
  readonly httpStatus: number | null;
  constructor(code: MeetingBotErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "MeetingBotError";
    this.code = code;
    this.httpStatus = httpStatus;
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
  /** GET /api/v1/bot/{expectedBotId}/ — vincula o artifact ao bot antes de devolver a URL. */
  fetchTranscriptMetadata(transcriptId: string, expectedBotId?: string): Promise<TranscriptMetadata>;
  /** Baixa e faz o parse do conteúdo em downloadUrl (docs.recall.ai/docs/async-transcription). */
  downloadTranscript(downloadUrl: string): Promise<readonly TranscriptBlock[]>;
}

export interface RecallAdapterOptions {
  readonly apiKey: string;
  readonly region: RecallRegion;
  /** Hostnames exatos autorizados para URLs assinadas de transcript. Vazio/ausente fecha o download. */
  readonly transcriptDownloadHosts?: readonly string[];
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

const MAX_MEETING_URL_CHARS = 500;
const MAX_BOT_NAME_CHARS = 100;
const MAX_WEBPAGE_URL_CHARS = 2000;
const MAX_DOWNLOAD_URL_CHARS = 4000;
const MAX_TRANSCRIPT_BYTES = 5_000_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TRANSCRIPT_REDIRECTS = 3;
const RECALL_REGIONS = new Set<RecallRegion>(["us-east-1", "us-west-2", "eu-central-1", "ap-northeast-1"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
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

export function isRecallRegion(value: string | undefined): value is RecallRegion {
  return typeof value === "string" && RECALL_REGIONS.has(value as RecallRegion);
}

export function recallApiBaseUrl(region: RecallRegion): string {
  return `https://${region}.recall.ai/api/v1`;
}

function isForbiddenHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  // URL normaliza IPv6 literal sem os colchetes em alguns runtimes e com
  // eles em outros; ambos são recusados. IP público também é recusado: a
  // configuração é deliberadamente por hostname exato, nunca por literal.
  const candidate = normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) return true;
  if (candidate.includes(":")) return true;
  return false;
}

function isExactHostname(value: string): boolean {
  if (value.length === 0 || value.length > 253 || value !== value.toLowerCase()) return false;
  if (isForbiddenHostname(value) || value.endsWith(".")) return false;
  return value.split(".").every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

/** Parse compartilhado por adapter e readiness; null significa config inválida/ausente. */
export function parseRecallTranscriptDownloadHosts(value: string | undefined): readonly string[] | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const hosts = value.split(",").map((host) => host.trim().toLowerCase());
  if (hosts.some((host) => !isExactHostname(host))) return null;
  return Object.freeze([...new Set(hosts)]);
}

export function createRecallMeetingBotPort(options: RecallAdapterOptions): MeetingBotPort {
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey.length < 8) throw new MeetingBotError("missing_api_key", "Recall.ai API key is not configured");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  if (!isRecallRegion(options.region)) throw new MeetingBotError("invalid_request", "Recall.ai region is invalid");
  const base = recallApiBaseUrl(options.region);
  const configuredTranscriptHosts = options.transcriptDownloadHosts ?? [];
  if (configuredTranscriptHosts.some((host) => !isExactHostname(host))) {
    throw new MeetingBotError("invalid_request", "Recall.ai transcript host allowlist is invalid");
  }
  const transcriptDownloadHosts = new Set(configuredTranscriptHosts);

  async function call(
    method: "POST" | "DELETE" | "GET",
    path: string,
    body?: Record<string, unknown>,
    options: Readonly<{ notFoundIsSuccess?: boolean }> = {},
  ): Promise<unknown> {
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
      clearTimeout(timer);
      if (error instanceof Error && error.name === "AbortError") {
        throw new MeetingBotError("provider_timeout", `Recall.ai timed out after ${timeoutMs}ms`);
      }
      throw new MeetingBotError("provider_unavailable", "Recall.ai request failed before a response");
    }
    // O timer segue vivo até o corpo ser consumido — headers rápidos com
    // body pendurado não escapam do timeout (achado P1 da auditoria
    // 2026-08-11, mesmo padrão já corrigido em provider-openrouter e
    // provider-tavus na auditoria 2026-08-02; este adapter tinha ficado de
    // fora daquela rodada).
    try {
      if (!response.ok) {
        // O leave é uma compensação idempotente: 404 confirma que não há bot
        // ativo para manter custo. O opt-in impede que create/get confundam
        // ausência do recurso com sucesso.
        if (response.status === 404 && options.notFoundIsSuccess === true) return null;
        const code: MeetingBotErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
        throw new MeetingBotError(code, `Recall.ai respondeu HTTP ${response.status}`, response.status);
      }
      if (response.status === 204) return null;
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new MeetingBotError("provider_timeout", `Recall.ai timed out after ${timeoutMs}ms`);
        }
        throw new MeetingBotError("malformed_provider_response", "Recall.ai returned non-JSON output");
      }
      try {
        return text.length > 0 ? JSON.parse(text) : null;
      } catch {
        throw new MeetingBotError("malformed_provider_response", "Recall.ai returned non-JSON output");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  function validateBotId(botId: string): void {
    if (typeof botId !== "string" || !BOT_ID_PATTERN.test(botId)) {
      throw new MeetingBotError("invalid_request", "botId must be a plain Recall.ai bot id");
    }
  }

  function parseSafeDownloadUrl(value: string): URL | null {
    if (typeof value !== "string" || value.length === 0 || value.length > MAX_DOWNLOAD_URL_CHARS) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0 || url.port.length > 0) return null;
      const hostname = url.hostname.toLowerCase();
      if (isForbiddenHostname(hostname) || !transcriptDownloadHosts.has(hostname)) return null;
      return url;
    } catch {
      return null;
    }
  }

  async function readBoundedTranscriptBody(response: Response, signal: AbortSignal): Promise<string> {
    const declaredLength = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_TRANSCRIPT_BYTES) {
      throw new MeetingBotError("malformed_provider_response", "Recall.ai transcript exceeds the sanity size cap");
    }
    if (response.body === null || response.body === undefined || typeof response.body.getReader !== "function") {
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAX_TRANSCRIPT_BYTES) {
        throw new MeetingBotError("malformed_provider_response", "Recall.ai transcript exceeds the sanity size cap");
      }
      return text;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
        const { done, value } = await reader.read();
        if (done) break;
        if (value !== undefined) {
          bytes += value.byteLength;
          if (bytes > MAX_TRANSCRIPT_BYTES) {
            await reader.cancel();
            throw new MeetingBotError("malformed_provider_response", "Recall.ai transcript exceeds the sanity size cap");
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
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
        // A sala Tavus vive no máx. 1800s. Limitamos a espera a 300s e cada
        // ramo in-call a 1800s, mantendo o pior caso sequencial em até 35min
        // (+ alguns segundos documentados para o leave). A reserva financeira
        // continua conservadora em 40min.
        automatic_leave: {
          waiting_room_timeout: 300,
          noone_joined_timeout: 300,
          everyone_left_timeout: { timeout: 30 },
          // Recorded meetings need their own hard ceiling; the sibling
          // non-recording timeout does not apply while transcription/recording
          // is active. Both branches are capped to the same 40-minute spend
          // envelope reserved before provider dispatch.
          recording_permission_denied_timeout: 60,
          in_call_recording_timeout: 1800,
          in_call_not_recording_timeout: 1800,
        },
      });
      const record = (payload ?? {}) as Record<string, unknown>;
      const botId = record.id;
      if (typeof botId !== "string" || !BOT_ID_PATTERN.test(botId)) {
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
      await call("POST", `/bot/${botId}/leave_call/`, undefined, { notFoundIsSuccess: true });
    },

    async fetchTranscriptMetadata(transcriptId: string, expectedBotId?: string): Promise<TranscriptMetadata> {
      if (typeof transcriptId !== "string" || !BOT_ID_PATTERN.test(transcriptId)) {
        throw new MeetingBotError("invalid_request", "transcriptId must be a plain Recall.ai transcript id");
      }
      const botId = expectedBotId ?? "";
      validateBotId(botId);
      // Retrieve Transcript não expõe bot_id no schema v1.11. O binding
      // seguro vem do Retrieve Bot: só aceitamos o artifact cujo id aparece
      // dentro de recordings[].media_shortcuts.transcript do bot esperado.
      const payload = await call("GET", `/bot/${botId}/`);
      const record = (payload ?? {}) as Record<string, unknown>;
      if (record.id !== botId || !Array.isArray(record.recordings)) {
        throw new MeetingBotError("malformed_provider_response", "Recall.ai bot transcript metadata is malformed");
      }
      let downloadUrl: string | null = null;
      for (const recordingValue of record.recordings) {
        const recording = (recordingValue ?? {}) as Record<string, unknown>;
        const shortcuts = (recording.media_shortcuts ?? {}) as Record<string, unknown>;
        const transcript = (shortcuts.transcript ?? {}) as Record<string, unknown>;
        if (transcript.id !== transcriptId) continue;
        const data = (transcript.data ?? {}) as Record<string, unknown>;
        downloadUrl = typeof data.download_url === "string" && data.download_url.length > 0 ? data.download_url : null;
        break;
      }
      if (downloadUrl === null) {
        throw new MeetingBotError("malformed_provider_response", "Recall.ai transcript does not belong to the expected bot or is not ready");
      }
      return Object.freeze({
        transcriptId,
        botId,
        downloadUrl,
      });
    },

    async downloadTranscript(downloadUrl: string): Promise<readonly TranscriptBlock[]> {
      let currentUrl = parseSafeDownloadUrl(downloadUrl);
      if (currentUrl === null) throw new MeetingBotError("invalid_request", "downloadUrl host is not authorized");
      // URL assinada de storage (fora do domínio da Recall.ai) — sem header
      // de Authorization da API, e SEM base/timeout compartilhado do call().
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        let response: Response | null = null;
        for (let redirects = 0; redirects <= MAX_TRANSCRIPT_REDIRECTS; redirects += 1) {
          response = await fetchImplementation(currentUrl.toString(), { signal: controller.signal, redirect: "manual" });
          if (!REDIRECT_STATUSES.has(response.status)) break;
          if (redirects === MAX_TRANSCRIPT_REDIRECTS) {
            throw new MeetingBotError("provider_rejected", "Recall.ai transcript download exceeded redirect cap");
          }
          const location = response.headers.get("location");
          if (location === null) throw new MeetingBotError("provider_rejected", "Recall.ai transcript redirect has no location");
          const redirected = parseSafeDownloadUrl(new URL(location, currentUrl).toString());
          if (redirected === null) throw new MeetingBotError("invalid_request", "Recall.ai transcript redirect host is not authorized");
          await response.body?.cancel().catch(() => undefined);
          currentUrl = redirected;
        }
        if (response === null) throw new MeetingBotError("provider_unavailable", "Recall.ai transcript download returned no response");
        if (!response.ok) {
          const code: MeetingBotErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
          throw new MeetingBotError(code, `Recall.ai transcript download respondeu HTTP ${response.status}`, response.status);
        }
        const text = await readBoundedTranscriptBody(response, controller.signal);
        try {
          const parsed: unknown = JSON.parse(text);
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
        } catch {
          throw new MeetingBotError("malformed_provider_response", "Recall.ai transcript download is not valid JSON");
        }
      } catch (error) {
        if (error instanceof MeetingBotError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new MeetingBotError("provider_timeout", `Recall.ai transcript download timed out after ${timeoutMs}ms`);
        }
        throw new MeetingBotError("provider_unavailable", "Recall.ai transcript download failed before completion");
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
