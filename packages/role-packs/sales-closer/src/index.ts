export {
  ROLE_PACK_ID,
  SALES_CLOSER_MANIFEST,
  RolePackManifestError,
  parseRolePackManifest,
} from "./manifest.js";

export {
  createTenantRolePackRegistry,
  RolePackRegistryError,
  type TenantRolePackRegistry,
} from "./registry.js";

export {
  createInitialSalesState,
  applySalesUpdate,
  FUNNEL_STAGES,
  QUALIFICATION_DIMENSIONS,
  QUALIFICATION_STATUSES,
  OBJECTION_STATUSES,
  PROPOSAL_STATUSES,
  SalesStateError,
  type FunnelStage,
  type QualificationDimension,
  type QualificationStatus,
  type ObjectionStatus,
  type ProposalStatus,
  type SalesQualificationDimension,
  type SalesObjection,
  type SalesStatePayload,
  type SalesStatePatch,
} from "./state.js";
