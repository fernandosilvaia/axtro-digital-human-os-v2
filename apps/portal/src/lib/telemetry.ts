// Adapter de telemetria (T7). Hoje resolve para log estruturado em stdout,
// que o Railway já coleta — nenhum provedor externo, nenhuma dependência
// nova. A escolha de um APM real (Sentry, log drain dedicado, etc.) é
// decisão de produto/custo/residência de dado, registrada em
// docs/NEEDS_CONNECTION.md; este módulo é o ÚNICO ponto de wiring quando
// essa decisão existir — o resto do código nunca chama console.* direto.
//
// Redação: nenhum valor de `context` que pareça e-mail, token ou chave é
// logado em texto puro.

const REDACT_KEY_PATTERN = /email|token|password|secret|key|authorization/i;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
// Formatos de credencial que aparecem em mensagens de erro de provider:
// prefixos conhecidos (sk-, sk_test_/sk_live_/rk_test_/rk_live_ da Stripe,
// whsec_, re_...) ou hex/base64 longos. Achado D-V2-107: a chave secreta da
// Stripe usa "_" depois de sk/rk (não "-" como o formato da OpenRouter), e
// não batia em nenhuma alternativa — adicionada explicitamente.
const SECRET_PATTERN = /\b(?:Bearer\s+[A-Za-z0-9._~+/-]{8,}|sk-[A-Za-z0-9_-]{8,}|(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9+/=]{8,}|re_[A-Za-z0-9_-]{8,}|[A-Fa-f0-9]{32,})\b/g;
const REDACTED = "[redacted]";
const UNSAFE_VALUE = "[redacted-unsafe]";
const TRUNCATED_VALUE = "[redacted-truncated]";
const REDACTED_KEY = "[redacted-key]";
const MAX_REDACTION_DEPTH = 8;
const MAX_REDACTION_ENTRIES = 100;
const MAX_ARRAY_ITEMS = 50;
const MAX_KEY_LENGTH = 128;
const MAX_STRING_LENGTH = 2_048;
const MAX_TOTAL_STRING_LENGTH = 16_384;
const MAX_EVENT_LENGTH = 200;

interface RedactionState {
  readonly seen: WeakSet<object>;
  remainingEntries: number;
  remainingStringLength: number;
}

function createSafeRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function setSafeValue(record: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(record, key, { configurable: true, enumerable: true, value, writable: true });
}

function redactString(value: string, state: RedactionState, maximumLength = MAX_STRING_LENGTH): string {
  // Never run unbounded regular expressions over caller-controlled payloads.
  // Large values are omitted wholesale so a partial email/token cannot leak at
  // a truncation boundary.
  if (value.length > maximumLength || value.length > state.remainingStringLength) return TRUNCATED_VALUE;
  const redacted = value.replace(EMAIL_PATTERN, "[redacted-email]").replace(SECRET_PATTERN, "[redacted-secret]");
  if (redacted.length > state.remainingStringLength) return TRUNCATED_VALUE;
  state.remainingStringLength -= redacted.length;
  return redacted;
}

function redactKey(key: string, state: RedactionState): string {
  if (key.length > MAX_KEY_LENGTH) return REDACTED_KEY;
  const sanitized = redactString(key, state, MAX_KEY_LENGTH);
  return sanitized === key ? key : REDACTED_KEY;
}

function redactArray(value: readonly unknown[], state: RedactionState, depth: number): unknown[] | string {
  if (state.seen.has(value)) return UNSAFE_VALUE;
  state.seen.add(value);
  try {
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0) return UNSAFE_VALUE;
    const safe: unknown[] = [];
    const count = Math.min(length, MAX_ARRAY_ITEMS);
    // Descriptors are read one index at a time, bounded by MAX_ARRAY_ITEMS —
    // Object.getOwnPropertyDescriptors(value) would materialize every element
    // up front, costing O(length) even for a multi-million-element payload
    // before the per-item cap below ever kicks in.
    for (let index = 0; index < count; index += 1) {
      if (state.remainingEntries <= 0) {
        safe.push(TRUNCATED_VALUE);
        break;
      }
      state.remainingEntries -= 1;
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      safe.push(descriptor && "value" in descriptor ? redactValue(descriptor.value, state, depth + 1) : descriptor ? UNSAFE_VALUE : null);
    }
    if (length > count) safe.push(TRUNCATED_VALUE);
    return safe;
  } catch {
    return UNSAFE_VALUE;
  }
}

