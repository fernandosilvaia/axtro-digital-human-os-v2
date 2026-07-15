import type { RolePackManifest } from "@axtro/contracts-ts";

/**
 * M3-01: the Sales Closer Role Pack manifest. Per
 * docs/architecture/ROLE_AND_SKILL_PACKS.md, effective capabilities are an
 * intersection of platform + region/sector + tenant + agent grants + this
 * manifest + skill packs — a Role Pack never widens tenant policy, it only
 * narrows what the generic kernel already allows.
 */
export const ROLE_PACK_ID = "sales-closer";

export const SALES_CLOSER_MANIFEST: RolePackManifest = Object.freeze({
  schema_version: "2.0.0",
  role_pack_id: ROLE_PACK_ID,
  name: "Sales Closer",
  version: "0.1.0",
  role_type: "sales",
  description: "Role pack consultivo para descoberta, demonstração e próximo passo.",
  state_schema_ref: "https://schemas.axtro.ai/v2/sales_state.schema.json",
  allowed_skill_pack_ids: Object.freeze([
    "catalog-read",
    "calendar-propose",
    "proposal-draft",
    "handoff-request",
  ]) as string[],
  required_disclosures: Object.freeze(["ai_identity"]) as string[],
  default_policies: Object.freeze(["no-deception", "receipt-before-claim"]) as string[],
  supported_languages: Object.freeze(["pt-BR", "en-US"]) as string[],
  status: "active",
  checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
}) as RolePackManifest;

export class RolePackManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RolePackManifestError";
  }
}

const MANIFEST_KEYS = [
  "schema_version",
  "role_pack_id",
  "name",
  "version",
  "role_type",
  "description",
  "state_schema_ref",
  "allowed_skill_pack_ids",
  "required_disclosures",
  "default_policies",
  "supported_languages",
  "status",
  "checksum",
] as const;
const STATUS_VALUES = ["draft", "active", "deprecated", "disabled"] as const;
const LANGUAGE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

/** Validates an untrusted manifest against contracts/schemas/role_pack_manifest.schema.json's constraints. */
export function parseRolePackManifest(value: unknown): RolePackManifest {
  const record = exactRecord(value, "role pack manifest", MANIFEST_KEYS);
  if (record.schema_version !== "2.0.0") throw new RolePackManifestError("manifest.schema_version must be 2.0.0");
  return Object.freeze({
    schema_version: "2.0.0",
    role_pack_id: stringValue(record.role_pack_id, "manifest.role_pack_id", 1, 200),
    name: stringValue(record.name, "manifest.name", 1, 200),
    version: stringValue(record.version, "manifest.version", 1, 50),
    role_type: stringValue(record.role_type, "manifest.role_type", 1, 120),
    description: stringValue(record.description, "manifest.description", 1, 2_000),
    state_schema_ref: stringValue(record.state_schema_ref, "manifest.state_schema_ref", 1, 500),
    allowed_skill_pack_ids: stringArray(record.allowed_skill_pack_ids, "manifest.allowed_skill_pack_ids", 0, 100),
    required_disclosures: stringArray(record.required_disclosures, "manifest.required_disclosures", 1, 50),
    default_policies: stringArray(record.default_policies, "manifest.default_policies", 1, 100),
    supported_languages: languageArray(record.supported_languages, "manifest.supported_languages"),
    status: enumValue(record.status, STATUS_VALUES, "manifest.status"),
    checksum: patternValue(record.checksum, "manifest.checksum", CHECKSUM_PATTERN),
  }) as RolePackManifest;
}

function exactRecord(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new RolePackManifestError(`${label} must be a plain object`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new RolePackManifestError(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return record;
}

function stringValue(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new RolePackManifestError(`${label} must be a string between ${minimum} and ${maximum} characters`);
  }
  return value;
}

function patternValue(value: unknown, label: string, pattern: RegExp): string {
  const text = stringValue(value, label, 1, 500);
  if (!pattern.test(text)) throw new RolePackManifestError(`${label} does not match the required pattern`);
  return text;
}

function stringArray(value: unknown, label: string, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new RolePackManifestError(`${label} must be an array with ${minimum} to ${maximum} items`);
  }
  return value.map((item, index) => stringValue(item, `${label}[${index}]`, 1, 200));
}

function languageArray(value: unknown, label: string): string[] {
  const values = stringArray(value, label, 1, 100);
  return values.map((language, index) => patternValue(language, `${label}[${index}]`, LANGUAGE_PATTERN));
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new RolePackManifestError(`${label} is not an allowed value`);
  }
  return value as T[number];
}
