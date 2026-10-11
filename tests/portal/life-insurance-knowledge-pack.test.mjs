import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const knowledge = await import("../../apps/portal/src/lib/knowledge.ts");
const sentinel = await import("../../apps/portal/src/lib/brain/compliance-sentinel.ts");

const directory = new URL("../../knowledge/life-insurance/priscila/", import.meta.url);
const files = readdirSync(directory).filter((name) => name.endsWith(".md")).sort();

function read(name) {
  return readFileSync(new URL(name, directory), "utf8").trim();
}

test("the pack covers every product family Priscila talks about, in priority order", () => {
  assert.ok(files.length >= 13, `expected the full pack, found ${files.length}`);
  for (const [index, name] of files.entries()) {
    assert.match(name, /^\d{2}-[a-z0-9-]+\.md$/, `${name} needs a two digit priority prefix`);
    assert.equal(Number(name.slice(0, 2)), index + 1, `${name} breaks the contiguous priority order`);
  }
  const corpus = files.map(read).join("\n").toLowerCase();
  for (const topic of ["final expense", "term", "whole life", "guaranteed universal life", "indexed universal life", "annuit", "kai-zen", "living benefits", "1035", "key person", "best interest", "glossary"]) {
    assert.ok(corpus.includes(topic), `the pack does not cover: ${topic}`);
  }
});

test("each file fits one paid ingestion without crossing the reservation envelope", () => {
  for (const name of files) {
    const chunks = knowledge.chunkContent(read(name));
    assert.doesNotThrow(() => knowledge.assertKnowledgeChunksDispatchable(chunks), name);
    assert.doesNotThrow(() => knowledge.assertEmbeddingInputsWithinReservedBudget(chunks, 20_000), name);
  }
});

test("the pack has no em dash and no sentence the compliance sentinel would block", () => {
  for (const name of files) {
    let text = read(name);
    assert.ok(!text.includes("—"), `${name} contains an em dash`);
    // The glossary lists the forbidden words on purpose, so the closer recognizes them.
    if (name.includes("glossary")) text = text.split("## Words to avoid")[0];
    for (const line of text.split("\n")) {
      const result = sentinel.enforceLifeInsuranceCompliance(line, "english");
      assert.deepEqual(result.violations, [], `${name}: "${line}" would be blocked by the sentinel`);
    }
  }
});
