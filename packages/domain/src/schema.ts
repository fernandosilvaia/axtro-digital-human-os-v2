import type { EventEnvelope } from "@axtro/contracts-ts";

export const CURRENT_SCHEMA_VERSION = "2.0.0" as const;
export type SchemaVersion = typeof CURRENT_SCHEMA_VERSION;
export type DataClassification = EventEnvelope["data_classification"];

const DATA_CLASSIFICATIONS: readonly DataClassification[] = [
  "public",
  "internal",
  "confidential",
  "restricted",
];

export class SchemaVersionMismatchError extends Error {
  constructor(readonly received: string) {
    super(`Unsupported schema version ${received}; expected ${CURRENT_SCHEMA_VERSION}`);
    this.name = "SchemaVersionMismatchError";
  }
}

export function parseSchemaVersion(value: string): SchemaVersion {
  if (value !== CURRENT_SCHEMA_VERSION) throw new SchemaVersionMismatchError(value);
  return CURRENT_SCHEMA_VERSION;
}

export function isDataClassification(value: string): value is DataClassification {
  return (DATA_CLASSIFICATIONS as readonly string[]).includes(value);
}

export function parseDataClassification(value: string): DataClassification {
  if (!isDataClassification(value)) {
    throw new RangeError(`Unsupported data classification: ${value}`);
  }
  return value;
}
