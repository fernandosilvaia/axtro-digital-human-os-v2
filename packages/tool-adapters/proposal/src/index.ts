/**
 * M3-05: generate a proposal preview from confirmed inputs and an approved
 * template, never send it. Every price comes from either a prior receipt or
 * a currently-valid catalog entry — never from unconfirmed model text. This
 * package has no send capability at all (structural, like the CRM-lite and
 * Specialist Fabric "no write/publish surface" pattern).
 */
import { UUID_V7_PATTERN as TENANT_ID_PATTERN } from "@axtro/domain";

export interface ApprovedTemplate {
  readonly templateId: string;
  readonly version: string;
  readonly requiredInputs: readonly string[];
  readonly status: "active" | "deprecated";
}

export interface CatalogEntry {
  readonly productId: string;
  readonly displayName: string;
  readonly unitPriceUsdMicros: number;
  readonly maxDiscountPercent: number;
  readonly validFromMs: number;
  readonly validToMs: number | null;
}

export interface ReceiptPriceReference {
  readonly receiptId: string;
  readonly productId: string;
  readonly unitPriceUsdMicros: number;
}

export interface ProposalCatalog {
  getTemplate(templateId: string): ApprovedTemplate | undefined;
  getCatalogEntry(productId: string): CatalogEntry | undefined;
  getReceipt(receiptId: string): ReceiptPriceReference | undefined;
}

export interface ProposalLineItemInput {
  readonly productId: string;
  readonly quantity: number;
  readonly discountPercent: number;
  readonly receiptId?: string;
}

export interface GenerateProposalRequest {
  readonly tenantId: string;
  readonly requesterActorId: string;
  readonly templateId: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly lineItems: readonly ProposalLineItemInput[];
  readonly atMs: number;
}

export type ProposalGenerationStatus =
  | "preview_ready"
  | "unknown_template"
  | "missing_input"
  | "unknown_product"
  | "stale_catalog"
  | "unauthorized_discount"
  | "unknown_receipt";

export interface ProposalLineItemPreview {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPriceUsdMicros: number;
  readonly discountPercent: number;
  readonly lineTotalUsdMicros: number;
  readonly priceSource: "catalog" | "receipt";
}

export interface ProposalPreview {
  readonly isDryRun: true;
  readonly templateId: string;
  readonly templateVersion: string;
  readonly lineItems: readonly ProposalLineItemPreview[];
  readonly totalUsdMicros: number;
}

export interface GenerateProposalResult {
  readonly status: ProposalGenerationStatus;
  readonly preview: ProposalPreview | null;
  readonly missingInputs: readonly string[];
  readonly rejectedProductIds: readonly string[];
}

export class ProposalAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalAdapterError";
  }
}

export interface ProposalPort {
  generate(rawRequest: unknown): GenerateProposalResult;
}

export function createProposalPort(catalog: ProposalCatalog): ProposalPort {
  return Object.freeze({
    generate(rawRequest: unknown): GenerateProposalResult {
      const request = parseRequest(rawRequest);
      const template = catalog.getTemplate(request.templateId);
      if (template === undefined || template.status !== "active") {
        return rejected("unknown_template", [], []);
      }

      const missingInputs = template.requiredInputs.filter((field) => (request.inputs[field] ?? "").length === 0);
      if (missingInputs.length > 0) return rejected("missing_input", missingInputs, []);

      const lineItems: ProposalLineItemPreview[] = [];
      for (const item of request.lineItems) {
        if (item.receiptId !== undefined) {
          const receipt = catalog.getReceipt(item.receiptId);
          if (receipt === undefined || receipt.productId !== item.productId) return rejected("unknown_receipt", [], [item.productId]);
          const catalogEntry = catalog.getCatalogEntry(item.productId);
          const maxDiscount = catalogEntry?.maxDiscountPercent ?? 0;
          if (item.discountPercent > maxDiscount) return rejected("unauthorized_discount", [], [item.productId]);
          lineItems.push(lineItem(item, receipt.unitPriceUsdMicros, "receipt"));
          continue;
        }
        const catalogEntry = catalog.getCatalogEntry(item.productId);
        if (catalogEntry === undefined) return rejected("unknown_product", [], [item.productId]);
        const isValid = catalogEntry.validFromMs <= request.atMs && (catalogEntry.validToMs === null || request.atMs < catalogEntry.validToMs);
        if (!isValid) return rejected("stale_catalog", [], [item.productId]);
        if (item.discountPercent > catalogEntry.maxDiscountPercent) return rejected("unauthorized_discount", [], [item.productId]);
        lineItems.push(lineItem(item, catalogEntry.unitPriceUsdMicros, "catalog"));
      }

      const totalUsdMicros = lineItems.reduce((sum, item) => sum + item.lineTotalUsdMicros, 0);
      return Object.freeze({
        status: "preview_ready",
        preview: Object.freeze({
          isDryRun: true,
          templateId: template.templateId,
          templateVersion: template.version,
          lineItems: Object.freeze(lineItems),
          totalUsdMicros,
        }),
        missingInputs: Object.freeze([]),
        rejectedProductIds: Object.freeze([]),
      });
    },
  });
}

