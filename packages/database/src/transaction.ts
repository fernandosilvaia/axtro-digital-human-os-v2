/**
 * Small local transaction coordinator used by deterministic repositories in
 * M0. It deliberately models rollback without selecting an ORM or a database
 * driver. Production persistence adapters remain responsible for database
 * transactions and transaction-local tenant context.
 */
export interface TransactionalStateParticipant<Snapshot> {
  captureSnapshot(): Snapshot;
  restoreSnapshot(snapshot: Snapshot): void;
}

export class DeterministicTransactionError extends Error {
  constructor(message = "Deterministic transaction could not be completed") {
    super(message);
    this.name = "DeterministicTransactionError";
  }
}

/**
 * Coordinates one copy-on-write state participant at a time. Re-entrant work
 * is rejected rather than accidentally merging two logical transactions.
 */
export class DeterministicTransactionCoordinator {
  #active = false;

  /**
   * Synchronous counterpart for deterministic, in-process repositories. It
   * avoids yielding between a state write and its rollback boundary, which
   * keeps duplicate delivery checks atomic on the JavaScript event loop.
   */
  executeSync<Result, Snapshot>(
    participant: TransactionalStateParticipant<Snapshot>,
    work: () => Result,
  ): Result {
    if (!isParticipant(participant) || typeof work !== "function") {
      throw new DeterministicTransactionError();
    }
    if (this.#active) throw new DeterministicTransactionError("Nested deterministic transactions are not supported");

    this.#active = true;
    let snapshot: Snapshot | undefined;
    let captured = false;
    try {
      snapshot = participant.captureSnapshot();
      captured = true;
      return work();
    } catch (error) {
      if (captured) {
        try {
          participant.restoreSnapshot(snapshot as Snapshot);
        } catch {
          throw new DeterministicTransactionError("Deterministic transaction rollback failed");
        }
      }
      throw error;
    } finally {
      this.#active = false;
    }
  }

  async execute<Result, Snapshot>(
    participant: TransactionalStateParticipant<Snapshot>,
    work: () => Result | Promise<Result>,
  ): Promise<Result> {
    if (!isParticipant(participant) || typeof work !== "function") {
      throw new DeterministicTransactionError();
    }
    if (this.#active) throw new DeterministicTransactionError("Nested deterministic transactions are not supported");

    this.#active = true;
    let snapshot: Snapshot | undefined;
    let captured = false;
    try {
      snapshot = participant.captureSnapshot();
      captured = true;
      return await work();
    } catch (error) {
      if (captured) {
        try {
          participant.restoreSnapshot(snapshot as Snapshot);
        } catch {
          throw new DeterministicTransactionError("Deterministic transaction rollback failed");
        }
      }
      throw error;
    } finally {
      this.#active = false;
    }
  }
}

export function createDeterministicTransactionCoordinator(): DeterministicTransactionCoordinator {
  return new DeterministicTransactionCoordinator();
}

function isParticipant(value: unknown): value is TransactionalStateParticipant<unknown> {
  return value !== null
    && typeof value === "object"
    && typeof (value as TransactionalStateParticipant<unknown>).captureSnapshot === "function"
    && typeof (value as TransactionalStateParticipant<unknown>).restoreSnapshot === "function";
}
