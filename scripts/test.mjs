import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

function findTests(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTests(path);
    return entry.name.endsWith(".test.mjs") ? [path] : [];
  });
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const nodeTests = findTests(join(root, "tests"));
if (nodeTests.length > 0) run(process.execPath, ["--test", ...nodeTests]);
if (existsSync(join(root, "tests", "python"))) {
  const workspacePython = join(root, ".venv", "bin", "python");
  run(
    process.env.PYTHON ?? (existsSync(workspacePython) ? workspacePython : "python3"),
    ["-m", "unittest", "discover", "-s", "tests/python", "-p", "test_*.py"],
  );
}

console.log("TEST SUITE PASSED");
