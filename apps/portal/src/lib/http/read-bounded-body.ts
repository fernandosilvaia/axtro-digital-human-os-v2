export type BoundedBodyResult =
  | { readonly ok: true; readonly text: string; readonly bytes: number }
  | { readonly ok: false; readonly reason: "invalid_content_length" | "too_large" | "read_failed" };

/**
 * Reads an HTTP body without ever buffering more than `maxBytes`.
 *
 * `Content-Length` is checked before the stream is acquired, so an explicit
 * oversized request is rejected without allocating its body. Chunked bodies
 * remain bounded by counting bytes before decoding. The returned string is
 * the exact UTF-8 representation used by webhook HMAC/digest verification.
 */
export async function readBoundedTextBody(
  request: Pick<Request, "headers" | "body">,
  maxBytes: number,
): Promise<BoundedBodyResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(declaredLength)) {
      return { ok: false, reason: "invalid_content_length" };
    }
    if (BigInt(declaredLength) > BigInt(maxBytes)) {
      return { ok: false, reason: "too_large" };
    }
  }

  if (request.body === null) return { ok: true, text: "", bytes: 0 };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel("request body exceeds configured limit").catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { ok: true, text: parts.join(""), bytes };
  } catch {
    await reader.cancel("request body read failed").catch(() => undefined);
    return { ok: false, reason: "read_failed" };
  } finally {
    reader.releaseLock();
  }
}