function redactRecord(value: object, state: RedactionState, depth: number): Record<string, unknown> | string {
  if (state.seen.has(value)) return UNSAFE_VALUE;
  state.seen.add(value);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return UNSAFE_VALUE;
    const safe = createSafeRecord();
    // for...in + hasOwnProperty walks own-enumerable keys lazily, one at a
    // time, so the loop can stop as soon as the entry budget is spent —
    // Object.getOwnPropertyDescriptors(value) would enumerate every key up
    // front, costing O(keyCount) even for an object with millions of keys.
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (state.remainingEntries <= 0) {
        setSafeValue(safe, TRUNCATED_VALUE, TRUNCATED_VALUE);
        break;
      }
      state.remainingEntries -= 1;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const safeKey = redactKey(key, state);
      setSafeValue(safe, safeKey, REDACT_KEY_PATTERN.test(key) ? REDACTED : descriptor && "value" in descriptor ? redactValue(descriptor.value, state, depth + 1) : UNSAFE_VALUE);
    }
    return safe;
  } catch {
    return UNSAFE_VALUE;
  }
}

function redactValue(value: unknown, state: RedactionState, depth: number): unknown {
  if (typeof value === "string") return redactString(value, state);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : UNSAFE_VALUE;
  if (depth >= MAX_REDACTION_DEPTH) return TRUNCATED_VALUE;
  if (typeof value !== "object") return UNSAFE_VALUE;
  try {
    return Array.isArray(value) ? redactArray(value, state, depth) : redactRecord(value, state, depth);
  } catch {
    return UNSAFE_VALUE;
  }
}

function redact(context?: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  if (context === undefined || context === null) return undefined;
  const state: RedactionState = { seen: new WeakSet<object>(), remainingEntries: MAX_REDACTION_ENTRIES, remainingStringLength: MAX_TOTAL_STRING_LENGTH };
  const result = redactRecord(context, state, 0);
  if (typeof result !== "string") return result;
  const safe = createSafeRecord();
  setSafeValue(safe, "context", result);
  return safe;
}

function safeEvent(event: unknown): string {
  if (typeof event !== "string") return "invalid_event";
  return redactString(event, { seen: new WeakSet<object>(), remainingEntries: 0, remainingStringLength: MAX_EVENT_LENGTH }, MAX_EVENT_LENGTH);
}

function errorInfo(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { error_name: "unknown" };
  const state: RedactionState = { seen: new WeakSet<object>(), remainingEntries: 0, remainingStringLength: MAX_STRING_LENGTH };
  try {
    return {
      error_name: typeof error.name === "string" ? redactString(error.name, state, 100) : UNSAFE_VALUE,
      // Mensagens de terceiros podem embutir e-mail ou credencial; aplicam a
      // mesma redação e os mesmos limites do contexto estruturado.
      error_message: typeof error.message === "string" ? redactString(error.message, state) : UNSAFE_VALUE,
    };
  } catch {
    return { error_name: UNSAFE_VALUE, error_message: UNSAFE_VALUE };
  }
}

export function logEvent(event: string, context?: Readonly<Record<string, unknown>>): void {
  console.info(JSON.stringify({ ...redact(context), level: "info", event: safeEvent(event) }));
}

export function logError(event: string, error: unknown, context?: Readonly<Record<string, unknown>>): void {
  const safeEventName = safeEvent(event);
  console.error(JSON.stringify({ ...redact(context), level: "error", event: safeEventName, ...errorInfo(error) }));
  maybeAlertErrorRate(safeEventName);
}

// --- Alerta de taxa de erro operacional (achado P1, auditoria 2026-08-12) ---
// Até aqui, TODA falha (75+ call sites — webhooks, brain, billing, vídeo)
// convergia só pra console.error, sem contador, threshold ou notificação:
// se um provider (Tavus/OpenRouter/Stripe/Recall) começasse a falhar 100%
// das chamadas, nada além de um humano lendo log do Railway saberia. Mesmo
// padrão de janela deslizante + threshold + e-mail fire-and-forget que
// cost-alerts.ts já usa pro teto de custo — mas implementado AQUI (não em
// email.ts) porque email.ts importa este módulo (trackError/logEvent);
// importar email.ts de volta criaria um ciclo. Fetch direto e mínimo ao
// Resend, deliberadamente sem toda a superfície de sendHtmlEmail (só 1
// destinatário fixo, sem template reutilizável).
const ERROR_ALERT_WINDOW_MS = 5 * 60_000;
const ERROR_ALERT_THRESHOLD = 10;
/** Depois de alertar, espera antes de alertar de novo pelo MESMO evento — evita 1 e-mail por falha enquanto o provider segue fora do ar. */
const ERROR_ALERT_COOLDOWN_MS = 30 * 60_000;
const errorTimestampsByEvent = new Map<string, number[]>();
const lastAlertSentByEvent = new Map<string, number>();

