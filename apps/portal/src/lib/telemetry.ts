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
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{8,}|(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9+/=]{8,}|re_[A-Za-z0-9_-]{8,}|[A-Fa-f0-9]{32,})\b/g;

function redact(context?: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (REDACT_KEY_PATTERN.test(key)) {
      safe[key] = "[redacted]";
      continue;
    }
    safe[key] = typeof value === "string" ? value.replace(EMAIL_PATTERN, "[redacted-email]") : value;
  }
  return safe;
}

export function logEvent(event: string, context?: Readonly<Record<string, unknown>>): void {
  console.info(JSON.stringify({ level: "info", event, ...redact(context) }));
}

export function logError(event: string, error: unknown, context?: Readonly<Record<string, unknown>>): void {
  const errorInfo = error instanceof Error
    ? // Mensagens de erro de terceiros (Supabase, Resend, Tavus...) podem
      // embutir e-mail de destinatário ou trecho de credencial — passam pela
      // mesma redação do context (auditoria 2026-08-02).
      { error_name: error.name, error_message: error.message.replace(EMAIL_PATTERN, "[redacted-email]").replace(SECRET_PATTERN, "[redacted-secret]") }
    : { error_name: "unknown" };
  console.error(JSON.stringify({ level: "error", event, ...errorInfo, ...redact(context) }));
  maybeAlertErrorRate(event);
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
