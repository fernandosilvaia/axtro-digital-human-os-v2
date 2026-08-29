/**
 * ADR-039, onda 1b-iv: calcula disponibilidade real de calendário, dentro do
 * horário comercial multi-dia que `business-hours.ts` já resolve
 * server-side. Módulo puro em relação a Supabase/RPC (não sabe nada de
 * tenant/grant/receipt) — recebe um `port` de calendário já pronto (real ou
 * fake, decisão de `propose-meeting-slots.ts`) e devolve slots candidatos,
 * nunca decide sozinho o que fazer com eles.
 */
import { createUuidV7 } from "@axtro/domain";
import type { GoogleCalendarPort } from "@axtro/provider-google-calendar";

import {
  computeBusinessDayWindows,
  DEFAULT_BUSINESS_DAYS_WINDOW_COUNT,
  DEFAULT_BUSINESS_HOURS_END_HOUR,
  DEFAULT_BUSINESS_HOURS_START_HOUR,
  type BusinessHoursClock,
} from "./business-hours.ts";

export const MEETING_DURATION_MINUTES_ALLOWLIST = [15, 30, 45, 60] as const;
export type MeetingDurationMinutes = (typeof MEETING_DURATION_MINUTES_ALLOWLIST)[number];
const MEETING_DURATION_MINUTES_SET: ReadonlySet<number> = new Set(MEETING_DURATION_MINUTES_ALLOWLIST);

/** Bem abaixo do teto que a RPC aceita (ADR-039 onda 1b-iv, decisão desta rodada). */
export const DEFAULT_MAX_PROPOSED_SLOTS = 10;
/** Mesmo teto que `portal_business_action_proposal_slots_index_chk` (0..49) aceita — nunca pedimos mais do que a RPC aceitaria. */
export const MAX_PROPOSED_SLOTS_CEILING = 50;

/** Exatamente o shape que `portal_propose_business_meeting_slots_service` espera em cada elemento de `p_slots` (mais `timezone`, útil pro chamador/UI — descartado ao montar o payload da RPC, ver `propose-meeting-slots.ts`). */
export interface ProposedCalendarSlot {
  readonly id: string;
  /** ISO 8601 UTC. */
  readonly startAt: string;
  /** ISO 8601 UTC. */
  readonly endAt: string;
  readonly timezone: string;
}

export class GoogleCalendarAvailabilityInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCalendarAvailabilityInputError";
  }
}

export interface ComputeGoogleCalendarAvailableSlotsOptions {
  readonly durationMinutes: number;
  readonly timezone: string;
  readonly calendarId: string;
  /** Default 10 (`DEFAULT_MAX_PROPOSED_SLOTS`). */
  readonly maxSlots?: number;
  readonly businessDaysCount?: number;
  readonly businessStartHour?: number;
  readonly businessEndHour?: number;
  readonly clock?: BusinessHoursClock;
  readonly idGenerator?: () => string;
}

interface BusyIntervalMs {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Reimplementação local, deliberadamente NÃO importada de
 * `packages/tool-adapters/calendar/src/index.ts` — decisão de design desta
 * rodada. Aquele pacote é o walking skeleton M3-04 que ADR-039 cita como já
 * modelando "a forma certa do problema" (propor é sem efeito, confirmar é
 * escrita separada), mas sua `mergeIntervals` não é exportada — é um detalhe
 * interno do `Map` de processo que a própria ADR diz que NÃO é reaproveitado
 * pra armazenamento (as RPCs 0052/0053 são a versão durável). Alargar a
 * superfície pública daquele pacote só pra importar uma função de ~10 linhas
 * sem estado pareceu pior do que duplicar a MESMA lógica (ordena por início,
 * funde intervalos sobrepostos/adjacentes) aqui, num módulo que já é
 * self-contained em relação a `@axtro/provider-google-calendar`.
 */
function mergeBusyIntervals(intervals: readonly BusyIntervalMs[]): readonly BusyIntervalMs[] {
  const sorted = [...intervals].sort((left, right) => left.startMs - right.startMs);
  const merged: BusyIntervalMs[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.startMs <= last.endMs) {
      merged[merged.length - 1] = Object.freeze({ startMs: last.startMs, endMs: Math.max(last.endMs, interval.endMs) });
    } else {
      merged.push(Object.freeze({ ...interval }));
    }
  }
  return merged;
}

