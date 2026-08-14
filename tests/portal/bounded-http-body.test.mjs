import assert from "node:assert/strict";
import { test } from "node:test";

import { readBoundedTextBody } from "../../apps/portal/src/lib/http/read-bounded-body.ts";

test("rejects oversized Content-Length before acquiring the request stream", async () => {
  let bodyTouched = false;
  const request = {
    headers: new Headers({ "content-length": "101" }),
    get body() { bodyTouched = true; throw new Error("must not be acquired"); },
  };
  assert.deepEqual(await readBoundedTextBody(request, 100), { ok: false, reason: "too_large" });
  assert.equal(bodyTouched, false);
});

test("bounds chunked bodies by bytes and cancels before buffering the overflow", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(6));
      controller.enqueue(new Uint8Array(6));
    },
    cancel() { cancelled = true; },
  });
  assert.deepEqual(await readBoundedTextBody({ headers: new Headers(), body: stream }, 10), { ok: false, reason: "too_large" });
  assert.equal(cancelled, true);
});

test("preserves UTF-8 across chunk boundaries and reports exact byte length", async () => {
  const encoded = new TextEncoder().encode("áudio");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded.slice(0, 1));
      controller.enqueue(encoded.slice(1, 3));
      controller.enqueue(encoded.slice(3));
      controller.close();
    },
  });
  assert.deepEqual(await readBoundedTextBody({ headers: new Headers(), body: stream }, 32), {
    ok: true,
    text: "áudio",
    bytes: encoded.byteLength,
  });
});

test("rejects non-canonical Content-Length values", async () => {
  const request = { headers: new Headers({ "content-length": "+2" }), body: new Response("{}").body };
  assert.deepEqual(await readBoundedTextBody(request, 10), { ok: false, reason: "invalid_content_length" });
});
