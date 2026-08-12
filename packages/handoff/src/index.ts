/**
 * M3-06: warm human handoff. This package owns the handoff proposal
 * lifecycle (one pending proposal per session at a time) but never mutates
 * `active_presenter_id` itself — that authority stays with the domain's
 * existing `presenter.changed` compare-and-swap (Art. 2, One Mouth Rule).
 * Every accepted transfer calls the injected `PresenterFloorChanger` exactly
 * once, so the floor changes exactly once per accepted transfer, never
 * speculatively and never twice.
 */
import { UUID_V7_PATTERN as TENANT_ID_PATTERN } from "@axtro/domain";

export interface HandoffObjection {
  readonly category: string;
  readonly summary: string;
  readonly status: string;
}

export interface HandoffReceiptReference {
  readonly receiptId: string;
  readonly description: string;
}

export interface HandoffContextPacket {
  readonly summary: string;
  readonly objections: readonly HandoffObjection[];
  readonly receipts: readonly HandoffReceiptReference[];
  readonly openActions: readonly string[];
}

export type HandoffStatus = "pending" | "accepted" | "declined" | "timed_out" | "rolled_back" | "conflict_simultaneous_request";

export interface HandoffRequestInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly requestedByActorId: string;
  readonly currentPresenterId: string;
  readonly targetHumanId: string;
  readonly contextPacket: HandoffContextPacket;
  readonly deadlineMs: number;
}

export interface HandoffProposal {
  readonly handoffId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly currentPresenterId: string;
  readonly targetHumanId: string;
  readonly status: HandoffStatus;
  readonly expiresAtMs: number;
}

export interface ChangePresenterInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly expectedPresenterId: string | null;
  readonly newPresenterId: string;
}

export interface ChangePresenterOutcome {
  readonly accepted: boolean;
}

/** The one authority that actually mutates active_presenter_id — the domain's presenter.changed CAS event. */
export interface PresenterFloorChanger {
  changePresenter(input: ChangePresenterInput): Promise<ChangePresenterOutcome>;
}

/** Delivers the context packet to the receiving human. A no-op fake in tests, a real notification channel in production. */
export interface HandoffNotifier {
  notify(handoffId: string, packet: HandoffContextPacket): Promise<void>;
}

export class HandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffError";
  }
}

export interface HandoffClock {
  now(): number;
}

const systemClock: HandoffClock = Object.freeze({ now: () => Date.now() });
let handoffSequence = 0;

export interface HandoffCoordinator {
  requestHandoff(rawInput: unknown): Promise<HandoffProposal>;
  acceptHandoff(handoffId: unknown, acceptingActorId: unknown, atMs: unknown): Promise<HandoffProposal>;
  declineHandoff(handoffId: unknown, atMs: unknown): Promise<HandoffProposal>;
  rollback(handoffId: unknown, atMs: unknown): Promise<HandoffProposal>;
  getProposal(handoffId: string): HandoffProposal | undefined;
}

export function createHandoffCoordinator(
  floorChanger: PresenterFloorChanger,
  notifier: HandoffNotifier,
  clock: HandoffClock = systemClock,
): HandoffCoordinator {
  const proposals = new Map<string, HandoffProposal>();
  const pendingBySession = new Map<string, string>();

  const expireIfNeeded = (proposal: HandoffProposal, atMs: number): HandoffProposal => {
    if (proposal.status !== "pending" || atMs < proposal.expiresAtMs) return proposal;
    const expired = Object.freeze({ ...proposal, status: "timed_out" as const });
    proposals.set(proposal.handoffId, expired);
    if (pendingBySession.get(proposal.sessionId) === proposal.handoffId) pendingBySession.delete(proposal.sessionId);
    return expired;
  };

  return Object.freeze({
    async requestHandoff(rawInput: unknown): Promise<HandoffProposal> {
      const input = parseRequestInput(rawInput);
      const sessionKey = `${input.tenantId}:${input.sessionId}`;
      const existingId = pendingBySession.get(sessionKey);
      if (existingId !== undefined) {
        const existing = expireIfNeeded(proposals.get(existingId)!, clock.now());
        if (existing.status === "pending") {
          handoffSequence += 1;
          const conflicting: HandoffProposal = Object.freeze({
            handoffId: `handoff-${handoffSequence}`,
            tenantId: input.tenantId,
            sessionId: input.sessionId,
            currentPresenterId: input.currentPresenterId,
            targetHumanId: input.targetHumanId,
            status: "conflict_simultaneous_request",
            expiresAtMs: clock.now(),
          });
          proposals.set(conflicting.handoffId, conflicting);
          return conflicting;
        }
      }

      handoffSequence += 1;
      const handoffId = `handoff-${handoffSequence}`;
      const proposal: HandoffProposal = Object.freeze({
        handoffId,
        tenantId: input.tenantId,
        sessionId: input.sessionId,
        currentPresenterId: input.currentPresenterId,
        targetHumanId: input.targetHumanId,
        status: "pending",
        expiresAtMs: clock.now() + input.deadlineMs,
      });
      proposals.set(handoffId, proposal);
      pendingBySession.set(sessionKey, handoffId);
      await notifier.notify(handoffId, input.contextPacket);
      return proposal;
    },

    async acceptHandoff(rawHandoffId: unknown, rawAcceptingActorId: unknown, rawAtMs: unknown): Promise<HandoffProposal> {
      const handoffId = parseHandoffId(rawHandoffId);
      const acceptingActorId = parseNonEmptyString(rawAcceptingActorId, "acceptingActorId");
      const atMs = parseAtMs(rawAtMs);
      const proposal = requireProposal(proposals, handoffId);
      const current = expireIfNeeded(proposal, atMs);
      if (current.status !== "pending") return current;
      if (acceptingActorId !== current.targetHumanId) throw new HandoffError("only the intended human can accept this handoff");

      const outcome = await floorChanger.changePresenter({
        tenantId: current.tenantId,
        sessionId: current.sessionId,
        expectedPresenterId: current.currentPresenterId,
        newPresenterId: current.targetHumanId,
      });
      const resolved: HandoffProposal = Object.freeze({ ...current, status: outcome.accepted ? "accepted" : "declined" });
      proposals.set(handoffId, resolved);
      clearPending(pendingBySession, current);
      return resolved;
    },

    async declineHandoff(rawHandoffId: unknown, rawAtMs: unknown): Promise<HandoffProposal> {
      const handoffId = parseHandoffId(rawHandoffId);
      const atMs = parseAtMs(rawAtMs);
      const proposal = requireProposal(proposals, handoffId);
      const current = expireIfNeeded(proposal, atMs);
      if (current.status !== "pending") return current;
      const resolved: HandoffProposal = Object.freeze({ ...current, status: "declined" });
      proposals.set(handoffId, resolved);
      clearPending(pendingBySession, current);
      return resolved;
    },

    async rollback(rawHandoffId: unknown, rawAtMs: unknown): Promise<HandoffProposal> {
      const handoffId = parseHandoffId(rawHandoffId);
      parseAtMs(rawAtMs);
      const proposal = requireProposal(proposals, handoffId);
      if (proposal.status !== "accepted") throw new HandoffError("only an accepted handoff can be rolled back");
      const outcome = await floorChanger.changePresenter({
        tenantId: proposal.tenantId,
        sessionId: proposal.sessionId,
        expectedPresenterId: proposal.targetHumanId,
        newPresenterId: proposal.currentPresenterId,
      });
      if (!outcome.accepted) throw new HandoffError("rollback CAS failed — the floor no longer matches the expected human presenter");
      const resolved: HandoffProposal = Object.freeze({ ...proposal, status: "rolled_back" });
      proposals.set(handoffId, resolved);
      return resolved;
    },

    getProposal(handoffId: string): HandoffProposal | undefined {
      return proposals.get(handoffId);
    },
  });
}