function operationalAlertRecipient(): string {
  return (process.env.OPERATIONAL_ALERT_EMAIL ?? "fernando@axtroai.com").trim();
}

async function sendOperationalErrorAlert(event: string, count: number): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  if (apiKey.trim().length === 0 || process.env.PORTAL_FAKE_PROVIDERS === "1") return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Axtro Digital Human OS <no-reply@axtroai.com>",
        to: [operationalAlertRecipient()],
        subject: `Alerta operacional: ${count} falhas de "${event}" em 5min`,
        html: `<p>O evento <strong>${escapeHtmlForAlert(event)}</strong> falhou ${count} vezes nos últimos 5 minutos — pode indicar um provider fora do ar (Tavus/OpenRouter/Stripe/Recall) ou um bug ativo em produção.</p><p>Verifique os logs estruturados do Railway pra esse evento.</p>`,
      }),
    });
    if (!response.ok) console.error(JSON.stringify({ level: "error", event: "operational_alert_send_failed", status: response.status }));
  } catch (error) {
    // Best-effort — nunca lança. Se o próprio alerta falhar, o console.error
    // já emitido por logError continua sendo a fonte de verdade nos logs.
    // Achado onda 8 (D-V2-117): este catch estava mudo — nem esse
    // console.error existia — então uma falha de REDE (timeout, DNS) no
    // envio do próprio alerta desaparecia sem rastro nenhum, pior que uma
    // resposta HTTP de erro (que ao menos cai no branch acima).
    console.error(JSON.stringify({ level: "error", event: "operational_alert_send_failed", reason: error instanceof Error ? error.name : "unknown" }));
  } finally {
    clearTimeout(timer);
  }
}

// RISCO RESIDUAL CONHECIDO, deliberadamente NÃO corrigido nesta onda
// (D-V2-117): este alerta usa a MESMA conta/endpoint da Resend que
// email.ts — se a Resend estiver com rate-limit/quota estourada/chave
// revogada, tanto o e-mail transacional do produto quanto ESTE alerta (que
// existe especificamente pra avisar sobre falhas) falham pelo mesmo
// motivo, e o único resgate vira log bruto do Railway. Corrigir de verdade
// exige um canal de alerta genuinamente independente (Slack/PagerDuty/SMS)
// — infra nova que este repo não tem hoje, não um ajuste de código.
// Retry condicional em email.ts (mesma onda) reduz a chance prática de um
// 429/5xx transitório derrubar os dois ao mesmo tempo, mas não elimina o
// ponto único de falha estrutural.

function escapeHtmlForAlert(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Teto de segurança contra crescimento sem limite (achado da auto-revisão
 * D-V2-114): nada aqui impede em COMPILAÇÃO que um call site futuro
 * interpole um valor de alta cardinalidade (ex.: tenant_id) direto no nome
 * do evento em vez de colocá-lo no `context` — hoje os ~76 call sites
 * existentes usam só strings estáticas, mas é um contrato de convenção, não
 * imposto pelo tipo. Se o número de eventos DISTINTOS já rastreados passar
 * do teto, zera os dois Maps: perde continuidade de contagem por alguns
 * minutos (aceitável, é só telemetria) em vez de crescer sem limite.
 */
const ERROR_ALERT_MAX_TRACKED_EVENTS = 1000;

function maybeAlertErrorRate(event: string): void {
  const now = Date.now();
  if (!errorTimestampsByEvent.has(event) && errorTimestampsByEvent.size >= ERROR_ALERT_MAX_TRACKED_EVENTS) {
    errorTimestampsByEvent.clear();
    lastAlertSentByEvent.clear();
  }
  const cutoff = now - ERROR_ALERT_WINDOW_MS;
  const timestamps = (errorTimestampsByEvent.get(event) ?? []).filter((t) => t > cutoff);
  timestamps.push(now);
  errorTimestampsByEvent.set(event, timestamps);
  if (timestamps.length < ERROR_ALERT_THRESHOLD) return;

  const lastAlert = lastAlertSentByEvent.get(event) ?? 0;
  if (now - lastAlert < ERROR_ALERT_COOLDOWN_MS) return;
  lastAlertSentByEvent.set(event, now);
  void sendOperationalErrorAlert(event, timestamps.length);
}
