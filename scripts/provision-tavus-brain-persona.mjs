#!/usr/bin/env node
// scripts/provision-tavus-brain-persona.mjs
//
// MANUAL-ONLY, ACCOUNT-CONFIGURATION SCRIPT. Creates ONE Tavus persona whose
// LLM layer is our own brain endpoint (/api/brain/<agentId>/chat/completions),
// so every reply goes through the vertical doctrine, the knowledge base and the
// compliance sentinel. Built for the life insurance closer (Priscila), usable
// for any brain-backed closer. Read docs/operations/PRISCILA_LAUNCH.md first.
//
// Never wire this into CI, cron or a package.json alias: creating a persona is
// an account-level change on the real Tavus account.
//
// Modes (exactly one):
//   --list-replicas          GET /v2/replicas (read only, no cost). Prints id,
//                            name, model and thumbnail so a human picks the face.
//   --dry-run                Builds and prints the persona payload with every
//                            secret redacted. Touches no network.
//   --create                 POST /v2/personas. Requires
//                            TAVUS_BRAIN_PERSONA_PROVISION_CONFIRM=create-brain-persona
//
// Arguments for --dry-run and --create:
//   --name="Priscila, Life Insurance"     persona name (1..120 chars)
//   --replica-id=rXXXXXXXXXXX             stock replica chosen with --list-replicas
//   --agent-id=<uuidv7>                   portal agent that owns the brain
//   --portal-url=https://closer.axtroai.com
//   --language=english|portuguese         doctrine language of the perception layer
//
// Environment:
//   TAVUS_API_KEY            Tavus account key (never printed)
//   AGENT_BRAIN_API_KEY      the agent's brain secret, shown once by the portal
//                            when it is generated (never printed)
//   ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID   optional custom voice

import process from "node:process";

const BASE = "https://tavusapi.com/v2";
const REQUIRED_CONFIRM_VALUE = "create-brain-persona";
const ID_PATTERN = /^[a-z0-9]{8,64}$/i;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The persona's own system_prompt is only a floor: with a custom LLM, our brain
// discards provider system messages as instructions and composes the reviewed
// doctrine itself (lib/brain/tavus-request.ts). Keeping it short and honest
// avoids a second, divergent copy of the doctrine living at the provider.
const SYSTEM_PROMPT_FLOOR = "You are a transparently AI consultant. Your instructions and knowledge come from the connected brain service.";

const PERCEPTION_QUERIES = {
  english: [
    "What emotion does the person's face express right now (interest, doubt, worry, sadness, relief)?",
    "Does the person look confused or lost by what was just said?",
    "What does the person's body language indicate (leaning in, leaning back, arms crossed, restless)?",
    "Does the person seem to want to speak or interrupt?",
    "Is the person distracted or looking away from the conversation?",
    "Is there more than one person visible in the frame?",
  ],
  portuguese: [
    "Qual emoção o rosto da pessoa expressa agora (interesse, dúvida, preocupação, tristeza, alívio)?",
    "A pessoa aparenta confusão ou parece perdida com o que acabou de ser dito?",
    "O que a linguagem corporal da pessoa indica (inclinada para frente, recostada, braços cruzados, inquieta)?",
    "A pessoa parece querer falar ou interromper?",
    "A pessoa está distraída ou olhando para fora da conversa?",
    "Há mais de uma pessoa visível no enquadramento?",
  ],
};

class UsageError extends Error {}

export function parseArgs(argv) {
  const args = { mode: null, name: "", replicaId: "", agentId: "", portalUrl: "", language: "english" };
  for (const raw of argv) {
    if (raw === "--list-replicas" || raw === "--dry-run" || raw === "--create") {
      if (args.mode !== null) throw new UsageError("Choose exactly one mode.");
      args.mode = raw.slice(2);
      continue;
    }
    const match = /^--(name|replica-id|agent-id|portal-url|language)=(.*)$/.exec(raw);
    if (!match) throw new UsageError(`Unrecognized argument: ${raw}`);
    const key = { name: "name", "replica-id": "replicaId", "agent-id": "agentId", "portal-url": "portalUrl", language: "language" }[match[1]];
    args[key] = match[2].trim();
  }
  if (args.mode === null) throw new UsageError("Choose a mode: --list-replicas, --dry-run or --create.");
  if (args.mode === "list-replicas") return args;
  if (args.name.length === 0 || args.name.length > 120) throw new UsageError("--name must be 1..120 chars.");
  if (!ID_PATTERN.test(args.replicaId)) throw new UsageError("--replica-id must be a plain Tavus replica id.");
  if (!UUID_V7_PATTERN.test(args.agentId)) throw new UsageError("--agent-id must be the portal agent UUIDv7.");
  let portal;
  try {
    portal = new URL(args.portalUrl);
  } catch {
    throw new UsageError("--portal-url must be an absolute https URL.");
  }
  if (portal.protocol !== "https:" || portal.pathname !== "/" || portal.search || portal.hash) {
    throw new UsageError("--portal-url must be a bare https origin, for example https://closer.axtroai.com");
  }
  if (!(args.language in PERCEPTION_QUERIES)) throw new UsageError("--language must be english or portuguese.");
  args.portalUrl = portal.origin;
  return args;
}

