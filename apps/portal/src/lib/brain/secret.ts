/**
 * Segredo por agente do cérebro customizado (M4-03). Gerado e hasheado na
 * aplicação, nunca em SQL — mesma disciplina de nunca gerar material
 * aleatório sensível no banco já usada no resto do projeto (ex.:
 * createUuidV7 sempre client-side). O banco (0018_agent_brain_config.sql)
 * só armazena e compara o hash; o segredo bruto é devolvido ao operador uma
 * única vez, na rotação, e nunca persistido.
 */
import { createHash, randomBytes } from "node:crypto";

const SECRET_BYTES = 32;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export function generateBrainSecret(): string {
  return randomBytes(SECRET_BYTES).toString("hex");
}

export function hashBrainSecret(rawSecret: string): string {
  if (typeof rawSecret !== "string" || rawSecret.length === 0) {
    throw new RangeError("rawSecret must be a non-empty string");
  }
  return createHash("sha256").update(rawSecret, "utf8").digest("hex");
}

export function isValidBrainSecretHash(value: string): boolean {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}
