/**
 * ADR-039, onda 1b-iv ("Agendar reunião: reserva durável no padrão do
 * ADR-036") — a frase-chave que este arquivo implementa: "Fuso horário e
 * janela de busca (quantos dias à frente, horário comercial) são resolvidos
 * pelo SERVIDOR a partir da conexão de calendário do tenant, nunca
 * informados pelo modelo". Módulo puro (sem I/O, sem provider): dado um
 * fuso IANA e um relógio, devolve os intervalos UTC de horário comercial dos
 * próximos N dias úteis. `propose-meeting-slots.ts` consome isto pra montar
 * a janela de uma única consulta `queryFreeBusy` e gerar slots candidatos
 * dentro dela; `availability.ts` faz essa segunda parte.
 *
 * Políticas padrão (decisão de design desta rodada — a ADR deixa isso em
 * nível de design, ver "Migração 0051", coluna
 * `portal_business_action_calendar_connections.default_timezone`):
 * - Horário comercial: 09:00-18:00 no fuso da conexão do tenant.
 * - Dias úteis: segunda a sexta (fins de semana nunca entram na janela).
 * - Se "agora" cai num fim de semana OU já passou do fim do expediente de
 *   hoje, a busca começa no próximo dia útil, com a janela cheia
 *   (09:00-18:00).
 * - Se "agora" está DENTRO do expediente de hoje, o restante de hoje (de
 *   "agora" até 18:00) conta como o primeiro dia da janela.
 * - Se "agora" é um dia útil mas ainda ANTES das 09:00 (ex.: 03:00 da
 *   madrugada), o dia inteiro (09:00-18:00) ainda não começou e conta como
 *   o primeiro dia cheio — mesma regra que qualquer dia útil futuro, só que
 *   por acaso é hoje.
 *
 * Generaliza o MESMO padrão de `time/florida.ts` (só `Intl.DateTimeFormat`,
 * nunca offset hardcoded, sempre pergunta ao `Intl` o que vale NAQUELE
 * instante) — `wallClockPartsAt` decompõe "que dia/hora é agora, NAQUELE
 * fuso" (inclusive dia da semana, que nenhuma função de `florida.ts`
 * precisava até esta onda); `wallClockToUtcIso` converte cada fronteira de
 * dia útil (09:00/18:00 local) de volta pra um instante UTC, com o mesmo
 * cuidado de DST que já protege `florida.ts` inteiro.
 */
import { wallClockPartsAt, wallClockToUtcIso } from "../time/florida.ts";

export const DEFAULT_BUSINESS_HOURS_START_HOUR = 9;
export const DEFAULT_BUSINESS_HOURS_END_HOUR = 18;
export const DEFAULT_BUSINESS_DAYS_WINDOW_COUNT = 5;

export interface BusinessHoursClock {
  now(): number;
}

/** Um intervalo de horário comercial de um único dia útil, já em instantes UTC (ms desde epoch). */
export interface BusinessDayWindow {
  readonly startAtMs: number;
  readonly endAtMs: number;
}

export interface BusinessDayWindowOptions {
  /** Quantos dias úteis a janela de busca cobre. Default 5 (ADR-039 onda 1b-iv). */
  readonly businessDaysCount?: number;
  /** Hora local (0-23) de início do expediente. Default 9. */
  readonly businessStartHour?: number;
  /** Hora local (0-23) de fim do expediente. Default 18. */
  readonly businessEndHour?: number;
  readonly clock?: BusinessHoursClock;
}

const systemClock: BusinessHoursClock = Object.freeze({ now: () => Date.now() });

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `getUTCDay()` devolve 0=domingo..6=sábado; ISO 8601 usa 1=segunda..7=domingo. */
function isoWeekdayOfCalendarDate(date: CalendarDate): number {
  const jsWeekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return jsWeekday === 0 ? 7 : jsWeekday;
}

function isWeekendIsoWeekday(isoWeekday: number): boolean {
  return isoWeekday === 6 || isoWeekday === 7;
}

/**
 * Aritmética de dia de calendário nunca depende de fuso — só quando um dia+
 * hora LOCAL vira um instante UTC de verdade (`wallClockToUtcIso`, abaixo) o
 * fuso importa. Por isso soma em cima de `Date.UTC` "ingênuo", nunca em cima
 * de um instante real de `clock.now()`.
 */
