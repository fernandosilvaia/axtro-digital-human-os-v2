import { ProviderContractError } from "./normalization.js";

declare const authorizedToolExecutionBrand: unique symbol;

/**
 * Opaque proof reserved for the Action Runtime. M0-11 intentionally exposes no
 * factory because a syntactically valid ActionIntent and PolicyDecision are not
 * proof of authenticated authorization.
 */
export interface AuthorizedToolExecution {
  readonly [authorizedToolExecutionBrand]: "AuthorizedToolExecution";
}

/**
 * Tool execution is deliberately unavailable until M0-14 owns validation,
 * policy, approval, idempotency and receipt creation as one action runtime.
 */
export function assertAuthorizedToolExecution(_value: unknown): asserts _value is AuthorizedToolExecution {
  throw new ProviderContractError("action_runtime_required");
}
