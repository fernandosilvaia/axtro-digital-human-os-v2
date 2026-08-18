/**
 * Limites conservadores antes do dispatch para OpenRouter.
 *
 * O modelo permitido pela rate card usa tokenização baseada em bytes: um
 * token de conteúdo não pode representar menos de um byte UTF-8. Reservamos
 * ainda uma margem fixa e por mensagem para framing/protocolo. Assim, se o
 * limite abaixo passa, o provider não pode reportar mais tokens de entrada
 * que a reserva apenas pela serialização da solicitação.
 *
 * Esta não é uma estimativa de custo para UX. É uma prova de teto usada antes
 * de atravessar a fence de dispatch; qualquer mudança de modelo continua
 * bloqueada por `configuredOpenRouterGenerationModel`.
 */

export class AiUsageEnvelopeError extends Error {
  readonly upperBoundTokens: number;
  readonly maxInputTokens: number;

  constructor(operation: string, upperBoundTokens: number, maxInputTokens: number) {
    super(`${operation} input exceeds the reserved token envelope (${upperBoundTokens} > ${maxInputTokens})`);
    this.name = "AiUsageEnvelopeError";
    this.upperBoundTokens = upperBoundTokens;
    this.maxInputTokens = maxInputTokens;
  }
}

interface MessageLike {
  readonly role: string;
  readonly content: string;
}

const EMBEDDING_PROTOCOL_TOKEN_RESERVE = 64;
const GENERATION_REQUEST_TOKEN_RESERVE = 256;
const GENERATION_MESSAGE_TOKEN_RESERVE = 32;

function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function requireFinitePositiveLimit(maxInputTokens: number): void {
  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1) {
    throw new TypeError("maxInputTokens must be a positive safe integer");
  }
}

/** Upper bound for a single OpenAI-compatible embeddings request. */
export function embeddingInputTokenUpperBound(inputs: readonly string[]): number {
  return EMBEDDING_PROTOCOL_TOKEN_RESERVE + inputs.reduce((total, input) => {
    if (typeof input !== "string") throw new TypeError("embedding input must be a string");
    return total + utf8ByteLength(input);
  }, 0);
}

export function assertEmbeddingFitsReservedInput(
  inputs: readonly string[],
  maxInputTokens: number,
): void {
  requireFinitePositiveLimit(maxInputTokens);
  const upperBoundTokens = embeddingInputTokenUpperBound(inputs);
  if (upperBoundTokens > maxInputTokens) {
    throw new AiUsageEnvelopeError("embedding", upperBoundTokens, maxInputTokens);
  }
}

/** Upper bound for the content plus OpenAI-compatible chat framing. */
export function generationInputTokenUpperBound(messages: readonly MessageLike[]): number {
  return GENERATION_REQUEST_TOKEN_RESERVE + messages.reduce((total, message) => {
    if (typeof message?.role !== "string" || typeof message.content !== "string") {
      throw new TypeError("generation message must contain string role and content");
    }
    return total
      + GENERATION_MESSAGE_TOKEN_RESERVE
      + utf8ByteLength(message.role)
      + utf8ByteLength(message.content);
  }, 0);
}

export function assertGenerationFitsReservedInput(
  messages: readonly MessageLike[],
  maxInputTokens: number,
): void {
  requireFinitePositiveLimit(maxInputTokens);
  const upperBoundTokens = generationInputTokenUpperBound(messages);
  if (upperBoundTokens > maxInputTokens) {
    throw new AiUsageEnvelopeError("generation", upperBoundTokens, maxInputTokens);
  }
}
