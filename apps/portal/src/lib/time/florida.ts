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

/** Lê as partes nomeadas (`year`/`month`/`day`/`hour`/`minute`/`second`/`weekday`...) de um `Intl.DateTimeFormat` num instante — o mesmo passo repetido por toda função deste arquivo que precisa "que horas são, NAQUELE fuso, NAQUELE instante". */
function formatPartsRecord(formatter: Intl.DateTimeFormat, atMs: number): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(new Date(atMs)).map((part) => [part.type, part.value]));
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
  const parts = formatPartsRecord(formatter, atMs);
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

/** Data/hora local decomposta num fuso IANA, num instante UTC específico. */
export interface WallClockParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** Dia da semana ISO 8601: 1 = segunda ... 7 = domingo. */
  readonly isoWeekday: number;
}

const ISO_WEEKDAY_BY_SHORT_NAME: Readonly<Record<string, number>> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

/**
 * Generalização do MESMO passo que `timeZoneOffsetMinutesAt` já faz pra
 * calcular offset (pergunta ao `Intl` "que horas são NAQUELE fuso, NAQUELE
 * instante"), agora devolvendo a data/hora inteira decomposta — inclusive o
 * dia da semana, que `wallClockToUtcIso`/`timeZoneOffsetMinutesAt` nunca
 * precisaram até agora (ADR-039, onda 1b-iv: descobrir "hoje é dia útil no
 * fuso do tenant?" e "que horas são agora, LÁ?" pra montar a janela de busca
 * de horário comercial). Mesmo cuidado com fuso desconhecido dos outros
 * exports deste arquivo: nunca falha silenciosamente.
 */
export function wallClockPartsAt(atMs: number, timeZone: string): WallClockParts {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new FloridaTimeError(`unknown IANA time zone: ${timeZone}`);
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const parts = formatPartsRecord(formatter, atMs);
  const isoWeekday = ISO_WEEKDAY_BY_SHORT_NAME[parts.weekday ?? ""];
  if (isoWeekday === undefined) {
    throw new FloridaTimeError(`unable to resolve the weekday for time zone: ${timeZone}`);
  }
  return Object.freeze({
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    isoWeekday,
  });
}
