import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const expectedScripts = ["lint", "typecheck", "test", "build"];

test("root exposes canonical workspace scripts", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const script of expectedScripts) {
    assert.equal(typeof manifest.scripts[script], "string", `missing ${script} script`);
  }
});

test("domain package stays provider SDK free", () => {
  const manifest = readFileSync(join(root, "packages/domain/package.json"), "utf8").toLowerCase();
  for (const token of ["openai", "livekit", "tavus", "heygen", "telnyx", "recall"]) {
    assert.equal(manifest.includes(token), false, `domain declares provider dependency: ${token}`);
  }
  assert.equal(existsSync(join(root, "packages/domain/src/index.ts")), true);
});
