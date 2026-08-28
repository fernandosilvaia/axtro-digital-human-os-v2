/**
 * Quinto adapter de provider real do projeto: Google Calendar — a peça de
 * integração isolada que ADR-039 ("Bridge de ações de negócio do Portal")
 * pede para `confirm_meeting_slot`/`propose_meeting_slots`: consultar
 * disponibilidade real (FreeBusy), criar um evento real com um id gerado
 * pelo chamador (recuperação de reserva no padrão ADR-036), buscar um
 * evento existente (reconciliação de uma linha `unknown`), cancelar um
 * evento (rollback de uma reserva que nunca deveria ter existido), trocar um
 * `refresh_token` OAuth por um `access_token` de curto prazo, e (onda
 * 1b-ii) trocar o `code` de autorização inicial pelo primeiro
 * `refresh_token`/`access_token` de um tenant. Mesmos guardrails dos outros
 * quatro adapters reais (OpenRouter, Tavus, Recall.ai, Telnyx): fetch
 * injetável, timeout obrigatório, erro tipado, segredo nunca aparece em
 * erro/log, validação de input fechada antes da rede.
 *
 * Diferença estrutural dos outros quatro: nenhum usa uma chave de API única
 * de plataforma. Google Calendar é OAuth por tenant (ADR-039, "Credencial do
 * Google Calendar por tenant"). Correção da onda 1b-ii: o parágrafo anterior
 * desta doc dizia que este pacote "nunca vê nem simula o fluxo de
 * autorização inicial" — isso deixou de ser verdade para a TROCA em si
 * (`exchangeGoogleAuthorizationCode`, abaixo, espelha `refreshGoogleAccessToken`
 * exatamente). O que continua fora deste pacote, de propósito, é só a
 * MONTAGEM do redirect pro consent screen do Google (`client_id`,
 * `redirect_uri`, `scope`, `state` anti-CSRF) e tudo que depende de sessão
 * HTTP/cookie do portal (gerar e validar o `state`, saber qual tenant/actor
 * iniciou o fluxo) — isso é trabalho da rota de callback OAuth do portal
 * (`apps/portal/src/app/api/google-calendar/oauth/callback/route.ts`) e das
 * Server Actions de conectar/desconectar
 * (`apps/portal/src/lib/actions/calendar-connection.ts`), nunca deste
 * pacote sem estado. A migration e a RPC de custódia do refresh token no
 * Supabase Vault também ficam fora desta fatia (ver ADR-039).
 *
 * Fontes consultadas (2026-08-25), doc real, não memória de treino:
 * - Base URL + shape de request/response de cada método (FreeBusy, Events
 *   insert/get/delete): discovery document oficial e versionado da própria
 *   Google, https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest
 *   (`baseUrl: "https://www.googleapis.com/calendar/v3/"`). É a mesma fonte
 *   que as client libraries oficiais da Google usam para se gerar — mais
 *   confiável que a página HTML renderizada por JS do site de docs.
 * - **Events.insert com id gerado pelo chamador + retry em conflito (a
 *   hipótese que ADR-039 pedia para confirmar ou refutar): CONFIRMADO**,
 *   com uma ressalva do próprio Google. Duas fontes oficiais concordam:
 *   1) developers.google.com/calendar/api/guides/create-events, seção
 *      "Event ID": "When creating an event, you can choose to generate
 *      your own event ID that conforms to format requirements. [...] It
 *      also prevents duplicate event creation if the operation fails at
 *      some point after it is successfully executed in the Calendar
 *      backend." (página com "Last updated 2026-08-24 UTC" no momento da
 *      consulta).
 *   2) developers.google.com/calendar/api/guides/errors, seção "409: The
 *      requested identifier already exists": "An instance with the given
 *      ID already exists in the storage." — corpo `{"error":{"errors":
 *      [{"domain":"global","reason":"duplicate","message":"The requested
 *      identifier already exists."}],"code":409, ...}}`. Ação sugerida
 *      pelo próprio Google: "Generate a new ID if you want to create a new
 *      instance; otherwise, use the events.update method." — exatamente o
 *      contrato que ADR-039 assume para a reserva durável (retry com o
 *      mesmo id nunca duplica, falha com 409).
 *   **Ressalva documentada pelo próprio Google, que ADR-039 deveria herdar
 *   ao ser atualizada**: a descrição do campo `Event.id` no discovery
 *   document (não a página de guia) diz literalmente: "Due to the globally
 *   distributed nature of the system, we cannot guarantee that ID
 *   collisions will be detected at event creation time." Ou seja, o
 *   comportamento de conflito em 409 é o caminho documentado e o padrão
 *   observável, mas o próprio Google não promete detecção de colisão em
 *   100% dos casos (sistema distribuído, consistência eventual) — a
 *   reconciliação via `Events.get` que ADR-039 já desenha como plano B
 *   continua necessária, não é só uma cautela nossa.
 *   Formato do id, também da descrição do campo `Event.id`: caracteres
 *   permitidos são os de base32hex (letras minúsculas a-v e dígitos 0-9,
 *   RFC 2938 seção 3.1.2), comprimento entre 5 e 1024 caracteres, único por
 *   calendário. Consequência prática para quem gera o id (fora deste
 *   pacote): um UUID literal (RFC 4122) tem hífens, que NÃO estão no
 *   alfabeto permitido — um UUID em hex minúsculo SEM os hífens (32
 *   caracteres em 0-9a-f, subconjunto de 0-9a-v) satisfaz o formato: é a
 *   forma recomendada aqui, documentada no comentário de `EVENT_ID_PATTERN`
 *   abaixo.
 * - Refresh de access token (`refresh_token` → `access_token`):
 *   developers.google.com/identity/protocols/oauth2/web-server, seção
 *   "Refresh an access token (offline access)" — endpoint
 *   `POST https://oauth2.googleapis.com/token`,
 *   `Content-Type: application/x-www-form-urlencoded`, corpo
 *   `client_id`, `client_secret`, `refresh_token`, `grant_type=refresh_token`.
 *   Resposta de sucesso: JSON com `access_token`, `expires_in`, `scope`,
 *   `token_type`; `refresh_token` só volta se pedido de novo explicitamente
 *   (não é o caso aqui). Erro documentado na mesma página, seção "Errors"
 *   (tabela de `error` do corpo): `invalid_grant` — "When refreshing an
 *   access token [...] the token may have expired or has been invalidated.
 *   Authenticate the user again and ask for user consent to obtain new
 *   tokens." Este é o único erro que este pacote mapeia para o código
 *   `reauth_required` que ADR-039 pede explicitamente ("um `invalid_grant`
 *   do Google vira `reauth_required` na linha").
 * - Troca do `code` de autorização pelo primeiro `refresh_token`/`access_token`
 *   (onda 1b-ii, `exchangeGoogleAuthorizationCode`): MESMA página oficial do
 *   item anterior (developers.google.com/identity/protocols/oauth2/web-server),
 *   seção "Exchange authorization code for refresh and access tokens" —
 *   MESMO endpoint (`POST https://oauth2.googleapis.com/token`), mesmo
 *   `Content-Type: application/x-www-form-urlencoded`, corpo `client_id`,
 *   `client_secret`, `code`, `redirect_uri` (deve bater exatamente com o
 *   `redirect_uri` usado para gerar o `code`), `grant_type=authorization_code`.
 *   Resposta de sucesso: MESMO envelope JSON do refresh (`access_token`,
 *   `expires_in`, `scope`, `token_type`) mais `refresh_token` — presente só
 *   na primeira troca de consentimento (`access_type=offline`+`prompt=consent`
 *   na URL de autorização, montada fora deste pacote); a mesma página
 *   documenta que um usuário que já autorizou antes SEM revogar acesso pode
 *   não receber `refresh_token` de novo mesmo com os dois parâmetros
 *   corretos — comportamento que este pacote trata como erro tipado
 *   explícito (`missing_refresh_token`), nunca finge sucesso sem o valor. O
 *   envelope também inclui `id_token` (JWT OIDC) quando a URL de autorização
 *   pediu o escopo `openid` — repassado como está (`idToken`), nunca
 *   decodificado ou validado aqui (Art. 16: decodificar claims é
 *   interpretação de negócio, fora do escopo deste pacote sem estado; ver o
 *   comentário de `decodeGoogleIdTokenEmail` no portal). Diferente do
 *   refresh, um `invalid_grant` aqui significa "este `code` específico é
 *   inválido/expirado/já usado/não bate com o `redirect_uri`" — nunca
 *   "recredencie o tenant" (não existe conexão estabelecida ainda nesta
 *   chamada), então este pacote deliberadamente NÃO mapeia esse erro para
 *   `reauth_required`; cai no mesmo `provider_rejected`/`provider_unavailable`
 *   genérico por status HTTP que qualquer outra rejeição do endpoint de
 *   token já usa. Comportamento estável e amplamente documentado do fluxo
 *   OAuth2 "web server" da Google (mesma família de garantias do item de
 *   refresh acima); não revalidado ao vivo nesta rodada especificamente para
 *   este bullet.
 *
 * AMBIGUIDADE DOCUMENTADA (Art. 16 — não inventar o que a doc não confirma):
 * 1. O formato de `calendarId` não tem um charset fechado documentado (pode
 *    ser `"primary"`, um e-mail de conta Google, ou um id do tipo
 *    `xxxx@group.calendar.google.com`) — por isso este pacote valida só
 *    presença/tamanho, nunca um regex de formato, e usa `encodeURIComponent`
 *    no path como mitigação (mesma escolha do `provider-telnyx` para
 *    `call_control_id`, que também não tem formato fechado documentado).
 * 2. O formato de um `eventId` gerado PELO SERVIDOR do Google (nunca
 *    fornecido por este pacote) não é garantido pela mesma regra de
 *    `EVENT_ID_PATTERN` — essa regra é documentada só para IDs fornecidos
 *    pelo chamador em `events.insert`. Por isso `getEvent`/`deleteEvent`
 *    (que podem operar sobre um id gerado pelo Google) validam só
 *    presença/tamanho, nunca o charset base32hex; só `insertEvent` aplica
 *    `EVENT_ID_PATTERN` de verdade, porque só ali o chamador está sujeito à
 *    regra documentada.
 * 3. Comportamento de `Events.delete` contra um `eventId` já cancelado (não
 *    apenas ausente) não está fechado na doc consultada — este pacote trata
 *    só HTTP 404 como sucesso idempotente (mesmo padrão de
 *    `leaveCall`/`endConversation` dos outros dois adapters), nunca um 410
 *    ou outro código, porque só o 404 está descrito como "recurso não
 *    encontrado" de forma inequívoca na página de erros.
 * 4. `sendUpdates` (convite automático por e-mail ao criar/cancelar um
 *    evento) é deliberadamente nunca assumido por este pacote — ADR-039
 *    já marca isso como gate de pré-lançamento pendente de confirmação
 *    ("assumido como comportamento padrão [...]; revisitar se algum tenant
 *    piloto pedir o contrário"). Omitir o parâmetro deixa o comportório
 *    default do próprio Google valer (`sendUpdates` ausente); este pacote
 *    nunca escolhe um valor por conta própria.
 * 5. Retry com backoff exponencial NÃO é implementado dentro deste adapter
 *    — mesmo padrão de `provider-recall`/`provider-tavus`/`provider-telnyx`:
 *    uma falha vira um erro tipado numa única tentativa, e quem decide
 *    retentar (com que backoff, quantas vezes) é a camada de cima, que
 *    ainda não existe para este domínio (fora do escopo desta rodada).
 */

