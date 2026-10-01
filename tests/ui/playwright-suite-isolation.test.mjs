import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const portal = fileURLToPath(new URL("../../apps/portal/", import.meta.url));
const runtime = join(portal, "node_modules/@playwright/test");
const suites = [
  ["playwright.config.ts", "portal.spec.ts"],
  ["playwright.local.config.ts", "portal-local.spec.ts"],
  ["playwright.public.config.ts", "public-discovery.spec.ts"],
];

for (const [configuration, expectedSpec] of suites) {
  test(`${configuration} discovers only its assigned suite through real Playwright --list`, () => {
    const directory = mkdtempSync(join(tmpdir(), "axtro-playwright-isolation-"));
    try {
      const fixtures = join(directory, "e2e");
      mkdirSync(fixtures);
      // Synthetic discovery fixtures exercise the real configuration while
      // avoiding credential-reading imports and execution of hosted tests.
      for (const [, filename] of suites) {
        writeFileSync(join(fixtures, filename),
          `import { test } from ${JSON.stringify(join(runtime, "index.js"))};\n`
          + `test(${JSON.stringify(filename)}, () => { throw new Error("listing must never execute a test"); });\n`);
      }
      const wrapper = join(directory, "configuration.ts");
      writeFileSync(wrapper,
        `import configuration from ${JSON.stringify(join(portal, configuration))};\n`
        + `export default { ...configuration, testDir: ${JSON.stringify(fixtures)}, `
        + `webServer: { ...configuration.webServer, command: 'node -e "process.exit(97)"' } };\n`);
      const result = spawnSync(process.execPath,
        [join(runtime, "cli.js"), "test", "--config", wrapper, "--list", "--reporter=json"],
        { cwd: portal, encoding: "utf8", timeout: 30_000, env: { ...process.env, CI: "1" } });
      assert.equal(result.error, undefined);
      const report = JSON.parse(result.stdout);
      assert.equal(result.status, 0, JSON.stringify(report.errors));
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.suites.map((suite) => suite.file), [expectedSpec]);
      assert.equal(report.suites[0].specs.length, 1);
      assert.equal(report.suites[0].specs[0].title, expectedSpec);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
