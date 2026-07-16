import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const violations = [];
const prohibitedProviderTokens = [
  "@openai/",
  "openai",
  "livekit",
  "tavus",
  "heygen",
  "telnyx",
  "recall.ai",
];

function walk(directory) {
  if (!statSync(directory).isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if ([".git", ".pnpm-store", ".uv-cache", ".venv", ".next", "dist", "node_modules"].includes(entry.name)) {
      return [];
    }
    if (entry.isDirectory()) return walk(path);
    return [path];
  });
}

for (const file of walk(join(root, "packages", "domain"))) {
  if (!/\.(ts|tsx|mts|cts|json)$/.test(file)) continue;
  const content = readFileSync(file, "utf8").toLowerCase();
  for (const token of prohibitedProviderTokens) {
    if (content.includes(token)) {
      violations.push(`${relative(root, file)} imports or declares provider token ${token}`);
    }
  }
}

for (const file of walk(root)) {
  if (!/\.(ts|mjs|py|json|ya?ml)$/.test(file)) continue;
  const content = readFileSync(file, "utf8");
  if (/[\t ]+$/m.test(content)) {
    violations.push(`${relative(root, file)} has trailing whitespace`);
  }
}

if (violations.length > 0) {
  console.error("LINT FAILED");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("LINT PASSED: workspace boundaries and whitespace are clean");