function addCalendarDays(date: CalendarDate, deltaDays: number): CalendarDate {
  const ms = Date.UTC(date.year, date.month - 1, date.day) + deltaDays * 24 * 60 * 60 * 1_000;
  const asDate = new Date(ms);
  return { year: asDate.getUTCFullYear(), month: asDate.getUTCMonth() + 1, day: asDate.getUTCDate() };
}

function wallClockLabel(date: CalendarDate, hour: number): string {
  return `${String(date.year).padStart(4, "0")}-${pad2(date.month)}-${pad2(date.day)}T${pad2(hour)}:00:00`;
}

function validateHourRange(businessStartHour: number, businessEndHour: number): void {
  if (
    !Number.isInteger(businessStartHour) || !Number.isInteger(businessEndHour)
    || businessStartHour < 0 || businessStartHour > 23
    || businessEndHour < 1 || businessEndHour > 23
    || businessStartHour >= businessEndHour
  ) {
    throw new RangeError("businessStartHour/businessEndHour must be integers in 0..23 describing a non-empty same-day range");
  }
}

/**
 * Devolve os intervalos de horário comercial (UTC) dos próximos
 * `businessDaysCount` dias úteis a partir de `options.clock` (ou o relógio
 * real), no fuso `timeZone` — ver as políticas no cabeçalho do arquivo.
 * Nunca devolve um intervalo degenerado (start >= end): o dia corrente é
 * omitido da janela quando o expediente de hoje já terminou.
 */
export function computeBusinessDayWindows(timeZone: string, options: BusinessDayWindowOptions = {}): readonly BusinessDayWindow[] {
  const businessDaysCount = options.businessDaysCount ?? DEFAULT_BUSINESS_DAYS_WINDOW_COUNT;
  const businessStartHour = options.businessStartHour ?? DEFAULT_BUSINESS_HOURS_START_HOUR;
  const businessEndHour = options.businessEndHour ?? DEFAULT_BUSINESS_HOURS_END_HOUR;
  if (!Number.isInteger(businessDaysCount) || businessDaysCount < 1 || businessDaysCount > 30) {
    throw new RangeError("businessDaysCount must be an integer between 1 and 30");
  }
  validateHourRange(businessStartHour, businessEndHour);

  const clock = options.clock ?? systemClock;
  const nowMs = clock.now();
  const nowParts = wallClockPartsAt(nowMs, timeZone);
  const today: CalendarDate = { year: nowParts.year, month: nowParts.month, day: nowParts.day };
  const nowMinuteOfDay = nowParts.hour * 60 + nowParts.minute;
  const businessStartMinuteOfDay = businessStartHour * 60;
  const businessEndMinuteOfDay = businessEndHour * 60;

  const windows: BusinessDayWindow[] = [];
  let cursor: CalendarDate = today;

  // Bound defensivo (não deveria disparar com businessDaysCount<=30 e fins
  // de semana no máximo dobrando o número de dias percorridos): evita um
  // loop infinito caso alguma combinação futura de parâmetros o permita.
  const MAX_ITERATIONS = 400;
  for (let iteration = 0; windows.length < businessDaysCount && iteration < MAX_ITERATIONS; iteration += 1) {
    const isoWeekday = isoWeekdayOfCalendarDate(cursor);
    if (isWeekendIsoWeekday(isoWeekday)) {
      cursor = addCalendarDays(cursor, 1);
      continue;
    }
    // Cada dia de calendário só é visitado uma vez, sempre avançando — se
    // `cursor` bater com `today`, só pode ser a primeira iteração deste laço.
    const isToday = cursor.year === today.year && cursor.month === today.month && cursor.day === today.day;
    const restOfTodayApplies = isToday && nowMinuteOfDay >= businessStartMinuteOfDay && nowMinuteOfDay < businessEndMinuteOfDay;
    const todayAlreadyOver = isToday && nowMinuteOfDay >= businessEndMinuteOfDay;

    if (!todayAlreadyOver) {
      const startAtMs = restOfTodayApplies ? nowMs : Date.parse(wallClockToUtcIso(wallClockLabel(cursor, businessStartHour), timeZone));
      const endAtMs = Date.parse(wallClockToUtcIso(wallClockLabel(cursor, businessEndHour), timeZone));
      if (endAtMs > startAtMs) windows.push(Object.freeze({ startAtMs, endAtMs }));
    }
    cursor = addCalendarDays(cursor, 1);
  }

  return Object.freeze(windows);
}
