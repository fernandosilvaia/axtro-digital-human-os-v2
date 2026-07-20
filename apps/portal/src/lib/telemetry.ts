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
    ? { error_name: error.name, error_message: error.message }
    : { error_name: "unknown" };
  console.error(JSON.stringify({ level: "error", event, ...errorInfo, ...redact(context) }));
}