export function buildPersonaPayload(args, secrets) {
  const voice = secrets.elevenLabsApiKey && secrets.elevenLabsVoiceId
    ? {
      tts: {
        tts_engine: "elevenlabs",
        api_key: secrets.elevenLabsApiKey,
        external_voice_id: secrets.elevenLabsVoiceId,
        tts_model_name: "eleven_multilingual_v2",
        tts_emotion_control: true,
      },
    }
    : {};
  return {
    persona_name: args.name,
    pipeline_mode: "full",
    default_replica_id: args.replicaId,
    system_prompt: SYSTEM_PROMPT_FLOOR,
    layers: {
      llm: {
        model: "axtro-digital-human-os-brain",
        base_url: `${args.portalUrl}/api/brain/${args.agentId}`,
        api_key: secrets.brainApiKey,
        speculative_inference: true,
      },
      stt: {
        stt_engine: "tavus-advanced",
        participant_pause_sensitivity: "high",
        participant_interrupt_sensitivity: "high",
        smart_turn_detection: true,
      },
      perception: {
        perception_model: "raven-1",
        ambient_awareness_queries: PERCEPTION_QUERIES[args.language],
      },
      ...voice,
    },
  };
}

export function redact(payload) {
  return JSON.parse(JSON.stringify(payload, (key, value) => (key === "api_key" && typeof value === "string" ? "[redacted]" : value)));
}

function requireEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (value.length === 0) throw new UsageError(`Missing required env var ${name}`);
  return value;
}

async function tavus(apiKey, method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: method === "GET" ? { "x-api-key": apiKey } : { "x-api-key": apiKey, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Tavus ${method} ${path} failed with HTTP ${response.status}`);
  return text.length === 0 ? null : JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "list-replicas") {
    const apiKey = requireEnv("TAVUS_API_KEY");
    const payload = await tavus(apiKey, "GET", "/replicas?limit=100&replica_type=system");
    const replicas = Array.isArray(payload?.data) ? payload.data : [];
    for (const replica of replicas) {
      console.log([replica.replica_id, replica.replica_name, replica.model_name ?? "", replica.thumbnail_video_url ?? ""].join(" | "));
    }
    console.log(`\n${replicas.length} stock replicas. Pick by looking at the thumbnail, not by the name.`);
    return;
  }
  const secrets = {
    brainApiKey: args.mode === "dry-run" ? (process.env.AGENT_BRAIN_API_KEY ?? "placeholder") : requireEnv("AGENT_BRAIN_API_KEY"),
    elevenLabsApiKey: (process.env.ELEVENLABS_API_KEY ?? "").trim(),
    elevenLabsVoiceId: (process.env.ELEVENLABS_VOICE_ID ?? "").trim(),
  };
  const payload = buildPersonaPayload(args, secrets);
  if (args.mode === "dry-run") {
    console.log(JSON.stringify(redact(payload), null, 2));
    console.log("\n(dry-run: nothing was sent to Tavus.)");
    return;
  }
  if ((process.env.TAVUS_BRAIN_PERSONA_PROVISION_CONFIRM ?? "").trim() !== REQUIRED_CONFIRM_VALUE) {
    throw new UsageError(`TAVUS_BRAIN_PERSONA_PROVISION_CONFIRM must be exactly "${REQUIRED_CONFIRM_VALUE}". Read docs/operations/PRISCILA_LAUNCH.md first.`);
  }
  const apiKey = requireEnv("TAVUS_API_KEY");
  const created = await tavus(apiKey, "POST", "/personas", payload);
  const personaId = created?.persona_id;
  if (typeof personaId !== "string" || !ID_PATTERN.test(personaId)) throw new Error("Tavus response has no persona_id");
  console.log(`persona created: ${personaId}`);
  console.log("Next: governed binding of persona and replica to the agent (docs/operations/PRISCILA_LAUNCH.md, step 6).");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof UsageError ? `usage: ${error.message}` : `error: ${error.message}`);
    process.exit(1);
  });
}