// ---------------------------------------------------------------------------
// Erro tipado
// ---------------------------------------------------------------------------

export type GoogleCalendarProviderErrorCode =
  | "missing_credentials"
  | "missing_refresh_token"
  | "invalid_request"
  | "event_not_found"
  | "event_id_conflict"
  | "reauth_required"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_unavailable"
  | "malformed_provider_response";

export class GoogleCalendarProviderError extends Error {
  readonly code: GoogleCalendarProviderErrorCode;
  /** Provider HTTP status when a response was received; absent for local/network failures. */
  readonly httpStatus: number | null;
  constructor(code: GoogleCalendarProviderErrorCode, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "GoogleCalendarProviderError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ---------------------------------------------------------------------------
// OAuth2: refresh_token -> access_token
// ---------------------------------------------------------------------------

export interface GoogleOAuthClientOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

export interface GoogleAccessToken {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly scope: string | null;
  readonly tokenType: string;
}

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DEFAULT_TIMEOUT_MS = 20_000;
/** Bound defensivo nosso, não documentado pelo Google: evita um corpo absurdamente grande no endpoint de token. */
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;

function trimmedOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateOAuthCredentials(options: GoogleOAuthClientOptions): { clientId: string; clientSecret: string; refreshToken: string } {
  const clientId = trimmedOrEmpty(options.clientId);
  const clientSecret = trimmedOrEmpty(options.clientSecret);
  const refreshToken = trimmedOrEmpty(options.refreshToken);
  if (clientId.length === 0 || clientSecret.length === 0 || refreshToken.length === 0) {
    throw new GoogleCalendarProviderError("missing_credentials", "Google OAuth client id/secret/refresh token are not configured");
  }
  return { clientId, clientSecret, refreshToken };
}

async function readBoundedText(response: Response, signal: AbortSignal, maxBytes: number, overflowMessage: string): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new GoogleCalendarProviderError("malformed_provider_response", overflowMessage);
  }
  if (response.body === null || response.body === undefined || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new GoogleCalendarProviderError("malformed_provider_response", overflowMessage);
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
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new GoogleCalendarProviderError("malformed_provider_response", overflowMessage);
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

/**
 * Troca um `refresh_token` OAuth já existente por um `access_token` de curto
 * prazo, chamando o endpoint de token real do Google
 * (developers.google.com/identity/protocols/oauth2/web-server, "Refresh an
 * access token"). Nunca implementa o fluxo de autorização inicial (o
 * `code` -> primeiro `refresh_token`) — isso é do fluxo de callback OAuth do
 * portal, fora do escopo deste pacote.
 *
 * Exportada separadamente de `createGoogleCalendarPort` porque o worker
 * periódico de reautenticação que ADR-039 descreve ("verificar a validade
 * do refresh token em intervalo fixo") só precisa desta chamada, sem montar
 * um port de calendário inteiro. `createGoogleCalendarPort` chama esta
 * mesma função internamente (com cache em memória por instância), então as
 * duas nunca podem divergir de comportamento.
 */
export async function refreshGoogleAccessToken(options: GoogleOAuthClientOptions): Promise<GoogleAccessToken> {
  const { clientId, clientSecret, refreshToken } = validateOAuthCredentials(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImplementation(TOKEN_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      throw new GoogleCalendarProviderError("provider_timeout", `Google OAuth token endpoint timed out after ${timeoutMs}ms`);
    }
    throw new GoogleCalendarProviderError("provider_unavailable", "Google OAuth token endpoint request failed before a response");
  }
  // O timer segue vivo até o CORPO ser consumido — headers rápidos com body
  // pendurado não escapam do timeout (mesmo achado de auditoria já corrigido
  // em provider-recall/provider-tavus/provider-telnyx).
  try {
    let text: string;
    try {
      text = await readBoundedText(response, controller.signal, MAX_TOKEN_RESPONSE_BYTES, "Google OAuth token response exceeded the body limit");
    } catch (error) {
      if (error instanceof GoogleCalendarProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new GoogleCalendarProviderError("provider_timeout", `Google OAuth token endpoint timed out after ${timeoutMs}ms`);
      }
      throw new GoogleCalendarProviderError("malformed_provider_response", "Google OAuth token endpoint returned unreadable output");
    }
    // Corpo de erro sem JSON válido é tratado como ausência de detalhe
    // estruturado, não como falha de parsing — um 5xx de um proxy/load
    // balancer na frente do endpoint de token pode devolver HTML/texto puro
    // em vez do envelope JSON documentado pelo Google; `malformed_provider_response`
    // fica reservado para quando a resposta É 2xx e ainda assim não tem o
    // formato esperado (mesmo padrão de `provider-tavus`: só o corpo de
    // sucesso é obrigado a ser JSON válido).
    let record: Record<string, unknown> = {};
    if (text.length > 0) {
      try {
        record = (JSON.parse(text) ?? {}) as Record<string, unknown>;
      } catch {
        if (response.ok) throw new GoogleCalendarProviderError("malformed_provider_response", "Google OAuth token endpoint returned non-JSON output");
      }
    }

    if (!response.ok) {
      // Único erro documentado do endpoint de refresh relevante a este
      // pacote: `invalid_grant` (refresh token expirado ou revogado) vira
      // reauth_required, o código que ADR-039 pede explicitamente.
      if (record.error === "invalid_grant") {
        throw new GoogleCalendarProviderError("reauth_required", "Google refresh token is invalid or has been revoked", response.status);
      }
      const code: GoogleCalendarProviderErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
      const reason = typeof record.error === "string" ? record.error : `HTTP ${response.status}`;
      throw new GoogleCalendarProviderError(code, `Google OAuth token endpoint rejected the request (${reason})`, response.status);
    }

    const accessToken = record.access_token;
    const expiresIn = record.expires_in;
    const tokenType = record.token_type;
    if (typeof accessToken !== "string" || accessToken.length === 0
      || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0
      || typeof tokenType !== "string" || tokenType.length === 0) {
      throw new GoogleCalendarProviderError("malformed_provider_response", "Google OAuth token payload is incomplete");
    }
    const scope = record.scope;
    return Object.freeze({
      accessToken,
      expiresInSeconds: expiresIn,
      scope: typeof scope === "string" ? scope : null,
      tokenType,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// OAuth2: code de autorização -> refresh_token + access_token (troca inicial)
// ---------------------------------------------------------------------------

export interface GoogleAuthorizationCodeExchangeOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  /** O `code` de uso único devolvido pelo Google no redirect de volta pro `redirect_uri`. Nunca logado por este pacote nem por quem o chama. */
  readonly code: string;
  /** Deve ser byte-idêntico ao `redirect_uri` usado para gerar este `code` na URL de autorização (exigência do próprio Google). */
  readonly redirectUri: string;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

export interface GoogleAuthorizationCodeExchangeResult extends GoogleAccessToken {
  /** Só existe porque este pacote trata a ausência como erro tipado (`missing_refresh_token`) em vez de devolver um resultado incompleto silenciosamente. */
  readonly refreshToken: string;
  /**
   * JWT OIDC bruto, repassado como o Google devolveu (base64url header.payload.signature),
   * quando a URL de autorização pediu o escopo `openid` -- `null` se ausente
   * no envelope. Nunca decodificado nem validado aqui (Art. 16): extrair e
   * usar a claim `email` é decisão de negócio de quem chama (ver
   * `apps/portal/src/lib/google-calendar/id-token.ts`).
   */
  readonly idToken: string | null;
}

function validateAuthorizationCodeExchangeOptions(
  options: GoogleAuthorizationCodeExchangeOptions,
): { clientId: string; clientSecret: string; code: string; redirectUri: string } {
  const clientId = trimmedOrEmpty(options.clientId);
  const clientSecret = trimmedOrEmpty(options.clientSecret);
  const code = trimmedOrEmpty(options.code);
  const redirectUri = trimmedOrEmpty(options.redirectUri);
  if (clientId.length === 0 || clientSecret.length === 0 || code.length === 0 || redirectUri.length === 0) {
    throw new GoogleCalendarProviderError("missing_credentials", "Google OAuth client id/secret, authorization code or redirect_uri are not configured");
  }
  return { clientId, clientSecret, code, redirectUri };
}

/**
 * Troca o `code` de autorização inicial (fluxo de callback OAuth do portal,
 * fora deste pacote) pelo primeiro `refresh_token`/`access_token` de um
 * tenant, chamando o MESMO endpoint de token real do Google que
 * `refreshGoogleAccessToken` usa (developers.google.com/identity/protocols/oauth2/web-server,
 * seção "Exchange authorization code for refresh and access tokens" --
 * ver o cabeçalho deste arquivo). Espelha `refreshGoogleAccessToken`
 * deliberadamente: mesmo `readBoundedText`, mesmo `GoogleCalendarProviderError`,
 * mesmo timeout com corpo pendurado, mesmo `fetchImplementation` injetável,
 * mesmo `TOKEN_ENDPOINT` -- só o corpo da requisição (`code`+`redirect_uri`+
 * `grant_type=authorization_code` em vez de `refresh_token`+
 * `grant_type=refresh_token`) e o formato da resposta (`refresh_token`+
 * `id_token` obrigatórios/opcionais aqui, nunca esperados no refresh) mudam.
 *
 * Nunca mapeia `invalid_grant` para `reauth_required` (ver o cabeçalho do
 * arquivo: nesta chamada não existe conexão estabelecida para reautenticar
 * -- um `invalid_grant` aqui é sempre sobre o `code` em si, não sobre um
 * `refresh_token` já custodiado). Se o Google devolver 2xx sem
 * `refresh_token` no corpo (acontece quando o usuário já autorizou antes sem
 * revogar, mesmo com `access_type=offline`+`prompt=consent` -- comportamento
 * do próprio Google, não bug deste pacote), lança `missing_refresh_token`
 * com uma mensagem que já orienta revogar o acesso em
 * https://myaccount.google.com/permissions e tentar de novo -- nunca
 * devolve um resultado sem `refreshToken` silenciosamente.
 */
export async function exchangeGoogleAuthorizationCode(
  options: GoogleAuthorizationCodeExchangeOptions,
): Promise<GoogleAuthorizationCodeExchangeResult> {
  const { clientId, clientSecret, code, redirectUri } = validateAuthorizationCodeExchangeOptions(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImplementation(TOKEN_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === "AbortError") {
      throw new GoogleCalendarProviderError("provider_timeout", `Google OAuth token endpoint timed out after ${timeoutMs}ms`);
    }
    throw new GoogleCalendarProviderError("provider_unavailable", "Google OAuth token endpoint request failed before a response");
  }
  // Mesmo achado de auditoria dos outros adapters: o timer segue vivo até o
  // CORPO ser consumido -- headers rápidos com body pendurado não escapam do
  // timeout.
  try {
    let text: string;
    try {
      text = await readBoundedText(response, controller.signal, MAX_TOKEN_RESPONSE_BYTES, "Google OAuth token response exceeded the body limit");
    } catch (error) {
      if (error instanceof GoogleCalendarProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new GoogleCalendarProviderError("provider_timeout", `Google OAuth token endpoint timed out after ${timeoutMs}ms`);
      }
      throw new GoogleCalendarProviderError("malformed_provider_response", "Google OAuth token endpoint returned unreadable output");
    }
    let record: Record<string, unknown> = {};
    if (text.length > 0) {
      try {
        record = (JSON.parse(text) ?? {}) as Record<string, unknown>;
      } catch {
        if (response.ok) throw new GoogleCalendarProviderError("malformed_provider_response", "Google OAuth token endpoint returned non-JSON output");
      }
    }

    if (!response.ok) {
      // Deliberadamente NÃO mapeia invalid_grant para reauth_required aqui
      // -- ver o comentário desta função e o cabeçalho do arquivo.
      const errorCode: GoogleCalendarProviderErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
      const reason = typeof record.error === "string" ? record.error : `HTTP ${response.status}`;
      throw new GoogleCalendarProviderError(errorCode, `Google OAuth token endpoint rejected the authorization code exchange (${reason})`, response.status);
    }

    const accessToken = record.access_token;
    const expiresIn = record.expires_in;
    const tokenType = record.token_type;
    if (typeof accessToken !== "string" || accessToken.length === 0
      || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0
      || typeof tokenType !== "string" || tokenType.length === 0) {
      throw new GoogleCalendarProviderError("malformed_provider_response", "Google OAuth token payload is incomplete");
    }
    const refreshToken = record.refresh_token;
    if (typeof refreshToken !== "string" || refreshToken.length === 0) {
      throw new GoogleCalendarProviderError(
        "missing_refresh_token",
        "Google did not return a refresh_token for this authorization code (usually means this account already authorized access before without revoking it) -- revoke access at https://myaccount.google.com/permissions and try connecting again",
      );
    }
    const scope = record.scope;
    const idToken = record.id_token;
    return Object.freeze({
      accessToken,
      expiresInSeconds: expiresIn,
      scope: typeof scope === "string" ? scope : null,
      tokenType,
      refreshToken,
      idToken: typeof idToken === "string" && idToken.length > 0 ? idToken : null,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Calendar API v3: FreeBusy + Events (insert/get/delete)
// ---------------------------------------------------------------------------

export interface FreeBusyQueryRequest {
  readonly calendarId: string;
  /** RFC3339 date-time. Fuso e janela já resolvidos pelo SERVIDOR (chamador) — este pacote nunca infere nenhum dos dois (ADR-039). */
  readonly timeMinIso: string;
  readonly timeMaxIso: string;
}

export interface FreeBusyInterval {
  readonly startIso: string;
  readonly endIso: string;
}

export interface FreeBusyQueryResult {
  readonly calendarId: string;
  readonly busy: readonly FreeBusyInterval[];
}

export interface InsertCalendarEventRequest {
  readonly calendarId: string;
  /**
   * Id gerado pelo CHAMADOR (nunca por este pacote) — ver o comentário de
   * `EVENT_ID_PATTERN` sobre o formato exigido pela doc oficial e a
   * recomendação de usar um UUID em hex minúsculo sem hífens.
   */
  readonly eventId: string;
  readonly summary: string;
  readonly description?: string;
  /** RFC3339 date-time, já resolvido com fuso pelo chamador. */
  readonly startIso: string;
  readonly endIso: string;
  /** IANA time zone name (ex.: "America/Sao_Paulo"), resolvido pelo servidor, nunca pelo modelo. */
  readonly timeZone: string;
  readonly attendeeEmails?: readonly string[];
  /**
   * `sendUpdates` real do Google. Deliberadamente sem default aplicado por
   * este pacote — ver "AMBIGUIDADE DOCUMENTADA" item 4 no topo do arquivo.
   */
  readonly sendUpdates?: "all" | "externalOnly" | "none";
}

export interface CalendarEvent {
  readonly id: string;
  /** "confirmed" | "tentative" | "cancelled" — string aberta porque a doc já avisa que outros valores podem aparecer no futuro. */
  readonly status: string;
  readonly htmlLink: string | null;
  readonly startIso: string | null;
  readonly endIso: string | null;
}

export interface DeleteCalendarEventOptions {
  readonly sendUpdates?: "all" | "externalOnly" | "none";
}

export interface GoogleCalendarPort {
  readonly providerId: string;
  queryFreeBusy(request: FreeBusyQueryRequest): Promise<FreeBusyQueryResult>;
  insertEvent(request: InsertCalendarEventRequest): Promise<CalendarEvent>;
  getEvent(calendarId: string, eventId: string): Promise<CalendarEvent>;
  /** Idempotente: um evento já ausente (404) é tratado como sucesso — mesmo padrão de leaveCall/endConversation dos outros adapters. */
  deleteEvent(calendarId: string, eventId: string, options?: DeleteCalendarEventOptions): Promise<void>;
  /**
   * Força uma troca refresh_token -> access_token real e atualiza o cache
   * interno. O worker periódico de reautenticação (ADR-039) chama isto
   * diretamente para detectar `reauth_required` sem precisar de nenhuma
   * outra chamada de calendário; todo outro método deste port chama
   * internamente o mesmo caminho quando o token em cache expira.
   */
  refreshAccessToken(): Promise<GoogleAccessToken>;
}

export interface GoogleCalendarAdapterOptions extends GoogleOAuthClientOptions {
  readonly clock?: { now(): number };
}

const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
/**
 * Caracteres permitidos para um `eventId` FORNECIDO PELO CHAMADOR em
 * `events.insert` (base32hex: a-v0-9), comprimento 5..1024 — regra literal
 * do discovery document oficial (campo `Event.id`). Um UUID (RFC4122) tem
 * hífens fora deste alfabeto; a forma recomendada é o UUID em hex minúsculo
 * SEM hífens (32 chars em 0-9a-f, subconjunto válido de 0-9a-v).
 */
const EVENT_ID_PATTERN = /^[a-v0-9]{5,1024}$/;
const MAX_CALENDAR_ID_CHARS = 512;
/** Bound defensivo nosso (a doc não fecha um tamanho máximo de eventId gerado pelo servidor Google). */
const MAX_SERVER_EVENT_ID_CHARS = 1024;
const MAX_SUMMARY_CHARS = 1024;
/** Bound defensivo nosso — a doc diz "Can contain HTML", sem limite de tamanho declarado. */
const MAX_DESCRIPTION_CHARS = 8192;
const MAX_ATTENDEES = 20;
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
/** Validação pragmática, não RFC 5322 completo — mesmo nível de rigor das outras validações deste repo (ex.: E.164 do provider-telnyx). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Bound defensivo nosso: uma janela de FreeBusy absurdamente grande (>400 dias) não é um uso real deste produto. */
const MAX_FREEBUSY_WINDOW_MS = 400 * 24 * 60 * 60 * 1_000;
/** Renova o access token um pouco antes de expirar de verdade — nunca deixa uma chamada em voo colidir com a expiração exata. */
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;
const MAX_API_RESPONSE_BYTES = 256 * 1024;

export function isValidGoogleCalendarEventId(value: unknown): value is string {
  return typeof value === "string" && EVENT_ID_PATTERN.test(value);
}

function validateCalendarId(calendarId: string): void {
  if (typeof calendarId !== "string" || calendarId.length === 0 || calendarId.length > MAX_CALENDAR_ID_CHARS) {
    throw new GoogleCalendarProviderError("invalid_request", `calendarId must be 1..${MAX_CALENDAR_ID_CHARS} chars`);
  }
}

function validateServerEventId(eventId: string): void {
  if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > MAX_SERVER_EVENT_ID_CHARS) {
    throw new GoogleCalendarProviderError("invalid_request", "eventId must be a non-empty string");
  }
}

function validateIso8601(value: string, label: string): void {
  if (typeof value !== "string" || !ISO_8601_PATTERN.test(value)) {
    throw new GoogleCalendarProviderError("invalid_request", `${label} must be an RFC3339 date-time`);
  }
}

function validateSendUpdates(value: unknown): void {
  if (value !== undefined && value !== "all" && value !== "externalOnly" && value !== "none") {
    throw new GoogleCalendarProviderError("invalid_request", `sendUpdates must be "all", "externalOnly" or "none"`);
  }
}

function validateFreeBusyRequest(request: FreeBusyQueryRequest): void {
  validateCalendarId(request.calendarId);
  validateIso8601(request.timeMinIso, "timeMinIso");
  validateIso8601(request.timeMaxIso, "timeMaxIso");
  const minMs = Date.parse(request.timeMinIso);
  const maxMs = Date.parse(request.timeMaxIso);
  if (!(maxMs > minMs)) throw new GoogleCalendarProviderError("invalid_request", "timeMaxIso must be after timeMinIso");
  if (maxMs - minMs > MAX_FREEBUSY_WINDOW_MS) {
    throw new GoogleCalendarProviderError("invalid_request", "freebusy window exceeds the sanity size cap");
  }
}

function validateInsertRequest(request: InsertCalendarEventRequest): void {
  validateCalendarId(request.calendarId);
  if (!isValidGoogleCalendarEventId(request.eventId)) {
    throw new GoogleCalendarProviderError(
      "invalid_request",
      "eventId must be 5..1024 chars of a-v0-9 (Google Calendar custom event id format)",
    );
  }
  if (typeof request.summary !== "string" || request.summary.length === 0 || request.summary.length > MAX_SUMMARY_CHARS) {
    throw new GoogleCalendarProviderError("invalid_request", `summary must be 1..${MAX_SUMMARY_CHARS} chars`);
  }
  if (request.description !== undefined && request.description.length > MAX_DESCRIPTION_CHARS) {
    throw new GoogleCalendarProviderError("invalid_request", `description must be at most ${MAX_DESCRIPTION_CHARS} chars`);
  }
  validateIso8601(request.startIso, "startIso");
  validateIso8601(request.endIso, "endIso");
  if (!(Date.parse(request.endIso) > Date.parse(request.startIso))) {
    throw new GoogleCalendarProviderError("invalid_request", "endIso must be after startIso");
  }
  if (typeof request.timeZone !== "string" || request.timeZone.length === 0) {
    throw new GoogleCalendarProviderError("invalid_request", "timeZone must be a non-empty IANA time zone name");
  }
  if (request.attendeeEmails !== undefined) {
    if (request.attendeeEmails.length > MAX_ATTENDEES) {
      throw new GoogleCalendarProviderError("invalid_request", `attendeeEmails must have at most ${MAX_ATTENDEES} entries`);
    }
    for (const email of request.attendeeEmails) {
      if (!EMAIL_PATTERN.test(email)) throw new GoogleCalendarProviderError("invalid_request", "attendeeEmails must all be valid email addresses");
    }
  }
  validateSendUpdates(request.sendUpdates);
}

function parseEventPayload(payload: unknown): CalendarEvent {
  const record = (payload ?? {}) as Record<string, unknown>;
  const id = record.id;
  const status = record.status;
  if (typeof id !== "string" || id.length === 0 || typeof status !== "string" || status.length === 0) {
    throw new GoogleCalendarProviderError("malformed_provider_response", "Google Calendar event payload is incomplete");
  }
  const htmlLink = record.htmlLink;
  const start = (record.start ?? {}) as Record<string, unknown>;
  const end = (record.end ?? {}) as Record<string, unknown>;
  const startIso = typeof start.dateTime === "string" ? start.dateTime : (typeof start.date === "string" ? start.date : null);
  const endIso = typeof end.dateTime === "string" ? end.dateTime : (typeof end.date === "string" ? end.date : null);
  return Object.freeze({
    id,
    status,
    htmlLink: typeof htmlLink === "string" ? htmlLink : null,
    startIso,
    endIso,
  });
}

export function createGoogleCalendarPort(options: GoogleCalendarAdapterOptions): GoogleCalendarPort {
  // Falha cedo se as credenciais OAuth estiverem ausentes — mesmo padrão de
  // "missing_api_key" dos outros adapters, adaptado ao vocabulário OAuth.
  validateOAuthCredentials(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const clock = options.clock ?? { now: () => Date.now() };
  const oauthOptions: GoogleOAuthClientOptions = {
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    refreshToken: options.refreshToken,
    timeoutMs,
    fetchImplementation,
  };

  let cached: { accessToken: string; expiresAtMs: number } | null = null;

  async function forceRefresh(): Promise<GoogleAccessToken> {
    const token = await refreshGoogleAccessToken(oauthOptions);
    cached = { accessToken: token.accessToken, expiresAtMs: clock.now() + token.expiresInSeconds * 1_000 };
    return token;
  }

  async function getValidAccessToken(): Promise<string> {
    if (cached !== null && clock.now() < cached.expiresAtMs - ACCESS_TOKEN_REFRESH_BUFFER_MS) {
      return cached.accessToken;
    }
    const token = await forceRefresh();
    return token.accessToken;
  }

  async function call(
    method: "POST" | "GET" | "DELETE",
    path: string,
    query: Readonly<Record<string, string>> = {},
    body?: Record<string, unknown>,
    callOptions: Readonly<{ notFoundIsSuccess?: boolean }> = {},
  ): Promise<unknown> {
    const accessToken = await getValidAccessToken();
    const url = new URL(`${CALENDAR_BASE}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImplementation(url.toString(), {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === "AbortError") {
        throw new GoogleCalendarProviderError("provider_timeout", `Google Calendar timed out after ${timeoutMs}ms`);
      }
      throw new GoogleCalendarProviderError("provider_unavailable", "Google Calendar request failed before a response");
    }
    // O timer segue vivo até o CORPO ser consumido — headers rápidos com body
    // pendurado não escapam do timeout (mesmo achado de auditoria já
    // corrigido em provider-recall/provider-tavus/provider-telnyx).
    try {
      if (!response.ok) {
        if (response.status === 404 && callOptions.notFoundIsSuccess === true) return null;
        if (response.status === 404) {
          throw new GoogleCalendarProviderError("event_not_found", "Google Calendar event was not found", 404);
        }
        if (response.status === 409) {
          throw new GoogleCalendarProviderError(
            "event_id_conflict",
            "Google Calendar already has an event with this id (retry-safe: no duplicate was created)",
            409,
          );
        }
        const code: GoogleCalendarProviderErrorCode = response.status >= 500 ? "provider_unavailable" : "provider_rejected";
        throw new GoogleCalendarProviderError(code, `Google Calendar responded HTTP ${response.status}`, response.status);
      }
      if (response.status === 204) return null;
      let text: string;
      try {
        text = await readBoundedText(response, controller.signal, MAX_API_RESPONSE_BYTES, "Google Calendar response exceeded the body limit");
      } catch (error) {
        if (error instanceof GoogleCalendarProviderError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new GoogleCalendarProviderError("provider_timeout", `Google Calendar timed out after ${timeoutMs}ms`);
        }
        throw new GoogleCalendarProviderError("malformed_provider_response", "Google Calendar returned unreadable output");
      }
      if (text.length === 0) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new GoogleCalendarProviderError("malformed_provider_response", "Google Calendar returned non-JSON output");
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    providerId: "google-calendar",

    async queryFreeBusy(request: FreeBusyQueryRequest): Promise<FreeBusyQueryResult> {
      validateFreeBusyRequest(request);
      const payload = await call("POST", "/freeBusy", {}, {
        timeMin: request.timeMinIso,
        timeMax: request.timeMaxIso,
        items: [{ id: request.calendarId }],
      });
      const record = (payload ?? {}) as Record<string, unknown>;
      const calendars = (record.calendars ?? {}) as Record<string, unknown>;
      const entry = (calendars[request.calendarId] ?? null) as Record<string, unknown> | null;
      if (entry === null) {
        throw new GoogleCalendarProviderError("malformed_provider_response", "Google Calendar freebusy response is missing the requested calendar");
      }
      const errors = entry.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        const first = (errors[0] ?? {}) as Record<string, unknown>;
        const reason = typeof first.reason === "string" ? first.reason : "unknown_error";
        throw new GoogleCalendarProviderError("provider_rejected", `Google Calendar freebusy failed for this calendar (${reason})`);
      }
      const busyRaw = entry.busy;
      const busy: FreeBusyInterval[] = Array.isArray(busyRaw)
        ? busyRaw.map((item): FreeBusyInterval => {
            const busyRecord = (item ?? {}) as Record<string, unknown>;
            const startIso = busyRecord.start;
            const endIso = busyRecord.end;
            if (typeof startIso !== "string" || typeof endIso !== "string") {
              throw new GoogleCalendarProviderError("malformed_provider_response", "Google Calendar freebusy interval is incomplete");
            }
            return Object.freeze({ startIso, endIso });
          })
        : [];
      return Object.freeze({ calendarId: request.calendarId, busy: Object.freeze(busy) });
    },

    async insertEvent(request: InsertCalendarEventRequest): Promise<CalendarEvent> {
      validateInsertRequest(request);
      const query: Record<string, string> = {};
      if (request.sendUpdates !== undefined) query.sendUpdates = request.sendUpdates;
      const payload = await call("POST", `/calendars/${encodeURIComponent(request.calendarId)}/events`, query, {
        id: request.eventId,
        summary: request.summary,
        ...(request.description !== undefined ? { description: request.description } : {}),
        start: { dateTime: request.startIso, timeZone: request.timeZone },
        end: { dateTime: request.endIso, timeZone: request.timeZone },
        ...(request.attendeeEmails !== undefined && request.attendeeEmails.length > 0
          ? { attendees: request.attendeeEmails.map((email) => ({ email })) }
          : {}),
      });
      const event = parseEventPayload(payload);
      if (event.id !== request.eventId) {
        throw new GoogleCalendarProviderError("malformed_provider_response", "Google Calendar echoed back a different event id than requested");
      }
      return event;
    },

    async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
      validateCalendarId(calendarId);
      validateServerEventId(eventId);
      const payload = await call("GET", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
      return parseEventPayload(payload);
    },

    async deleteEvent(calendarId: string, eventId: string, deleteOptions: DeleteCalendarEventOptions = {}): Promise<void> {
      validateCalendarId(calendarId);
      validateServerEventId(eventId);
      validateSendUpdates(deleteOptions.sendUpdates);
      const query: Record<string, string> = {};
      if (deleteOptions.sendUpdates !== undefined) query.sendUpdates = deleteOptions.sendUpdates;
      await call("DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, query, undefined, {
        notFoundIsSuccess: true,
      });
    },

    async refreshAccessToken(): Promise<GoogleAccessToken> {
      return forceRefresh();
    },
  });
}

// ---------------------------------------------------------------------------
// Modo fake determinístico (sem rede, sem credencial real)
// ---------------------------------------------------------------------------

/**
 * Mesmo mecanismo de demo do resto do repo — ver
 * `apps/portal/src/lib/knowledge.ts` `fakeProvidersEnabled()`. Este pacote
 * ainda não está conectado a nenhuma Server Action (fora de escopo desta
 * rodada), então este helper existe pelo mesmo motivo que
 * `telnyxFakeProvidersEnabled()` existe em `provider-telnyx`: para que um
 * FUTURO call site em `apps/portal` decida exatamente do mesmo jeito, e
 * para que este pacote seja testável sem credencial real hoje.
 */
export function googleCalendarFakeProvidersEnabled(): boolean {
  return process.env.PORTAL_FAKE_PROVIDERS === "1";
}

export interface FakeGoogleCalendarPortOptions {
  /**
   * Simula um refresh_token inválido/revogado: toda operação (inclusive
   * `refreshAccessToken`) falha com `reauth_required`, sem exceção — o
   * mesmo comportamento que o adapter real produz para um `invalid_grant`
   * real do Google, para exercitar o caminho de reautenticação sem rede.
   */
  readonly simulateInvalidRefreshToken?: boolean;
}

const FAKE_ACCESS_TOKEN = "fake-google-access-token";
const FAKE_TOKEN_EXPIRES_IN_SECONDS = 3600;

function deterministicFakeAccessToken(): GoogleAccessToken {
  return Object.freeze({
    accessToken: FAKE_ACCESS_TOKEN,
    expiresInSeconds: FAKE_TOKEN_EXPIRES_IN_SECONDS,
    scope: "https://www.googleapis.com/auth/calendar",
    tokenType: "Bearer",
  });
}

function assertNotSimulatingReauth(simulateInvalidRefreshToken: boolean | undefined): void {
  if (simulateInvalidRefreshToken === true) {
    throw new GoogleCalendarProviderError("reauth_required", "Fake Google refresh token is invalid or has been revoked (simulated)");
  }
}

interface FakeStoredEvent {
  readonly event: CalendarEvent;
  readonly startIso: string;
  readonly endIso: string;
}

/**
 * Contrato determinístico: mesmo input -> mesmo resultado, sempre, sem
 * nenhuma chamada de rede. Reaplica EXATAMENTE as mesmas validações do modo
 * real (`validateInsertRequest`/`validateFreeBusyRequest`/...) — um payload
 * malformado é rejeitado da mesma forma nos dois modos.
 *
 * Também simula fielmente o comportamento CONFIRMADO na doc real (ver
 * cabeçalho do arquivo): inserir duas vezes o mesmo `eventId` no mesmo
 * `calendarId` falha com `event_id_conflict` (409) em vez de duplicar; um
 * evento apagado ou nunca criado devolve `event_not_found` (404) em
 * `getEvent`; `deleteEvent` é idempotente. Eventos inseridos entram como
 * intervalo ocupado nas consultas seguintes de `queryFreeBusy` do mesmo
 * calendário, para que um fluxo propose -> confirm -> propose de novo seja
 * demonstrável sem provider real.
 */
export function createFakeGoogleCalendarPort(fakeOptions: FakeGoogleCalendarPortOptions = {}): GoogleCalendarPort {
  const simulateInvalidRefreshToken = fakeOptions.simulateInvalidRefreshToken;
  const calendars = new Map<string, Map<string, FakeStoredEvent>>();

  function eventsFor(calendarId: string): Map<string, FakeStoredEvent> {
    let bucket = calendars.get(calendarId);
    if (bucket === undefined) {
      bucket = new Map();
      calendars.set(calendarId, bucket);
    }
    return bucket;
  }

  return Object.freeze({
    providerId: "google-calendar",

    async queryFreeBusy(request: FreeBusyQueryRequest): Promise<FreeBusyQueryResult> {
      validateFreeBusyRequest(request);
      assertNotSimulatingReauth(simulateInvalidRefreshToken);
      const windowStartMs = Date.parse(request.timeMinIso);
      const windowEndMs = Date.parse(request.timeMaxIso);
      const bucket = calendars.get(request.calendarId);
      const busy: FreeBusyInterval[] = [];
      if (bucket !== undefined) {
        for (const stored of bucket.values()) {
          const startMs = Date.parse(stored.startIso);
          const endMs = Date.parse(stored.endIso);
          if (startMs < windowEndMs && endMs > windowStartMs) {
            busy.push(Object.freeze({ startIso: stored.startIso, endIso: stored.endIso }));
          }
        }
      }
      return Object.freeze({ calendarId: request.calendarId, busy: Object.freeze(busy) });
    },

    async insertEvent(request: InsertCalendarEventRequest): Promise<CalendarEvent> {
      validateInsertRequest(request);
      assertNotSimulatingReauth(simulateInvalidRefreshToken);
      const bucket = eventsFor(request.calendarId);
      if (bucket.has(request.eventId)) {
        throw new GoogleCalendarProviderError(
          "event_id_conflict",
          "Fake Google Calendar already has an event with this id (retry-safe: no duplicate was created)",
          409,
        );
      }
      const event: CalendarEvent = Object.freeze({
        id: request.eventId,
        status: "confirmed",
        htmlLink: `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(request.eventId)}`,
        startIso: request.startIso,
        endIso: request.endIso,
      });
      bucket.set(request.eventId, { event, startIso: request.startIso, endIso: request.endIso });
      return event;
    },

    async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
      validateCalendarId(calendarId);
      validateServerEventId(eventId);
      assertNotSimulatingReauth(simulateInvalidRefreshToken);
      const stored = calendars.get(calendarId)?.get(eventId);
      if (stored === undefined) {
        throw new GoogleCalendarProviderError("event_not_found", "Fake Google Calendar event was not found", 404);
      }
      return stored.event;
    },

    async deleteEvent(calendarId: string, eventId: string, deleteOptions: DeleteCalendarEventOptions = {}): Promise<void> {
      validateCalendarId(calendarId);
      validateServerEventId(eventId);
      validateSendUpdates(deleteOptions.sendUpdates);
      assertNotSimulatingReauth(simulateInvalidRefreshToken);
      calendars.get(calendarId)?.delete(eventId);
    },

    async refreshAccessToken(): Promise<GoogleAccessToken> {
      assertNotSimulatingReauth(simulateInvalidRefreshToken);
      return deterministicFakeAccessToken();
    },
  });
}

// ---------------------------------------------------------------------------
// Modo fake determinístico -- troca do code de autorização (onda 1b-ii)
// ---------------------------------------------------------------------------

export interface FakeGoogleAuthorizationCodeExchangeOptions {
  /**
   * Simula o único caso documentado em que o Google devolve 2xx sem
   * `refresh_token` (ver o comentário de `exchangeGoogleAuthorizationCode`
   * acima) -- exercita `missing_refresh_token` sem rede.
   */
  readonly simulateMissingRefreshToken?: boolean;
}

const FAKE_AUTHORIZATION_CODE_ACCESS_TOKEN = "fake-google-authorization-code-access-token";
const FAKE_AUTHORIZATION_CODE_REFRESH_TOKEN = "fake-google-authorization-code-refresh-token";
const FAKE_GOOGLE_ACCOUNT_EMAIL = "google-calendar-demo@example.com";

function base64UrlJson(value: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * Formato de JWT (header.payload.signature) sem assinatura criptográfica
 * real -- suficiente pro decodificador do portal, que nunca verifica
 * assinatura (ver `apps/portal/src/lib/google-calendar/id-token.ts`), e
 * nunca usado como prova de identidade fora do modo fake.
 */
function deterministicFakeIdToken(): string {
  const header = base64UrlJson({ alg: "none", typ: "JWT" });
  const payload = base64UrlJson({ email: FAKE_GOOGLE_ACCOUNT_EMAIL, email_verified: true });
  return `${header}.${payload}.fake-signature`;
}

/**
 * Contrato determinístico igual ao de `createFakeGoogleCalendarPort`: mesmo
 * input -> mesmo resultado, sem rede, reaplicando a mesma validação de
 * presença/formato do modo real (`validateAuthorizationCodeExchangeOptions`).
 * Devolve `refreshToken`/`accessToken`/`idToken` fixos e determinísticos
 * (o e-mail dentro do `idToken` é o que a rota de callback do portal
 * exercita em modo fake) -- exceto quando `simulateMissingRefreshToken`
 * pede o caminho de erro.
 */
export function createFakeGoogleAuthorizationCodeExchange(
  fakeOptions: FakeGoogleAuthorizationCodeExchangeOptions = {},
): (options: GoogleAuthorizationCodeExchangeOptions) => Promise<GoogleAuthorizationCodeExchangeResult> {
  const simulateMissingRefreshToken = fakeOptions.simulateMissingRefreshToken === true;
  return async (options: GoogleAuthorizationCodeExchangeOptions): Promise<GoogleAuthorizationCodeExchangeResult> => {
    validateAuthorizationCodeExchangeOptions(options);
    if (simulateMissingRefreshToken) {
      throw new GoogleCalendarProviderError(
        "missing_refresh_token",
        "Google did not return a refresh_token for this authorization code (usually means this account already authorized access before without revoking it) -- revoke access at https://myaccount.google.com/permissions and try connecting again",
      );
    }
    return Object.freeze({
      accessToken: FAKE_AUTHORIZATION_CODE_ACCESS_TOKEN,
      expiresInSeconds: FAKE_TOKEN_EXPIRES_IN_SECONDS,
      scope: "https://www.googleapis.com/auth/calendar openid email",
      tokenType: "Bearer",
      refreshToken: FAKE_AUTHORIZATION_CODE_REFRESH_TOKEN,
      idToken: deterministicFakeIdToken(),
    });
  };
}
