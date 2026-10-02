import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import OfflineCloserProvider from "../../experiments/closer-lab/provider.js";
import config from "../../experiments/closer-lab/promptfooconfig.js";
import { safeCliEnvironment, syntheticReport } from "../../experiments/closer-lab/run.mjs";
import { projectCloserReceiptEvidence, ReceiptEvidenceError } from "../../packages/evaluation/dist/index.js";
import { receiptInput } from "../../experiments/closer-lab/fixtures.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
test("offline CLI is byte-reproducible, content-free and leaves production blocked", () => {
  const run = () => spawnSync(process.execPath, ["experiments/closer-lab/run.mjs"], { cwd: root, encoding: "utf8", timeout: 10_000, maxBuffer: 64_000 });
  const one = run(), two = run();
  assert.equal(one.status, 0, one.stderr); assert.equal(two.status, 0, two.stderr); assert.equal(one.stdout, two.stdout);
  const report = JSON.parse(one.stdout);
  assert.deepEqual(report, syntheticReport()); assert.equal(report.scenarios.length, 10);
  assert.equal(report.productionPromotionAllowed, false); assert.equal(report.requiresHumanReview, true);
  for (const forbidden of ["result_json", "https://", "contactEmail", "synthetic-participant", "018f1e2d"]) assert.equal(one.stdout.includes(forbidden), false);
});
test("Promptfoo custom provider executes a fixed local scenario, not user claims", async () => {
  const provider = new OfflineCloserProvider();
  assert.equal(provider.id(), "axtro-synthetic-closer");
  const result = await provider.callApi("link-is-not-payment", { vars: { scenarioId: "link-is-not-payment" } });
  const report = JSON.parse(result.output);
  assert.ok(report.scenarios[0].baselineCritical.includes("unsupported_completion:payment_confirmed"));
  await assert.rejects(provider.callApi("invented", { vars: { scenarioId: "invented" } }), /unknown synthetic scenario/);
  await assert.rejects(provider.callApi("lead-receipt", { vars: { scenarioId: "other" } }), /invalid synthetic scenario/);
  await assert.rejects(provider.callApi("x".repeat(101), {}), /invalid synthetic scenario/);
});
test("every fixed Promptfoo case asserts its intended block or human-review result", async () => {
  const provider = new OfflineCloserProvider();
  assert.equal(config.sharing, false);
  for (const entry of config.tests) {
    const result = await provider.callApi(entry.vars.scenarioId, { vars: entry.vars });
    const assertion = new Function("output", "context", entry.assert[0].value);
    assert.equal(assertion(result.output, { vars: entry.vars }), true);
    const wrong = JSON.parse(result.output); wrong.decision = "approved";
    assert.equal(assertion(JSON.stringify(wrong), { vars: entry.vars }), false);
  }
});
test("CLI environment excludes inherited credentials, proxy and code injection options", () => {
  const env = safeCliEnvironment({ PATH: "/synthetic/bin", OPENAI_API_KEY: "synthetic-secret", STRIPE_SECRET_KEY: "synthetic-secret", NODE_OPTIONS: "--import=evil", HTTPS_PROXY: "https://untrusted.example", PROMPTFOO_API_KEY: "synthetic-secret", PROMPTFOO_DISABLE_TELEMETRY: "0" }, "/synthetic/config");
  for (const key of ["OPENAI_API_KEY", "STRIPE_SECRET_KEY", "NODE_OPTIONS", "HTTPS_PROXY", "PROMPTFOO_API_KEY"]) assert.equal(Object.hasOwn(env, key), false);
  assert.equal(env.PROMPTFOO_DISABLE_TELEMETRY, "1"); assert.equal(env.PROMPTFOO_DISABLE_UPDATE, "1"); assert.equal(env.PROMPTFOO_DISABLE_REMOTE_GENERATION, "true");
});
test("guard rejects common trusted-tooling network, subprocess and worker paths", () => {
  const script = `
const paths = [() => fetch('https://synthetic.invalid'), () => require('node:https').request('https://synthetic.invalid'), () => require('node:dns').lookup('synthetic.invalid'), () => require('node:dns').promises.resolve4('synthetic.invalid'), () => new (require('node:dns').Resolver)().resolve4('synthetic.invalid'), () => new (require('node:dns').promises.Resolver)().resolve4('synthetic.invalid'), () => new (require('node:net').Socket)().connect(443, 'synthetic.invalid'), () => require('node:dgram').createSocket('udp4').send('test', 443, 'synthetic.invalid'), () => require('node:http2').connect('https://synthetic.invalid'), () => require('node:child_process').spawn('unused'), () => new (require('node:child_process').ChildProcess)().spawn({file:process.execPath,args:[process.execPath,'-e',''],cwd:process.cwd(),envPairs:[],stdio:'ignore'}), () => new (require('node:worker_threads').Worker)('unused')];
(async () => { for (const invoke of paths) { let denied = false; try { await invoke(); } catch (error) { denied = error.message === 'closer lab network egress prohibited'; } if (!denied) process.exit(1); } })().catch(() => process.exit(1));
`;
  const result = spawnSync(process.execPath, ["--require", "./experiments/closer-lab/deny-network.cjs", "-e", script], { cwd: root, env: safeCliEnvironment({}, "/synthetic/config"), encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
});
test("standalone artifact schema validates report and rejects promotion, raw payload and unbounded data", () => {
  const python = `${root}/.venv/bin/python`;
  assert.ok(existsSync(python), "canonical workspace Python environment required");
  const script = `import json,sys\nfrom jsonschema import Draft202012Validator\nschema=json.load(open('experiments/closer-lab/report.schema.json'))\nDraft202012Validator.check_schema(schema)\nvalue=json.load(sys.stdin)\nDraft202012Validator(schema).validate(value)\n`;
  const check = (report) => spawnSync(python, ["-c", script], { cwd: root, input: JSON.stringify(report), encoding: "utf8", timeout: 5000 });
  const report = syntheticReport(); assert.equal(check(report).status, 0);
  assert.notEqual(check({ ...report, productionPromotionAllowed: true }).status, 0);
  assert.notEqual(check({ ...report, rawReceipt: { contactEmail: "synthetic@example.test" } }).status, 0);
  assert.notEqual(check({ ...report, scenarios: Array(129).fill(report.scenarios[0]) }).status, 0);
  assert.notEqual(check({ ...report, scenarios: [{ ...report.scenarios[0], candidateCritical: ["arbitrary-model-text"] }] }).status, 0);
});
for (const date of ["2026-02-31T08:00:00Z", "2026-13-01T08:00:00Z", "2026-10-01T24:00:00Z", "2026-02-29T08:00:00Z"]) test(`invalid calendar timestamp cannot prove disclosure: ${date}`, () => {
  const input = receiptInput(); input.disclosures[0].delivered_at = date; input.disclosures[0].acknowledged_at = date;
  assert.throws(() => projectCloserReceiptEvidence(input), ReceiptEvidenceError);
});
test("valid leap-day and supported fractional timestamps are accepted", () => {
  const input = receiptInput();
  input.disclosures[0].delivered_at = "2024-02-29T08:00:00.1Z"; input.disclosures[0].acknowledged_at = "2024-02-29T08:01:00.12Z";
  input.consents[0].captured_at = "2024-02-29T08:02:00.123Z";
  assert.deepEqual(projectCloserReceiptEvidence(input).confirmedMilestones, ["lead_registered"]);
});
test("a matching version cannot legalize consent captured before its disclosure", () => {
  const input = receiptInput(); input.consents[0].captured_at = "2026-10-01T07:59:59Z";
  const proof = projectCloserReceiptEvidence(input);
  assert.ok(proof.criticalViolations.includes("missing_essential_consent")); assert.deepEqual(proof.confirmedMilestones, []);
});
test("intent expires at its boundary; start at expiry cannot prove effect", () => {
  const input = receiptInput(); input.intents[0].expires_at = input.receipts[0].started_at;
  assert.ok(projectCloserReceiptEvidence(input).criticalViolations.includes("invalid_effect"));
});