function clearPending(pendingBySession: Map<string, string>, proposal: HandoffProposal): void {
  const key = `${proposal.tenantId}:${proposal.sessionId}`;
  if (pendingBySession.get(key) === proposal.handoffId) pendingBySession.delete(key);
}

function requireProposal(proposals: Map<string, HandoffProposal>, handoffId: string): HandoffProposal {
  const proposal = proposals.get(handoffId);
  if (proposal === undefined) throw new HandoffError(`unknown handoff: ${handoffId}`);
  return proposal;
}

function parseTenantId(value: unknown): string {
  if (typeof value !== "string" || !TENANT_ID_PATTERN.test(value)) throw new HandoffError("invalid tenantId");
  return value;
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) throw new HandoffError(`invalid ${label}`);
  return value;
}

function parseHandoffId(value: unknown): string {
  return parseNonEmptyString(value, "handoffId");
}

function parseAtMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new HandoffError("invalid atMs");
  return value;
}

function parseContextPacket(value: unknown): HandoffContextPacket {
  if (value === null || typeof value !== "object") throw new HandoffError("invalid contextPacket");
  const record = value as Record<string, unknown>;
  if (typeof record.summary !== "string" || record.summary.length === 0 || record.summary.length > 5_000) {
    throw new HandoffError("invalid contextPacket.summary");
  }
  if (!Array.isArray(record.objections)) throw new HandoffError("invalid contextPacket.objections");
  if (!Array.isArray(record.receipts)) throw new HandoffError("invalid contextPacket.receipts");
  if (!Array.isArray(record.openActions)) throw new HandoffError("invalid contextPacket.openActions");
  return Object.freeze({
    summary: record.summary,
    objections: Object.freeze(record.objections.map((item) => Object.freeze({ ...(item as HandoffObjection) }))),
    receipts: Object.freeze(record.receipts.map((item) => Object.freeze({ ...(item as HandoffReceiptReference) }))),
    openActions: Object.freeze([...(record.openActions as string[])]),
  });
}

function parseRequestInput(value: unknown): HandoffRequestInput {
  if (value === null || typeof value !== "object") throw new HandoffError("invalid handoff request");
  const record = value as Record<string, unknown>;
  const tenantId = parseTenantId(record.tenantId);
  const sessionId = parseNonEmptyString(record.sessionId, "sessionId");
  const requestedByActorId = parseNonEmptyString(record.requestedByActorId, "requestedByActorId");
  const currentPresenterId = parseNonEmptyString(record.currentPresenterId, "currentPresenterId");
  const targetHumanId = parseNonEmptyString(record.targetHumanId, "targetHumanId");
  if (typeof record.deadlineMs !== "number" || !Number.isFinite(record.deadlineMs) || record.deadlineMs <= 0 || record.deadlineMs > 3_600_000) {
    throw new HandoffError("invalid deadlineMs");
  }
  return Object.freeze({
    tenantId,
    sessionId,
    requestedByActorId,
    currentPresenterId,
    targetHumanId,
    contextPacket: parseContextPacket(record.contextPacket),
    deadlineMs: record.deadlineMs,
  });
}
