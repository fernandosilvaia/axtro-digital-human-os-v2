import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../../apps/portal/src/proxy.ts", import.meta.url),
  "utf8",
);

function loadProxy() {
  const calls = [];
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "proxy.ts",
  }).outputText;
  const module = { exports: {} };
  const mocks = new Map([
    ["next/server", {
      NextResponse: {
        next() {
          return { boundary: "public" };
        },
      },
    }],
    ["@/lib/supabase/middleware", {
      async updateSession(request) {
        calls.push(request.nextUrl.pathname);
        return { boundary: "authenticated" };
      },
    }],
  ]);
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`);
  wrapper.runInNewContext()(
    (specifier) => {
      const resolved = mocks.get(specifier);
      if (resolved === undefined) throw new Error(`Unexpected proxy import: ${specifier}`);
      return resolved;
    },
    module,
    module.exports,
  );
  return { proxy: module.exports.proxy, calls };
}

test("proxy executes the public bypass only for the exact demo route tree", async () => {
  const { proxy, calls } = loadProxy();
  for (const pathname of ["/", "/demo", "/demo/guide"]) {
    assert.deepEqual(await proxy({ nextUrl: { pathname } }), { boundary: "public" });
  }
  assert.deepEqual(calls, []);

  for (const pathname of [
    "/dashboard",
    "/demolition",
    "/demo.evil",
    "/demographic",
    "/demo%2Fguide",
  ]) {
    assert.deepEqual(await proxy({ nextUrl: { pathname } }), { boundary: "authenticated" });
  }
  assert.deepEqual(calls, [
    "/dashboard",
    "/demolition",
    "/demo.evil",
    "/demographic",
    "/demo%2Fguide",
  ]);
});
