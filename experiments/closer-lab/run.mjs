import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareCloserCandidates } from "../../packages/evaluation/dist/index.js";
import { buildCorpus } from "./fixtures.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));
export function safeCliEnvironment(source = process.env, configDirectory) {
  // Explicit allowlist. No provider credentials, NODE_OPTIONS, proxy, cloud config,
  // arbitrary env-file or parent feature flag is inherited by the child CLI.
  return { PATH: source.PATH ?? "", TZ: "UTC", LANG: "C", CI: "true", TERM: "dumb",
    PROMPTFOO_DISABLE_TELEMETRY: "1", PROMPTFOO_DISABLE_SHARING: "1", PROMPTFOO_DISABLE_UPDATE: "1",
    PROMPTFOO_DISABLE_REMOTE_GENERATION: "true", PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION: "true",
    PROMPTFOO_CONFIG_DIR: configDirectory };
}
export function runOfflinePromptfoo() {
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const installedPath = join(directory, "node_modules/promptfoo/package.json");
  if (!existsSync(installedPath)) throw new Error("isolated Promptfoo not installed; use documented scripts-disabled installation");
  const installed = JSON.parse(readFileSync(installedPath, "utf8"));
  if (installed.version !== manifest.devDependencies.promptfoo) throw new Error("isolated Promptfoo version mismatch");
  const addonDirectory = join(directory, "node_modules/better-sqlite3");
  const compiled = join(addonDirectory, "build/Release/better_sqlite3.node");
  const packaged = join(addonDirectory, "prebuilds", `${process.platform}-${process.arch}.node`);
  if (!existsSync(compiled) || statSync(compiled).size > 64_000_000) throw new Error("explicit local SQLite source build required; see lab README");
  // This version prefers the packaged prebuild. Require removal or replacement
  // by the explicit local compilation, rather than silently running that binary.
  const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  if (existsSync(packaged) && digest(compiled) !== digest(packaged)) throw new Error("SQLite packaged prebuild differs from local source build; see lab README");
  const temporary = mkdtempSync(join(tmpdir(), "axtro-closer-lab-"));
  try {
    const output = join(temporary, "result.json");
    const result = spawnSync(process.execPath, ["--require", join(directory, "deny-network.cjs"), join(directory, "node_modules/promptfoo/dist/src/main.js"),
      "eval", "--config", join(directory, "promptfooconfig.js"), "--no-cache", "--no-write", "--no-table", "--no-progress-bar", "--max-concurrency", "1", "--output", output],
    { cwd: directory, env: safeCliEnvironment(process.env, join(temporary, "config")), timeout: 60_000, maxBuffer: 64_000, encoding: "utf8" });
    if (result.error || result.signal || result.status !== 0 || !existsSync(output)) throw new Error("offline Promptfoo CLI failed or timed out");
    if (statSync(output).size > 8_000_000) throw new Error("offline Promptfoo output exceeded limit");
    const data = JSON.parse(readFileSync(output, "utf8"));
    const stats = data.results?.stats;
    if (stats?.successes !== 10 || stats?.failures !== 0 || (stats?.errors ?? 0) !== 0) throw new Error("offline Promptfoo assertions did not all pass");
    return Object.freeze({ version: installed.version, assertionsPassed: 10, guardedTrustedTooling: true, externalProvidersConfigured: false });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

export function syntheticReport() { return compareCloserCandidates(buildCorpus()); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--promptfoo")) throw new Error("usage: node run.mjs [--promptfoo]");
    if (args[0] === "--promptfoo") {
      const result = runOfflinePromptfoo();
      process.stderr.write(`Promptfoo ${result.version}: ${result.assertionsPassed} offline assertions passed; trusted tooling network guard enabled.\n`);
    }
    process.stdout.write(`${JSON.stringify(syntheticReport(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "offline lab failed"}\n`); process.exitCode = 1;
  }
}
