/**
 * Admissão de participante vindo do CRM para a closer da Billion Leads Pro (ADR-051, etapa 1).
 *
 * O backend do CRM autentica com um segredo de serviço próprio e afirma quem é a pessoa
 * recém-cadastrada. O portal devolve uma admissão assinada (HMAC-SHA256) e expirável, e só ela
 * abre o chat de texto e a sessão de vídeo. A admissão só existe se o aviso de IA foi confirmado
 * pela pessoa, na versão vigente. O segredo de serviço identifica o CRM, nunca a pessoa.
 *
 * Etapa 1 é sem estado: o recibo durável do aviso (tabela + migração 0079) ainda não existe, e por
 * isso o canal nasce desligado (BILLION_CLOSER_ENABLED). Dado do CRM é dado não confiável: tudo é
 * validado contra listas fechadas e o texto livre é limitado.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";

import { constantTimeEquals } from "../security.ts";

/** Versão do aviso de IA mostrado no painel do CRM. Trocar a redação exige subir a versão. */
export const BILLION_DISCLOSURE_VERSION = "ai-label-2026-10-v1";
export const ADMISSION_TTL_SECONDS = 2 * 60 * 60;
const MIN_KEY_CHARS = 32;

export type AdmissionLanguage = "portuguese" | "english" | "spanish";
export type AdmissionInterest = "crm" | "leads" | "unknown";

const LANGUAGES: ReadonlySet<string> = new Set(["portuguese", "english", "spanish"]);
const INTERESTS: ReadonlySet<string> = new Set(["crm", "leads", "unknown"]);
const STAGES: ReadonlySet<string> = new Set([
  "new_interest", "contacted", "demo", "proposal", "trial", "first_purchase", "active_customer",
  "expansion", "at_risk", "lost", "checkout_abandoned",
]);
const US_STATE = /^[A-Z]{2}$/;
const MAX_STATES = 50;
const MAX_FIRST_NAME_CHARS = 40;

export interface BillionAdmission {
  readonly v: 1;
  readonly id: string;
  /** Hash do identificador da conta no CRM: o portal nunca guarda o identificador cru. */
  readonly acct: string;
  readonly lang: AdmissionLanguage;
  readonly interest: AdmissionInterest;
  readonly stage: string;
  readonly firstName: string | null;
  readonly states: readonly string[];
  readonly iat: number;
  readonly exp: number;
  readonly disc: { readonly ver: string; readonly at: number };
}

export class AdmissionError extends Error {
  readonly code: "invalid_request" | "disclosure_required" | "admission_invalid" | "admission_expired" | "not_configured";
  readonly status: number;
  constructor(code: AdmissionError["code"], status: number, message: string) {
    super(message);
    this.name = "AdmissionError";
    this.code = code;
    this.status = status;
  }
}

export interface ParsedAdmissionRequest {
  readonly accountRef: string;
  readonly lang: AdmissionLanguage;
  readonly interest: AdmissionInterest;
  readonly stage: string;
  readonly firstName: string | null;
  readonly states: readonly string[];
}

function cleanFirstName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.normalize("NFKC").replace(/[^\p{L}\p{M} '-]/gu, "").trim().split(/\s+/)[0] ?? "";
  return trimmed.length > 0 ? trimmed.slice(0, MAX_FIRST_NAME_CHARS) : null;
}

export function parseAdmissionRequest(body: unknown): ParsedAdmissionRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new AdmissionError("invalid_request", 400, "body must be an object");
  }
  const record = body as Record<string, unknown>;
  const disclosure = record.disclosure;
  const acknowledged = disclosure !== null && typeof disclosure === "object"
    && (disclosure as Record<string, unknown>).acknowledged === true
    && (disclosure as Record<string, unknown>).version === BILLION_DISCLOSURE_VERSION;
  if (!acknowledged) {
    throw new AdmissionError("disclosure_required", 400, "the AI disclosure must be confirmed in the current version");
  }
  const accountRef = record.accountRef;
  if (typeof accountRef !== "string" || accountRef.length < 8 || accountRef.length > 128) {
    throw new AdmissionError("invalid_request", 400, "accountRef must be 8 to 128 characters");
  }
  if (typeof record.language !== "string" || !LANGUAGES.has(record.language)) {
    throw new AdmissionError("invalid_request", 400, "language must be portuguese, english or spanish");
  }
  const interest = record.interest === undefined ? "unknown" : record.interest;
  if (typeof interest !== "string" || !INTERESTS.has(interest)) {
    throw new AdmissionError("invalid_request", 400, "interest must be crm, leads or unknown");
  }
  const stage = record.stage === undefined ? "new_interest" : record.stage;
  if (typeof stage !== "string" || !STAGES.has(stage)) {
    throw new AdmissionError("invalid_request", 400, "stage is not a known funnel stage");
  }
  const rawStates = record.states === undefined ? [] : record.states;
  if (!Array.isArray(rawStates) || rawStates.length > MAX_STATES || rawStates.some((state) => typeof state !== "string" || !US_STATE.test(state))) {
    throw new AdmissionError("invalid_request", 400, "states must be a list of two-letter US state codes");
  }
  return {
    accountRef,
    lang: record.language as AdmissionLanguage,
    interest: interest as AdmissionInterest,
    stage,
    firstName: cleanFirstName(record.firstName),
    states: [...new Set(rawStates as string[])],
  };
}

