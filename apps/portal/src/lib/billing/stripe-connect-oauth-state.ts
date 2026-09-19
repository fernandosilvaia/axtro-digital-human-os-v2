/**
 * CSRF `state` do fluxo de conexão OAuth do Stripe Connect (ADR-040): a
 * SEGUNDA rota de callback OAuth por redirect de navegador deste
 * repositório, depois do Google Calendar (ADR-039, onda 1b-ii). Sem validar
 * `state` corretamente, um atacante poderia induzir um `tenant_admin`
 * vítima a conectar a conta Stripe DO ATACANTE ao tenant da vítima (o CSRF
 * clássico de OAuth, RFC 6749 §10.12).
 *
 * DELIBERADAMENTE um cookie assinado, não uma tabela (decisão já registrada
 * no ADR-040: "O state de CSRF do OAuth vive em cookie assinado de curta
 * duração, não em tabela"). Isso não é a mesma escolha do Google Calendar
 * (`google-calendar/oauth-state.ts`, tabela `google_calendar_oauth_states`)
 * por acaso: aquele arquivo documenta em detalhe o D-V2-174, um incidente
 * real em produção em que um `Map` em memória não sobrevivia à forma como o
 * Next.js empacota a Server Action e o route handler do callback em módulos
 * separados -- cada lado carregava sua própria instância, e o que a Action
 * gravava o callback nunca enxergava. Um COOKIE ASSINADO não tem esse modo
 * de falha: o próprio navegador carrega o valor de volta pro callback, sem
 * depender de nenhum estado compartilhado entre processo/módulo/réplica.
 * Mesmo padrão de assinatura de `public-demo/state-token.ts` (HMAC-SHA256,
 * payload canônico, chaves exatas, comparação em tempo constante), reduzido
 * ao necessário aqui: só `tenantId`+`actorId`+janela de validade, sem
 * revisão/comandos/superfície.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_CONNECT_OAUTH_STATE_SECRET_ENV = "STRIPE_CONNECT_OAUTH_STATE_SECRET" as const;
export const STRIPE_CONNECT_OAUTH_STATE_TOKEN_VERSION = "scsv1" as const;
export const STRIPE_CONNECT_OAUTH_STATE_TTL_SECONDS = 600;
export const STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME = "axtro_stripe_connect_oauth_state" as const;

const STATE_TTL_MS = STRIPE_CONNECT_OAUTH_STATE_TTL_SECONDS * 1000;
const MAX_FUTURE_SKEW_MS = 5_000;
const MAX_TOKEN_CHARS = 2 * 1024;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const MIN_UNIQUE_SECRET_BYTES = 16;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIGNING_DOMAIN = "axtro:portal-stripe-connect-oauth-state:v1\0";
const PAYLOAD_KEYS = Object.freeze(["schema_version", "tenant_id", "actor_id", "issued_at", "expires_at"] as const);

export type StripeConnectOAuthStateErrorCode = "state_secret_invalid" | "state_token_invalid" | "state_token_expired";

export class StripeConnectOAuthStateError extends Error {
  readonly code: StripeConnectOAuthStateErrorCode;
  constructor(code: StripeConnectOAuthStateErrorCode) {
    super(code);
    this.name = "StripeConnectOAuthStateError";
    this.code = code;
  }
}

export interface StripeConnectOAuthStatePayload {
  readonly schema_version: "1.0.0";
  readonly tenant_id: string;
  readonly actor_id: string;
  readonly issued_at: string;
  readonly expires_at: string;
}

function ownDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of keys) {
      const descriptor = descriptors[String(key)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    }
    return value as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function parseCanonicalTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

function canonicalJson(value: StripeConnectOAuthStatePayload): string {
  const record = value as unknown as Readonly<Record<string, unknown>>;
  const entries = Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${JSON.stringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function parseSecret(secret: unknown): Buffer {
  if (!isStripeConnectOAuthStateSecretConfigured(secret)) throw new StripeConnectOAuthStateError("state_secret_invalid");
  return Buffer.from(secret, "hex");
}

function parseCanonicalBase64Url(value: string): Buffer | null {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : null;
  } catch {
    return null;
  }
}

export function isStripeConnectOAuthStateSecretConfigured(value: unknown): value is string {
  if (typeof value !== "string" || !SECRET_PATTERN.test(value)) return false;
  const bytes = Buffer.from(value, "hex");
  return new Set(bytes).size >= MIN_UNIQUE_SECRET_BYTES;
}

function parsePayload(value: unknown, nowMs: number): StripeConnectOAuthStatePayload {
  const payload = ownDataRecord(value);
  if (!payload || !hasExactKeys(payload, PAYLOAD_KEYS)) throw new StripeConnectOAuthStateError("state_token_invalid");
  const issuedAtMs = parseCanonicalTimestamp(payload.issued_at);
  const expiresAtMs = parseCanonicalTimestamp(payload.expires_at);
  if (
    payload.schema_version !== "1.0.0"
    || typeof payload.tenant_id !== "string" || !UUID_V7_PATTERN.test(payload.tenant_id)
    || typeof payload.actor_id !== "string" || !UUID_V7_PATTERN.test(payload.actor_id)
    || issuedAtMs === null || expiresAtMs === null
    || issuedAtMs > nowMs + MAX_FUTURE_SKEW_MS
    || expiresAtMs <= issuedAtMs
    || expiresAtMs - issuedAtMs > STATE_TTL_MS
  ) {
    throw new StripeConnectOAuthStateError("state_token_invalid");
  }
  if (expiresAtMs <= nowMs) throw new StripeConnectOAuthStateError("state_token_expired");
  return Object.freeze({
    schema_version: "1.0.0",
    tenant_id: payload.tenant_id,
    actor_id: payload.actor_id,
    issued_at: payload.issued_at as string,
    expires_at: payload.expires_at as string,
  });
}

/** Emite o token assinado que a Server Action de connect grava no cookie `STRIPE_CONNECT_OAUTH_STATE_COOKIE_NAME`. */
export function issueStripeConnectOAuthStateToken(tenantId: string, actorId: string, secret: string, now = new Date()): string {
  const key = parseSecret(secret);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new StripeConnectOAuthStateError("state_token_invalid");
  const payload = parsePayload({
    schema_version: "1.0.0",
    tenant_id: tenantId,
    actor_id: actorId,
    issued_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + STATE_TTL_MS).toISOString(),
  }, nowMs);
  const payloadJson = canonicalJson(payload);
  const payloadSegment = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signatureSegment = createHmac("sha256", key).update(`${SIGNING_DOMAIN}${payloadSegment}`, "utf8").digest("base64url");
  const token = `${STRIPE_CONNECT_OAUTH_STATE_TOKEN_VERSION}.${payloadSegment}.${signatureSegment}`;
  if (token.length > MAX_TOKEN_CHARS) throw new StripeConnectOAuthStateError("state_token_invalid");
  return token;
}

