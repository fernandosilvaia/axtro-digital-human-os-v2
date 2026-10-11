import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = await import("../../scripts/provision-tavus-brain-persona.mjs");

const AGENT_ID = "019f6de0-0000-7000-8000-0000000a0001";
const BASE_ARGS = [
  "--dry-run",
  "--name=Priscila, Life Insurance",
  "--replica-id=r862e3a3c5e0",
  `--agent-id=${AGENT_ID}`,
  "--portal-url=https://closer.axtroai.com",
  "--language=english",
];

test("the persona points its LLM layer at the agent's brain base URL, never at a full endpoint", () => {
  const args = script.parseArgs(BASE_ARGS);
  const payload = script.buildPersonaPayload(args, { brainApiKey: "brain-secret", elevenLabsApiKey: "", elevenLabsVoiceId: "" });
  assert.equal(payload.layers.llm.base_url, `https://closer.axtroai.com/api/brain/${AGENT_ID}`);
  assert.ok(!payload.layers.llm.base_url.endsWith("/chat/completions"), "Tavus appends /chat/completions itself");
  assert.equal(payload.layers.llm.api_key, "brain-secret");
  assert.equal(payload.default_replica_id, "r862e3a3c5e0");
  assert.equal(payload.layers.stt.smart_turn_detection, true);
  assert.ok(payload.layers.perception.ambient_awareness_queries.length >= 4);
  assert.equal(payload.layers.tts, undefined, "no custom voice unless both ElevenLabs variables are set");
  // The provider-side prompt is only a floor: the brain composes the reviewed doctrine.
  assert.ok(payload.system_prompt.length < 300);
});

test("dry-run output never contains a secret", () => {
  const args = script.parseArgs(BASE_ARGS);
  const payload = script.buildPersonaPayload(args, { brainApiKey: "brain-secret", elevenLabsApiKey: "eleven-secret", elevenLabsVoiceId: "voice123" });
  const printed = JSON.stringify(script.redact(payload));
  assert.ok(!printed.includes("brain-secret"));
  assert.ok(!printed.includes("eleven-secret"));
  assert.match(printed, /\[redacted\]/);
  assert.match(printed, /voice123/);
});

test("arguments fail closed before anything is sent", () => {
  const without = (prefix) => BASE_ARGS.filter((arg) => !arg.startsWith(prefix));
  assert.throws(() => script.parseArgs([]), /Choose a mode/);
  assert.throws(() => script.parseArgs(["--dry-run", "--create"]), /exactly one mode/);
  assert.throws(() => script.parseArgs(without("--agent-id").concat("--agent-id=not-a-uuid")), /agent-id/);
  assert.throws(() => script.parseArgs(without("--replica-id").concat("--replica-id=../../personas")), /replica-id/);
  assert.throws(() => script.parseArgs(without("--portal-url").concat("--portal-url=http://closer.axtroai.com")), /https origin/);
  assert.throws(() => script.parseArgs(without("--portal-url").concat("--portal-url=https://closer.axtroai.com/api")), /bare https origin/);
  assert.throws(() => script.parseArgs(without("--language").concat("--language=klingon")), /language/);
  assert.equal(script.parseArgs(["--list-replicas"]).mode, "list-replicas");
});

test("creation requires an exact confirmation value, never a boolean flag", () => {
  const source = readFileSync(new URL("../../scripts/provision-tavus-brain-persona.mjs", import.meta.url), "utf8");
  assert.match(source, /TAVUS_BRAIN_PERSONA_PROVISION_CONFIRM/);
  assert.match(source, /REQUIRED_CONFIRM_VALUE = "create-brain-persona"/);
  assert.doesNotMatch(source, /—/);
});
