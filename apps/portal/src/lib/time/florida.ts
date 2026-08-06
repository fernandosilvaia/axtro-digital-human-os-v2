/**
 * Conversão de horário local da Flórida (America/New_York) para UTC, sem
 * depender de biblioteca de datas — usa só `Intl.DateTimeFormat`, que já
 * carrega as regras de fuso/horário de verão do sistema. Existe porque o
 * Fernando agenda calls no horário dele (Flórida), mas toda API externa
 * (Recall.ai `join_at`) exige ISO 8601 em UTC.
 *
 * America/New_York alterna entre EST (UTC-5) e EDT (UTC-4) — nunca hardcode
 * o offset; sempre pergunte ao `Intl` qual vale NAQUELE instante específico.
 */

const TIME_ZONE = "America/New_York";
const NAIVE_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export class FloridaTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FloridaTimeError";
  }
}

/** Offset (em minutos) de `timeZone` em relação a UTC, no instante `atMs`. Negativo pra oeste de UTC. */
function timeZoneOffsetMinutesAt(timeZone: string, atMs: number): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(atMs)).map((part) => [part.type, part.value]));
  const wallClockAsUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (wallClockAsUtcMs - atMs) / 60_000;
}

/**
 * `wallClock` é hora LOCAL do fuso `timeZone` (IANA), sem offset embutido.
 * Devolve o ISO 8601 em UTC correspondente, pronto pro `joinAtIso` do
 * Recall.ai. Generalizado do caso Flórida (auditoria 2026-08-02: o produto
 * é multi-tenant e cada conta tem `default_timezone` próprio — um dono em
 * São Paulo que agendava "15:00" colocava o bot 1-2h errado).
 */
export function wallClockToUtcIso(wallClock: string, timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new FloridaTimeError(`unknown IANA time zone: ${timeZone}`);
  }
  const match = NAIVE_DATETIME_PATTERN.exec(wallClock);
  if (match === null) {
    throw new FloridaTimeError('wallClock must look like "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss", with no timezone');
  }
  const [, year, month, day, hour, minute, second] = match;
  const guessUtcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? "0"));
  if (!Number.isFinite(guessUtcMs)) {
    throw new FloridaTimeError("wallClock does not represent a valid calendar date/time");
  }
  const offsetMinutes = timeZoneOffsetMinutesAt(timeZone, guessUtcMs);
  let actualUtcMs = guessUtcMs - offsetMinutes * 60_000;
  // Segunda iteração: perto das transições de horário de verão, o offset no
  // instante-chute (wall-clock lido como UTC) pode divergir do offset no
  // instante REAL — ex.: "03:30" do dia do spring-forward avaliava EST e
  // devolvia 1h atrasado. Recalcular no instante encontrado e reaplicar
  // corrige (auditoria 2026-08-02).
  const offsetAtActual = timeZoneOffsetMinutesAt(timeZone, actualUtcMs);
  if (offsetAtActual !== offsetMinutes) {
    actualUtcMs = guessUtcMs - offsetAtActual * 60_000;
  }
  return new Date(actualUtcMs).toISOString();
}

/** Atalho legado: hora local da Flórida (America/New_York) → UTC. */
export function floridaWallClockToUtcIso(wallClock: string): string {
  return wallClockToUtcIso(wallClock, TIME_ZONE);
}
