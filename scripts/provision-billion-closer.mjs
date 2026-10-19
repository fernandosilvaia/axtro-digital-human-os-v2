#!/usr/bin/env node
// scripts/provision-billion-closer.mjs
//
// MANUAL-ONLY, ACCOUNT-CONFIGURATION SCRIPT. Provisions the Billion Leads Pro closer (ADR-051) end to
// end, in order, idempotently. Never wire it into CI, cron or a package.json alias: it creates a Tavus
// persona on the real account and writes secrets to Railway and to the CRM's Supabase project.
//
// It handles every secret itself and never prints one: output is ids and step names only.
//
//   railway run --service portal -- node scripts/provision-billion-closer.mjs --dry-run --secrets-file=<path>
//   railway run --service portal -- node scripts/provision-billion-closer.mjs --apply   --secrets-file=<path> --replica-id=r378d159c7b0
//
// Secrets file: JSON, mode 0600, outside the repository. It must already hold { tenantId, opsEmail,
// opsPassword } (the machine user and tenant of the Billion closer) and the script fills in the rest
// (brainSecret, serviceSecret, admissionKey, agentId, personaId) the first time it runs.
//
// Steps (select with --only=a,b,c; default is all, in this order):
//   agent    create the agent as the machine user, rotate and enable its brain secret
//   env      set BILLION_CLOSER_* and BRAIN_VERTICAL_OVERRIDES on the Railway portal service (no deploy)
//   crm      set BILLION_CLOSER_PORTAL_URL and BILLION_CLOSER_SERVICE_SECRET on the CRM Supabase project
//   ingest   ingest knowledge/billion-leads-pro into the Billion tenant (costs embeddings, cents)
//   voice    add the approved ElevenLabs shared voice to the account library
//   persona  create the Tavus persona that uses our brain endpoint and the voice
//
// Environment (injected by `railway run`): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
// TAVUS_API_KEY, ELEVENLABS_API_KEY, OPENROUTER_API_KEY. The Supabase CLI and the Railway CLI must be logged in.
//
// Out of scope on purpose: binding the persona and replica to the agent (a governed database-operator
// step, printed at the end), activating the agent, and BILLION_CLOSER_ENABLED (set only after the paid test).

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const PORTAL_URL = "https://portal-production-b43e.up.railway.app";
const CRM_SUPABASE_REF = "yvoyqcxvzqqenvbmojur";
const VOICE_ID = "Fy0y2P2qP6NrsDcvbxmJ";
const VOICE_NAME = "Thayane - Northern Brazilian accent";
const STEPS = ["agent", "env", "crm", "ingest", "voice", "persona"];

class UsageError extends Error {}

function parseArgs(argv) {
  const args = { mode: null, secretsFile: null, replicaId: null, name: "Bia", only: STEPS };
  for (const arg of argv) {
    if (arg === "--dry-run") args.mode = "dry-run";
    else if (arg === "--apply") args.mode = "apply";
    else if (arg.startsWith("--secrets-file=")) args.secretsFile = arg.slice("--secrets-file=".length);
    else if (arg.startsWith("--replica-id=")) args.replicaId = arg.slice("--replica-id=".length);
    else if (arg.startsWith("--name=")) args.name = arg.slice("--name=".length);
    else if (arg.startsWith("--only=")) args.only = arg.slice("--only=".length).split(",");
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  if (args.mode === null) throw new UsageError("pass --dry-run or --apply");
  if (args.secretsFile === null || !existsSync(args.secretsFile)) throw new UsageError("--secrets-file must point to an existing file");
  if (args.only.some((step) => !STEPS.includes(step))) throw new UsageError(`--only accepts: ${STEPS.join(", ")}`);
  if (args.name.length < 1 || args.name.length > 60) throw new UsageError("--name must be 1 to 60 characters");
  if (args.only.includes("persona") && args.mode === "apply" && !/^r[a-z0-9]{8,64}$/i.test(args.replicaId ?? "")) {
    throw new UsageError("--replica-id=rXXXX is required for the persona step");
  }
  return args;
}

function readSecrets(file) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const key of ["tenantId", "opsEmail", "opsPassword"]) {
    if (typeof data[key] !== "string" || data[key].length === 0) throw new UsageError(`secrets file is missing ${key}`);
  }
  return data;
}

function saveSecrets(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2));
  chmodSync(file, 0o600);
}

function requireEnv(names) {
  const missing = names.filter((name) => (process.env[name] ?? "").trim().length === 0);
  if (missing.length > 0) throw new UsageError(`missing environment: ${missing.join(", ")} (run through \`railway run --service portal --\`)`);
}

async function opsSession(secrets) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: secrets.opsEmail, password: secrets.opsPassword }),
  });
  if (!response.ok) throw new Error(`machine user sign-in failed (${response.status})`);
  return (await response.json()).access_token;
}

