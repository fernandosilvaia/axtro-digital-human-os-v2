import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(new URL("../../apps/portal/package.json", import.meta.url));
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { estimateCoverageNeed } = await import("../../apps/portal/src/lib/insurance/coverage-need.ts");

const source = await readFile(new URL("../../apps/portal/src/app/(app)/agentes/[id]/testar/coverage-estimate-card.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const exports = {};
new vm.Script(compiled).runInNewContext({ exports, require: (name) => require(name) });
const { CoverageEstimateCard } = exports;

const ESTIMATE = estimateCoverageNeed({ annualIncome: 70_000, yearsOfIncome: 15, mortgageBalance: 280_000, debts: 15_000, existingCoverage: 140_000, liquidSavings: 20_000 });

function render(language, estimate = ESTIMATE) {
  return renderToStaticMarkup(React.createElement(CoverageEstimateCard, { estimate, language }));
}

test("the card shows the whole DIME breakdown the persona spoke about, in the persona's language", () => {
  const english = render("english");
  for (const text of ["Your coverage estimate", "Debts", "$15,000", "Income replacement", "$1,050,000", "Mortgage", "$280,000", "Total need", "$1,345,000", "Existing coverage", "Savings", "Estimated gap", "$1,185,000", "not a quote"]) {
    assert.ok(english.includes(text), `missing ${text}`);
  }
  assert.match(render("spanish"), /Su estimación de cobertura[\s\S]*Brecha estimada[\s\S]*no es una cotización/);
  assert.match(render("portuguese"), /Estimativa de cobertura[\s\S]*Lacuna estimada[\s\S]*não é cotação/);
});

test("deductions read as minus, components at zero are hidden, and the exact gap is shown", () => {
  const english = render("english");
  assert.ok(english.includes("− $140,000") && english.includes("− $20,000"), "true minus sign");
  assert.ok(!english.includes("- $"), "no hyphen that a screen reader reads as dash");
  assert.ok(!english.includes(">Education<") && !english.includes(">Final expenses<"), "zero components are not listed");
  assert.ok(english.includes(">Mortgage<"), "the check above looks at list labels");
  const small = render("english", estimateCoverageNeed({ debts: 100_000, existingCoverage: 98_500 }));
  assert.ok(small.includes("$1,500"), "the exact small gap, never rounded to zero");
  assert.ok(!small.includes("− $0"));
});

test("the title is labelled by a generated id, so two rooms on one page never collide", () => {
  const html = render("english");
  const id = html.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(id, "section has aria-labelledby");
  assert.ok(html.includes(`<h3 id="${id}"`), "points at its own heading");
  assert.notEqual(id, "coverage-estimate-title");
  assert.ok(!html.includes("—"));
});