/** Verifica o token lido de volta do cookie na rota de callback. Lança em vez de devolver `null`: o chamador decide a mensagem de erro exposta ao usuário a partir do `code` tipado. */
export function verifyStripeConnectOAuthStateToken(token: unknown, secret: string, now = new Date()): StripeConnectOAuthStatePayload {
  const key = parseSecret(secret);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new StripeConnectOAuthStateError("state_token_invalid");
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) {
    throw new StripeConnectOAuthStateError("state_token_invalid");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== STRIPE_CONNECT_OAUTH_STATE_TOKEN_VERSION) {
    throw new StripeConnectOAuthStateError("state_token_invalid");
  }
  const payloadSegment = parts[1] ?? "";
  const signatureSegment = parts[2] ?? "";
  const payloadBytes = parseCanonicalBase64Url(payloadSegment);
  const signatureBytes = parseCanonicalBase64Url(signatureSegment);
  if (payloadBytes === null || signatureBytes === null || signatureBytes.length !== 32) {
    throw new StripeConnectOAuthStateError("state_token_invalid");
  }
  const expectedBytes = createHmac("sha256", key).update(`${SIGNING_DOMAIN}${payloadSegment}`, "utf8").digest();
  if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) {
    throw new StripeConnectOAuthStateError("state_token_invalid");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    throw new StripeConnectOAuthStateError("state_token_invalid");
  }
  const payload = parsePayload(decoded, nowMs);
  if (canonicalJson(payload) !== payloadBytes.toString("utf8")) throw new StripeConnectOAuthStateError("state_token_invalid");
  return payload;
}
