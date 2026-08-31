import assert from "node:assert/strict";
import test from "node:test";

import {
  isSameOriginPublicDemoMutationRequest,
  PUBLIC_DEMO_MAX_COMMAND_BODY_BYTES,
  readBoundedPublicDemoCommand,
} from "../../apps/portal/src/lib/public-demo/request.ts";

function request(path, options = {}) {
  return new Request(`https://closer.axtroai.com${path}`, options);
}

test("public demo mutation requests require an exact same-origin Origin", () => {
  assert.equal(isSameOriginPublicDemoMutationRequest(request("/demo/start", {
    method: "POST",
    headers: { origin: "https://closer.axtroai.com" },
  })), true);

  for (const origin of [
    undefined,
    "https://evil.example",
    "https://closer.axtroai.com.evil.example",
    "http://closer.axtroai.com",
    "not-a-url",
  ]) {
    const headers = origin === undefined ? undefined : { origin };
    assert.equal(isSameOriginPublicDemoMutationRequest(request("/demo/start", {
      method: "POST",
      headers,
    })), false, String(origin));
  }
});

test("public demo command parser accepts only bounded UTF-8 JSON", async () => {
  const command = {
    schema_version: "2.0.0",
    command_id: "019f0000-0000-7000-8000-000000000001",
    expected_revision: 0,
    command: "advance",
  };
  assert.deepEqual(await readBoundedPublicDemoCommand(request("/demo/command", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(command),
  })), command);

  for (const candidate of [
    request("/demo/command", { method: "POST", body: JSON.stringify(command) }),
    request("/demo/command", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(command),
    }),
    request("/demo/command", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(PUBLIC_DEMO_MAX_COMMAND_BODY_BYTES + 1),
      },
      body: "{}",
    }),
    request("/demo/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }),
    request("/demo/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(PUBLIC_DEMO_MAX_COMMAND_BODY_BYTES) }),
    }),
    request("/demo/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array([0xff]),
    }),
  ]) {
    assert.equal(await readBoundedPublicDemoCommand(candidate), null);
  }
});
