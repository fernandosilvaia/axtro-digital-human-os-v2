import { parseTenantId, type TenantId } from "@axtro/domain";

declare const tenantCacheKeyBrand: unique symbol;
declare const tenantObjectKeyBrand: unique symbol;

export type TenantCacheKey = string & { readonly [tenantCacheKeyBrand]: "TenantCacheKey" };
export type TenantObjectKey = string & { readonly [tenantObjectKeyBrand]: "TenantObjectKey" };

export class TenantNamespaceError extends Error {
  constructor(readonly field: string) {
    super(`${field} must be a normalized tenant namespace segment`);
    this.name = "TenantNamespaceError";
  }
}

/** Build a collision-resistant cache key that always carries its tenant namespace. */
export function createTenantCacheKey(
  tenantId: unknown,
  environment: unknown,
  namespace: unknown,
  parts: readonly unknown[],
): TenantCacheKey {
  const tenant = parseTenantId(tenantId);
  const normalizedEnvironment = normalizeEnvironment(environment);
  const normalizedNamespace = normalizeSegment(namespace, "namespace");
  const normalizedParts = normalizeParts(parts);
  return `${normalizedEnvironment}:tenant:${tenant}:cache:${normalizedNamespace}:${normalizedParts.join(":")}` as TenantCacheKey;
}

/** Build an object-storage key that begins with the tenant identifier by construction. */
export function createTenantObjectKey(
  tenantId: unknown,
  environment: unknown,
  category: unknown,
  parts: readonly unknown[],
): TenantObjectKey {
  const tenant = parseTenantId(tenantId);
  const normalizedEnvironment = normalizeEnvironment(environment);
  const normalizedCategory = normalizeSegment(category, "category");
  const normalizedParts = normalizeParts(parts);
  return `${tenant}/${normalizedEnvironment}/${normalizedCategory}/${normalizedParts.join("/")}` as TenantObjectKey;
}

function normalizeEnvironment(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(value)) {
    throw new TenantNamespaceError("environment");
  }
  return value;
}

function normalizeParts(parts: readonly unknown[]): readonly string[] {
  if (!Array.isArray(parts) || parts.length === 0) throw new TenantNamespaceError("parts");
  return Object.freeze(parts.map((part, index) => normalizeSegment(part, `parts[${index}]`)));
}

function normalizeSegment(value: unknown, field: string): string {
  if (
    typeof value !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
    || value === "."
    || value === ".."
  ) {
    throw new TenantNamespaceError(field);
  }
  return value;
}

export function tenantScopeFromId(tenantId: unknown): TenantId {
  return parseTenantId(tenantId);
}