function hasConflict(candidate: BusyIntervalMs, merged: readonly BusyIntervalMs[]): boolean {
  return merged.some((interval) => candidate.startMs < interval.endMs && candidate.endMs > interval.startMs);
}

/**
 * Calcula até `maxSlots` horários candidatos livres, dentro do horário
 * comercial dos próximos dias úteis (`business-hours.ts`), chamando
 * `queryFreeBusy` UMA única vez para a janela inteira (nunca uma chamada por
 * dia — desnecessário e mais lento, ADR-039 onda 1b-iv). `port` aceita
 * qualquer objeto com `queryFreeBusy` (não o `GoogleCalendarPort` completo):
 * `propose-meeting-slots.ts` passa o port real/fake de verdade; testes podem
 * passar um objeto mínimo. Cada slot dentro do primeiro dia da janela (o
 * "resto de hoje", quando aplicável) começa exatamente em `clock.now()`, não
 * alinhado a uma grade de horário — dias inteiros seguintes alinham a
 * `businessStartHour` (mesmo espírito de "cursor stepping from window
 * start" que `packages/tool-adapters/calendar` já usa).
 */
export async function computeGoogleCalendarAvailableSlots(
  port: Pick<GoogleCalendarPort, "queryFreeBusy">,
  options: ComputeGoogleCalendarAvailableSlotsOptions,
): Promise<readonly ProposedCalendarSlot[]> {
  if (!MEETING_DURATION_MINUTES_SET.has(options.durationMinutes)) {
    throw new GoogleCalendarAvailabilityInputError(`durationMinutes must be one of ${MEETING_DURATION_MINUTES_ALLOWLIST.join(", ")}`);
  }
  if (typeof options.calendarId !== "string" || options.calendarId.length === 0) {
    throw new GoogleCalendarAvailabilityInputError("calendarId must be a non-empty string");
  }
  const maxSlots = options.maxSlots ?? DEFAULT_MAX_PROPOSED_SLOTS;
  if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > MAX_PROPOSED_SLOTS_CEILING) {
    throw new GoogleCalendarAvailabilityInputError(`maxSlots must be an integer between 1 and ${MAX_PROPOSED_SLOTS_CEILING}`);
  }
  const idGenerator = options.idGenerator ?? createUuidV7;

  const windows = computeBusinessDayWindows(options.timezone, {
    businessDaysCount: options.businessDaysCount ?? DEFAULT_BUSINESS_DAYS_WINDOW_COUNT,
    businessStartHour: options.businessStartHour ?? DEFAULT_BUSINESS_HOURS_START_HOUR,
    businessEndHour: options.businessEndHour ?? DEFAULT_BUSINESS_HOURS_END_HOUR,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const firstWindow = windows[0];
  if (firstWindow === undefined) return Object.freeze([]);
  const lastWindow = windows[windows.length - 1]!;

  const freeBusy = await port.queryFreeBusy({
    calendarId: options.calendarId,
    timeMinIso: new Date(firstWindow.startAtMs).toISOString(),
    timeMaxIso: new Date(lastWindow.endAtMs).toISOString(),
  });
  const busy: BusyIntervalMs[] = freeBusy.busy.map((interval) => Object.freeze({
    startMs: Date.parse(interval.startIso),
    endMs: Date.parse(interval.endIso),
  }));
  const merged = mergeBusyIntervals(busy);

  const durationMs = options.durationMinutes * 60_000;
  const slots: ProposedCalendarSlot[] = [];
  for (const window of windows) {
    if (slots.length >= maxSlots) break;
    for (let candidateStartMs = window.startAtMs; candidateStartMs + durationMs <= window.endAtMs && slots.length < maxSlots; candidateStartMs += durationMs) {
      const candidateEndMs = candidateStartMs + durationMs;
      if (!hasConflict({ startMs: candidateStartMs, endMs: candidateEndMs }, merged)) {
        slots.push(Object.freeze({
          id: idGenerator(),
          startAt: new Date(candidateStartMs).toISOString(),
          endAt: new Date(candidateEndMs).toISOString(),
          timezone: options.timezone,
        }));
      }
    }
  }

  return Object.freeze(slots);
}