export function hashAccountRef(accountRef: string): string {
  return createHash("sha256").update(`billion-closer:${accountRef}`, "utf8").digest("hex").slice(0, 32);
}

function requireKey(key: string | null | undefined): string {
  if (typeof key !== "string" || key.length < MIN_KEY_CHARS) {
    throw new AdmissionError("not_configured", 503, "admission signing key is not configured");
  }
  return key;
}

function sign(encodedPayload: string, key: string): string {
  return createHmac("sha256", key).update(`billion-admission.${encodedPayload}`, "utf8").digest("base64url");
}

export function issueAdmission(request: ParsedAdmissionRequest, key: string | null | undefined, nowSeconds: number = Math.floor(Date.now() / 1000)): { readonly token: string; readonly admission: BillionAdmission } {
  const secret = requireKey(key);
  const admission: BillionAdmission = {
    v: 1,
    id: randomUUID(),
    acct: hashAccountRef(request.accountRef),
    lang: request.lang,
    interest: request.interest,
    stage: request.stage,
    firstName: request.firstName,
    states: request.states,
    iat: nowSeconds,
    exp: nowSeconds + ADMISSION_TTL_SECONDS,
    disc: { ver: BILLION_DISCLOSURE_VERSION, at: nowSeconds },
  };
  const encoded = Buffer.from(JSON.stringify(admission), "utf8").toString("base64url");
  return { token: `${encoded}.${sign(encoded, secret)}`, admission };
}

export function verifyAdmission(token: unknown, key: string | null | undefined, nowSeconds: number = Math.floor(Date.now() / 1000)): BillionAdmission {
  const secret = requireKey(key);
  if (typeof token !== "string" || token.length > 4096) throw new AdmissionError("admission_invalid", 401, "admission is missing");
  const parts = token.split(".");
  if (parts.length !== 2) throw new AdmissionError("admission_invalid", 401, "admission is malformed");
  const [encoded, signature] = parts as [string, string];
  if (!constantTimeEquals(signature, sign(encoded, secret))) throw new AdmissionError("admission_invalid", 401, "admission signature does not match");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new AdmissionError("admission_invalid", 401, "admission payload is unreadable");
  }
  const admission = parsed as BillionAdmission;
  if (
    admission === null || typeof admission !== "object" || admission.v !== 1
    || typeof admission.id !== "string" || typeof admission.exp !== "number" || typeof admission.iat !== "number"
    || !LANGUAGES.has(admission.lang) || admission.disc?.ver !== BILLION_DISCLOSURE_VERSION
  ) {
    throw new AdmissionError("admission_invalid", 401, "admission payload is not valid");
  }
  if (admission.exp <= nowSeconds) throw new AdmissionError("admission_expired", 401, "admission expired");
  return admission;
}

/** Autenticação do chamador de máquina (o backend do CRM). Segredo exclusivo, comparado em tempo constante. */
export function authenticateCrmCaller(authorizationHeader: string | null, expectedSecret: string | null | undefined): void {
  if (typeof expectedSecret !== "string" || expectedSecret.length < 16) {
    throw new AdmissionError("not_configured", 503, "BILLION_CLOSER_SERVICE_SECRET is not configured");
  }
  const match = typeof authorizationHeader === "string" ? /^Bearer\s+(\S+)$/.exec(authorizationHeader) : null;
  if (match === null || !constantTimeEquals(match[1] as string, expectedSecret)) {
    throw new AdmissionError("admission_invalid", 401, "caller is not authorized");
  }
}
