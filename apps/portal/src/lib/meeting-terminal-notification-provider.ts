import { createHash } from "node:crypto";

const RESEND_ENDPOINT = "https://api.resend.com/emails/batch";
const FROM = "Axtro Digital Human OS <no-reply@axtroai.com>";
const PROVIDER_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const PROVIDER_RECEIPT_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export type MeetingTerminalNotificationProviderFailureCode =
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_timeout"
  | "transport_unknown"
  | "payload_invalid"
  | "recipient_invalid"
  | "provider_rejected"
  | "provider_not_configured"
  | "provider_receipt_invalid"
  | "idempotency_conflict";

export type MeetingTerminalNotificationProviderResult =
  | { readonly outcome: "provider_accepted"; readonly providerReceiptRef: string }
  | { readonly outcome: "simulated"; readonly providerReceiptRef: string }
  | {
      readonly outcome: "retryable_failure";
      readonly failureCode: MeetingTerminalNotificationProviderFailureCode;
      readonly retryAfterSeconds: number | null;
    }
  | { readonly outcome: "permanent_failure"; readonly failureCode: MeetingTerminalNotificationProviderFailureCode }
  | { readonly outcome: "provider_ambiguous"; readonly failureCode: MeetingTerminalNotificationProviderFailureCode };

export interface SendMeetingTerminalNotificationProviderInput {
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  readonly idempotencyKey: string;
}

export interface MeetingTerminalNotificationProviderDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetchImplementation?: typeof fetch;
}

export function isMeetingTerminalNotificationProviderConfigured(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if ((env.PORTAL_FAKE_PROVIDERS ?? "").trim() === "1") return true;
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  return apiKey.length >= 8 && !/\s/.test(apiKey);
}

async function readBoundedResponseText(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("provider_response_too_large");
    }
    text += decoder.decode(value, { stream: true });
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(3600, Math.max(5, Math.ceil(seconds)));
}

function parseProviderErrorName(text: string): string | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const name = (value as { readonly name?: unknown }).name;
    return typeof name === "string" && name.length <= 100 ? name : null;
  } catch {
    return null;
  }
}

function validInput(input: SendMeetingTerminalNotificationProviderInput): boolean {
  if (input.to.length < 1 || input.to.length > 50) return false;
  if (Array.from(input.subject).length < 1 || Array.from(input.subject).length > 200) return false;
  if (Array.from(input.html).length < 1 || Array.from(input.html).length > 20_000) return false;
  if (Array.from(input.idempotencyKey).length < 1 || Array.from(input.idempotencyKey).length > 256) return false;
  const seen = new Set<string>();
  for (const email of input.to) {
    if (
      email !== email.trim().toLowerCase()
      || Array.from(email).length < 3
      || Array.from(email).length > 320
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || seen.has(email)
    ) return false;
    seen.add(email);
  }
  return true;
}

function simulatedReceipt(input: SendMeetingTerminalNotificationProviderInput): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ from: FROM, to: input.to, subject: input.subject, html: input.html, idempotencyKey: input.idempotencyKey }), "utf8")
    .digest("hex");
  return `simulated_${digest}`;
}

function parseBatchReceipt(text: string, expectedCount: number): string | null {
  try {
    const body = JSON.parse(text) as unknown;
    if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
    const data = (body as { readonly data?: unknown }).data;
    if (!Array.isArray(data) || data.length !== expectedCount) return null;
    const ids: string[] = [];
    for (const item of data) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
      const id = (item as { readonly id?: unknown }).id;
      if (typeof id !== "string" || !PROVIDER_RECEIPT_PATTERN.test(id)) return null;
      ids.push(id);
    }
    if (new Set(ids).size !== ids.length) return null;
    const digest = createHash("sha256")
      .update(ids.map((id) => `${id.length}:${id};`).join(""), "utf8")
      .digest("hex");
    return `batch_${digest}`;
  } catch {
    return null;
  }
}

/** One provider call per lease. Retry and settlement belong to the durable worker. */
export async function sendMeetingTerminalNotificationProvider(
  input: SendMeetingTerminalNotificationProviderInput,
  dependencies: MeetingTerminalNotificationProviderDependencies = {},
): Promise<MeetingTerminalNotificationProviderResult> {
  if (!validInput(input)) {
    return { outcome: "permanent_failure", failureCode: "payload_invalid" };
  }
  const env = dependencies.env ?? process.env;
  if ((env.PORTAL_FAKE_PROVIDERS ?? "").trim() === "1") {
    return { outcome: "simulated", providerReceiptRef: simulatedReceipt(input) };
  }
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  if (!isMeetingTerminalNotificationProviderConfigured(env)) {
    return {
      outcome: "retryable_failure",
      failureCode: "provider_not_configured",
      retryAfterSeconds: 60,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await (dependencies.fetchImplementation ?? fetch)(RESEND_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify(input.to.map((recipient) => ({
        from: FROM,
        to: [recipient],
        subject: input.subject,
        html: input.html,
      }))),
    });
    let text: string;
    try {
      text = await readBoundedResponseText(response);
    } catch {
      return { outcome: "provider_ambiguous", failureCode: "provider_receipt_invalid" };
    }

    if (response.ok) {
      const batchReceipt = parseBatchReceipt(text, input.to.length);
      if (batchReceipt !== null) {
        return { outcome: "provider_accepted", providerReceiptRef: batchReceipt };
      }
      return { outcome: "provider_ambiguous", failureCode: "provider_receipt_invalid" };
    }

    const providerErrorName = parseProviderErrorName(text);
    if (response.status === 409 && providerErrorName === "concurrent_idempotent_requests") {
      return { outcome: "retryable_failure", failureCode: "provider_unavailable", retryAfterSeconds: 5 };
    }
    if (response.status === 409) {
      return { outcome: "permanent_failure", failureCode: "idempotency_conflict" };
    }
    if (response.status === 429) {
      return {
        outcome: "retryable_failure",
        failureCode: "provider_rate_limited",
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      };
    }
    if (response.status === 408 || response.status === 425 || response.status >= 500) {
      return { outcome: "retryable_failure", failureCode: "provider_unavailable", retryAfterSeconds: null };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        outcome: "retryable_failure",
        failureCode: "provider_not_configured",
        retryAfterSeconds: 60,
      };
    }
    if (response.status === 400 || response.status === 422) {
      return { outcome: "permanent_failure", failureCode: "payload_invalid" };
    }
    return { outcome: "permanent_failure", failureCode: "provider_rejected" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { outcome: "provider_ambiguous", failureCode: "provider_timeout" };
    }
    return { outcome: "provider_ambiguous", failureCode: "transport_unknown" };
  } finally {
    clearTimeout(timer);
  }
}