function lineItem(item: ProposalLineItemInput, unitPriceUsdMicros: number, priceSource: "catalog" | "receipt"): ProposalLineItemPreview {
  const discounted = Math.round(unitPriceUsdMicros * (1 - item.discountPercent / 100));
  return Object.freeze({
    productId: item.productId,
    quantity: item.quantity,
    unitPriceUsdMicros,
    discountPercent: item.discountPercent,
    lineTotalUsdMicros: discounted * item.quantity,
    priceSource,
  });
}

function rejected(status: ProposalGenerationStatus, missingInputs: readonly string[], rejectedProductIds: readonly string[]): GenerateProposalResult {
  return Object.freeze({ status, preview: null, missingInputs: Object.freeze([...missingInputs]), rejectedProductIds: Object.freeze([...rejectedProductIds]) });
}

function parseRequest(value: unknown): GenerateProposalRequest {
  if (value === null || typeof value !== "object") throw new ProposalAdapterError("invalid generate request");
  const record = value as Record<string, unknown>;
  if (typeof record.tenantId !== "string" || !TENANT_ID_PATTERN.test(record.tenantId)) throw new ProposalAdapterError("invalid tenantId");
  if (typeof record.requesterActorId !== "string" || record.requesterActorId.length === 0) throw new ProposalAdapterError("invalid requesterActorId");
  if (typeof record.templateId !== "string" || record.templateId.length === 0) throw new ProposalAdapterError("invalid templateId");
  if (record.inputs === null || typeof record.inputs !== "object" || Array.isArray(record.inputs)) throw new ProposalAdapterError("invalid inputs");
  const inputs: Record<string, string> = {};
  for (const [key, fieldValue] of Object.entries(record.inputs as Record<string, unknown>)) {
    if (typeof fieldValue !== "string") throw new ProposalAdapterError(`invalid inputs.${key}`);
    inputs[key] = fieldValue;
  }
  if (!Array.isArray(record.lineItems) || record.lineItems.length === 0 || record.lineItems.length > 50) {
    throw new ProposalAdapterError("invalid lineItems");
  }
  const lineItems = record.lineItems.map((item, index) => parseLineItem(item, index));
  if (typeof record.atMs !== "number" || !Number.isFinite(record.atMs) || record.atMs < 0) throw new ProposalAdapterError("invalid atMs");
  return Object.freeze({
    tenantId: record.tenantId,
    requesterActorId: record.requesterActorId,
    templateId: record.templateId,
    inputs: Object.freeze(inputs),
    lineItems: Object.freeze(lineItems),
    atMs: record.atMs,
  });
}

function parseLineItem(value: unknown, index: number): ProposalLineItemInput {
  if (value === null || typeof value !== "object") throw new ProposalAdapterError(`invalid lineItems[${index}]`);
  const record = value as Record<string, unknown>;
  if (typeof record.productId !== "string" || record.productId.length === 0) throw new ProposalAdapterError(`invalid lineItems[${index}].productId`);
  if (typeof record.quantity !== "number" || !Number.isSafeInteger(record.quantity) || record.quantity <= 0 || record.quantity > 10_000) {
    throw new ProposalAdapterError(`invalid lineItems[${index}].quantity`);
  }
  if (typeof record.discountPercent !== "number" || !Number.isFinite(record.discountPercent) || record.discountPercent < 0 || record.discountPercent > 100) {
    throw new ProposalAdapterError(`invalid lineItems[${index}].discountPercent`);
  }
  if (record.receiptId !== undefined && (typeof record.receiptId !== "string" || record.receiptId.length === 0)) {
    throw new ProposalAdapterError(`invalid lineItems[${index}].receiptId`);
  }
  return Object.freeze({
    productId: record.productId,
    quantity: record.quantity,
    discountPercent: record.discountPercent,
    ...(record.receiptId === undefined ? {} : { receiptId: record.receiptId as string }),
  });
}
