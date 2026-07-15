import type { RolePackManifest } from "@axtro/contracts-ts";

import { parseRolePackManifest } from "./manifest.js";

/**
 * Tenant-scoped Role Pack enablement, per docs/architecture/ROLE_AND_SKILL_PACKS.md's
 * install flow: "install disabled -> enable in test tenant -> promote". A
 * pack must be installed (globally known, validated) before any tenant can
 * enable it, and a tenant can disable/remove it independently of every
 * other tenant. This is process-local (no persistence layer exists yet for
 * tenant-level pack enablement) — the same accepted limitation M1 documented
 * for its process-local stores.
 */
export class RolePackRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RolePackRegistryError";
  }
}

const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface TenantRolePackRegistry {
  installPack(manifest: unknown): RolePackManifest;
  isInstalled(rolePackId: unknown): boolean;
  enableForTenant(tenantId: unknown, rolePackId: unknown): void;
  disableForTenant(tenantId: unknown, rolePackId: unknown): void;
  isEnabledForTenant(tenantId: unknown, rolePackId: unknown): boolean;
  listEnabledForTenant(tenantId: unknown): readonly string[];
}

export function createTenantRolePackRegistry(): TenantRolePackRegistry {
  const installed = new Map<string, RolePackManifest>();
  const enabledByTenant = new Map<string, Set<string>>();

  const requireInstalled = (rolePackId: string): RolePackManifest => {
    const manifest = installed.get(rolePackId);
    if (manifest === undefined) throw new RolePackRegistryError(`role pack is not installed: ${rolePackId}`);
    return manifest;
  };

  return Object.freeze({
    installPack(rawManifest: unknown): RolePackManifest {
      const manifest = parseRolePackManifest(rawManifest);
      if (manifest.status === "disabled" || manifest.status === "deprecated") {
        throw new RolePackRegistryError(`cannot install a role pack with status ${manifest.status}`);
      }
      installed.set(manifest.role_pack_id, manifest);
      return manifest;
    },

    isInstalled(rawRolePackId: unknown): boolean {
      return installed.has(parseRolePackId(rawRolePackId));
    },

    enableForTenant(rawTenantId: unknown, rawRolePackId: unknown): void {
      const tenantId = parseTenantId(rawTenantId);
      const rolePackId = parseRolePackId(rawRolePackId);
      requireInstalled(rolePackId);
      const enabled = enabledByTenant.get(tenantId) ?? new Set<string>();
      enabled.add(rolePackId);
      enabledByTenant.set(tenantId, enabled);
    },

    disableForTenant(rawTenantId: unknown, rawRolePackId: unknown): void {
      const tenantId = parseTenantId(rawTenantId);
      const rolePackId = parseRolePackId(rawRolePackId);
      const enabled = enabledByTenant.get(tenantId);
      if (enabled === undefined || !enabled.has(rolePackId)) {
        throw new RolePackRegistryError(`role pack is not enabled for this tenant: ${rolePackId}`);
      }
      enabled.delete(rolePackId);
    },

    isEnabledForTenant(rawTenantId: unknown, rawRolePackId: unknown): boolean {
      const tenantId = parseTenantId(rawTenantId);
      const rolePackId = parseRolePackId(rawRolePackId);
      return enabledByTenant.get(tenantId)?.has(rolePackId) ?? false;
    },

    listEnabledForTenant(rawTenantId: unknown): readonly string[] {
      const tenantId = parseTenantId(rawTenantId);
      return Object.freeze([...(enabledByTenant.get(tenantId) ?? new Set<string>())].sort());
    },
  });
}

function parseTenantId(value: unknown): string {
  if (typeof value !== "string" || !TENANT_ID_PATTERN.test(value)) throw new RolePackRegistryError("invalid tenantId");
  return value;
}

function parseRolePackId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) throw new RolePackRegistryError("invalid role_pack_id");
  return value;
}