async function rpc(token, name, body) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed (${response.status}): ${text.slice(0, 160)}`);
  return text.length > 0 ? JSON.parse(text) : null;
}

async function stepAgent(args, secrets, apply) {
  const { createUuidV7 } = await import(new URL("../packages/domain/dist/index.js", import.meta.url));
  const { createHash, randomBytes } = await import("node:crypto");
  console.log(`[agent] tenant ${secrets.tenantId}, name "${args.name}"`);
  if (!apply) return console.log("[agent] dry-run: would create the agent, rotate and enable the brain secret");
  const token = await opsSession(secrets);
  const listed = await rpc(token, "portal_list_agents", {});
  const existing = Array.isArray(listed) ? listed.find((agent) => agent.id === secrets.agentId) : undefined;
  if (existing === undefined) {
    secrets.agentId ??= createUuidV7();
    await rpc(token, "portal_create_agent", { p_id: secrets.agentId, p_name: args.name, p_role_type: "sales" });
    console.log(`[agent] created ${secrets.agentId}`);
  } else {
    console.log(`[agent] already exists ${secrets.agentId}`);
  }
  secrets.brainSecret ??= randomBytes(32).toString("hex");
  saveSecrets(args.secretsFile, secrets);
  await rpc(token, "portal_rotate_agent_brain_secret", { p_agent_id: secrets.agentId, p_secret_hash: createHash("sha256").update(secrets.brainSecret, "utf8").digest("hex") });
  await rpc(token, "portal_set_agent_brain_enabled", { p_agent_id: secrets.agentId, p_enabled: true });
  console.log("[agent] brain secret rotated and enabled (value not shown)");
}

function runCli(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", cwd: repositoryRoot, ...options });
  if (result.status !== 0) throw new Error(`${command} ${commandArgs[0] ?? ""} failed: ${(result.stderr ?? "").trim().slice(0, 200)}`);
  return result.stdout ?? "";
}

function railwaySet(key, value) {
  runCli("railway", ["variable", "set", "--service", "portal", "--skip-deploys", key, "--stdin"], { input: value });
  console.log(`[env] ${key} set`);
}

async function stepEnv(args, secrets, apply) {
  for (const key of ["serviceSecret", "admissionKey"]) {
    if (typeof secrets[key] !== "string" || secrets[key].length < 32) throw new UsageError(`secrets file is missing ${key}`);
  }
  if (!apply) return console.log("[env] dry-run: would set BILLION_CLOSER_SERVICE_SECRET, BILLION_CLOSER_ADMISSION_KEY, BILLION_CLOSER_AGENT_ID, BRAIN_VERTICAL_OVERRIDES");
  if (typeof secrets.agentId !== "string") throw new UsageError("run the agent step first (no agentId in the secrets file)");
  let overrides = {};
  try {
    overrides = JSON.parse(process.env.BRAIN_VERTICAL_OVERRIDES ?? "{}");
  } catch {
    throw new Error("the current BRAIN_VERTICAL_OVERRIDES is not valid JSON, refusing to overwrite it");
  }
  overrides[secrets.agentId] = "billion_leads_sales";
  railwaySet("BILLION_CLOSER_SERVICE_SECRET", secrets.serviceSecret);
  railwaySet("BILLION_CLOSER_ADMISSION_KEY", secrets.admissionKey);
  railwaySet("BILLION_CLOSER_AGENT_ID", secrets.agentId);
  railwaySet("BRAIN_VERTICAL_OVERRIDES", JSON.stringify(overrides));
  console.log("[env] BILLION_CLOSER_ENABLED was NOT set. Deploy (`railway up`) to apply these.");
}

async function stepCrm(args, secrets, apply) {
  if (typeof secrets.serviceSecret !== "string") throw new UsageError("secrets file is missing serviceSecret");
  if (!apply) return console.log(`[crm] dry-run: would set the portal URL and the service secret on Supabase project ${CRM_SUPABASE_REF}`);
  const envFile = join(tmpdir(), `billion-closer-crm-${process.pid}.env`);
  writeFileSync(envFile, `BILLION_CLOSER_PORTAL_URL=${PORTAL_URL}\nBILLION_CLOSER_SERVICE_SECRET=${secrets.serviceSecret}\n`);
  chmodSync(envFile, 0o600);
  try {
    runCli("supabase", ["secrets", "set", "--project-ref", CRM_SUPABASE_REF, "--env-file", envFile]);
  } finally {
    rmSync(envFile, { force: true });
  }
  console.log("[crm] BILLION_CLOSER_PORTAL_URL and BILLION_CLOSER_SERVICE_SECRET set on the CRM project");
}

async function stepIngest(args, secrets, apply) {
  const mode = apply ? "--apply" : "--dry-run";
  console.log(`[ingest] knowledge/billion-leads-pro ${mode} as the machine user of tenant ${secrets.tenantId}`);
  const output = runCli("node", ["scripts/ingest-knowledge-bulk.mjs", "knowledge/billion-leads-pro", mode], {
    env: { ...process.env, DEMO_EMAIL: secrets.opsEmail, DEMO_PASSWORD: secrets.opsPassword },
  });
  console.log(output.split("\n").slice(-12).join("\n"));
}

async function stepVoice(args, secrets, apply) {
  const key = process.env.ELEVENLABS_API_KEY;
  const headers = { "xi-api-key": key };
  const mine = await (await fetch("https://api.elevenlabs.io/v1/voices", { headers })).json();
  if ((mine.voices ?? []).some((voice) => voice.voice_id === VOICE_ID)) return console.log(`[voice] ${VOICE_ID} is already in the library`);
  const shared = await (await fetch(`https://api.elevenlabs.io/v1/shared-voices?page_size=30&language=pt&search=${encodeURIComponent("Thayane")}`, { headers })).json();
  const found = (shared.voices ?? []).find((voice) => voice.voice_id === VOICE_ID);
  if (found === undefined || typeof found.public_owner_id !== "string") throw new Error("the approved voice was not found in the shared library");
  if (!apply) return console.log(`[voice] dry-run: would add "${VOICE_NAME}" to the library`);
  const added = await fetch(`https://api.elevenlabs.io/v1/voices/add/${found.public_owner_id}/${VOICE_ID}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ new_name: VOICE_NAME }),
  });
  if (!added.ok) throw new Error(`adding the voice failed (${added.status}): ${(await added.text()).slice(0, 160)}`);
  console.log(`[voice] added ${VOICE_ID} to the library`);
}

async function stepPersona(args, secrets, apply) {
  if (apply && (typeof secrets.agentId !== "string" || typeof secrets.brainSecret !== "string")) throw new UsageError("run the agent step first");
  const common = [`--name=${args.name}, Billion Leads Pro`, `--replica-id=${args.replicaId ?? "rDRYRUN0000"}`, `--agent-id=${secrets.agentId ?? "01a00000-0000-7000-8000-000000000000"}`, `--portal-url=${PORTAL_URL}`, "--language=portuguese"];
  const env = { ...process.env, AGENT_BRAIN_API_KEY: secrets.brainSecret ?? "0".repeat(64), ELEVENLABS_VOICE_ID: VOICE_ID };
  if (!apply) {
    runCli("node", ["scripts/provision-tavus-brain-persona.mjs", "--dry-run", ...common], { env });
    return console.log("[persona] dry-run payload built (secrets redacted by the persona script)");
  }
  if (typeof secrets.personaId === "string") return console.log(`[persona] already created ${secrets.personaId}`);
  const output = runCli("node", ["scripts/provision-tavus-brain-persona.mjs", "--create", ...common], {
    env: { ...env, TAVUS_BRAIN_PERSONA_PROVISION_CONFIRM: "create-brain-persona" },
  });
  const personaId = /persona created: ([A-Za-z0-9]+)/.exec(output)?.[1];
  if (personaId === undefined) throw new Error("could not read the persona id from the persona script");
  secrets.personaId = personaId;
  secrets.replicaId = args.replicaId;
  saveSecrets(args.secretsFile, secrets);
  console.log(`[persona] created ${personaId}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.mode === "apply";
  const secrets = readSecrets(args.secretsFile);
  requireEnv(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "TAVUS_API_KEY", "ELEVENLABS_API_KEY", "OPENROUTER_API_KEY"]);
  const table = { agent: stepAgent, env: stepEnv, crm: stepCrm, ingest: stepIngest, voice: stepVoice, persona: stepPersona };
  for (const step of STEPS.filter((name) => args.only.includes(name))) {
    await table[step](args, secrets, apply);
  }
  if (apply && typeof secrets.personaId === "string" && typeof secrets.agentId === "string") {
    console.log("\nNext (governed database-operator step, not secret): bind the persona and replica to the agent in agent_video_config with");
    console.log(`  agent ${secrets.agentId}, persona ${secrets.personaId}, replica ${secrets.replicaId ?? "(see --replica-id)"}, language portuguese,`);
    console.log("  spoken_languages {portuguese,english,spanish}, closer_vertical metodo_silva. Then activate the agent and run the paid test.");
  }
  console.log(apply ? "\nDONE (apply)." : "\nDRY RUN complete. Nothing was changed.");
}

main().catch((error) => {
  console.error(error instanceof UsageError ? `usage: ${error.message}` : `FAILED: ${error.message}`);
  process.exit(error instanceof UsageError ? 2 : 1);
});
