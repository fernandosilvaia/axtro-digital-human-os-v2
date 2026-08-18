#!/usr/bin/env node
// scripts/canaries/termination-latency-canary.mjs
//
// MANUAL-ONLY CANARY. Read scripts/canaries/README.md and
// docs/operations/TERMINATION_LATENCY_CANARY.md before running this.
//
// Never wire this into CI, cron, GitHub Actions, or a package.json script
// alias (see the README rule about grepping for "canaries/"). It exists to
// answer one question with real evidence, not a guess:
//
//   When a human (or our own code, on their behalf) calls the provider's
//   "stop" endpoint for a live Tavus conversation or a live Recall bot,
//   how long does the avatar's audio/video keep reaching a REAL,
//   INDEPENDENT participant afterward?
//
// This question exists because the investigation behind this script found
// no production code path that calls endConversation/leaveCall on a human's
// direct request — only as failure-compensation or background reconciliation
// (see docs/operations/TERMINATION_LATENCY_CANARY.md for the full context).
// Before that gap is closed, we want a real number, not an assumption.
//
// WHAT THIS SCRIPT DOES:
//   1. Refuses to run at all unless every required env var is set,
//      including a loud, explicit confirmation value.
//   2. Attaches to an ALREADY-RUNNING conversation/bot that a human started
//      through the normal app (the portal's own "testar" flow, or a real
//      Recall bot join) — it deliberately does NOT create paid resources
//      itself, so it never touches provider_effect_reservations /
//      beginProviderEffect / completeProviderEffect. See README rule 6.
//   3. Calls the real termination method from the real provider port
//      (@axtro/provider-tavus endConversation, or @axtro/provider-recall
//      leaveCall / stopCameraWebpage), recording our own request/response
//      timestamps.
//   4. Reads independent-witness timestamps for when media actually stopped,
//      either from an observer NDJSON file (produced by a companion
//      observer — see the runbook for the two documented designs, one per
//      channel) or, if none is supplied, from a manual human keypress
//      (coarser, reaction-time-biased, but requires zero new dependencies
//      and works today).
//   5. Computes delta_ms, evaluates it against a pass/fail threshold, and
//      writes full evidence to .canary-evidence/ as JSON. Never only prints
//      to stdout — a canary that isn't evidenced is an anecdote.
//
// WHAT THIS SCRIPT DELIBERATELY DOES NOT DO (v1 scope):
//   - Start a Tavus conversation or Recall bot itself. Reuse the real app
//     flow so the run stays inside real billing/trial-cap/paid-effects
//     bookkeeping instead of a parallel, divergent path.
//   - Implement the observer (the "second witness in the room") inline.
//     Joining a live Daily.co room or running a second Recall bot and
//     downloading its recording is real integration work with its own
//     failure modes; forcing it into this gate-and-measure script would
//     make the one part that must be trustworthy (the gate) harder to
//     audit. See the runbook for the two recommended observer designs.
//   - Touch the paid-effects ledger in any way.

import process from "node:process";
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..", "..");
const EVIDENCE_DIR = path.join(REPO_ROOT, ".canary-evidence");

// Deliberately loud and specific — not "1" or "true". A human has to read
// this and mean it. Mirrors the spirit of AXTRO_ALLOW_LOCAL_DATABASE_URL=1
// used elsewhere in scripts/, turned up for a canary that touches real
// external meetings and real spend.
const REQUIRED_CONFIRM_VALUE = "RUN-AGAINST-REAL-PROVIDER";

const CHANNELS = /** @type {const} */ (["tavus", "recall-leave", "recall-camera"]);

const DEFAULT_THRESHOLD_MS = {
  tavus: 3000,
  "recall-leave": 5000,
  "recall-camera": 1000,
};

class CanaryGateError extends Error {}
class CanaryUsageError extends Error {}

function usage() {
  return `Usage:
  node scripts/canaries/termination-latency-canary.mjs \\
    --channel=<tavus|recall-leave|recall-camera> \\
    --target-id=<conversationId-or-botId> \\
    [--observer-file=<path-to-ndjson>] \\
    [--threshold-ms=<number>] \\
    [--dry-run]

  --channel        which provider + which stop action to exercise.
                    tavus          -> @axtro/provider-tavus endConversation
                    recall-leave   -> @axtro/provider-recall leaveCall
                    recall-camera  -> @axtro/provider-recall stopCameraWebpage
  --target-id       the ALREADY-RUNNING conversationId (tavus) or botId
                    (recall) to terminate. This script never creates one.
  --observer-file   path to an NDJSON file an independent observer is
                    appending to (see docs/operations/
                    TERMINATION_LATENCY_CANARY.md for the schema and the
                    two recommended observer designs). If omitted, falls
                    back to a manual keypress prompt.
  --threshold-ms    override the default pass/fail threshold for this
                    channel (defaults: tavus=${DEFAULT_THRESHOLD_MS.tavus}, \
recall-leave=${DEFAULT_THRESHOLD_MS["recall-leave"]}, \
recall-camera=${DEFAULT_THRESHOLD_MS["recall-camera"]}). These defaults are
                    an initial proposal, not a validated SLA — tune them
                    after the first empirical runs.
  --dry-run         parse args, run the env-var gate, and print what would
                    happen, but never call a real provider and never prompt
                    for an observer timestamp. Safe with no credentials.

Required environment variables (see the README and runbook before setting
any of these):
  TERMINATION_LATENCY_CANARY_CONFIRM=${REQUIRED_CONFIRM_VALUE}
  TAVUS_API_KEY        (required for --channel=tavus)
  RECALL_API_KEY       (required for --channel=recall-leave|recall-camera)
  RECALL_API_REGION    (required for --channel=recall-leave|recall-camera)
`;
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (const raw of argv) {
    if (raw === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    const match = /^--([a-z-]+)=(.*)$/.exec(raw);
    if (!match) throw new CanaryUsageError(`Unrecognized argument: ${raw}`);
    const [, key, value] = match;
    if (key === "channel") args.channel = value;
    else if (key === "target-id") args.targetId = value;
    else if (key === "observer-file") args.observerFile = value;
    else if (key === "threshold-ms") args.thresholdMs = Number(value);
    else throw new CanaryUsageError(`Unrecognized argument: ${raw}`);
  }
  if (!args.channel || !CHANNELS.includes(args.channel)) {
    throw new CanaryUsageError(`--channel must be one of: ${CHANNELS.join(", ")}`);
  }
  if (!args.dryRun && !args.targetId) {
    throw new CanaryUsageError("--target-id is required (unless --dry-run)");
  }
  if (args.thresholdMs !== undefined && (!Number.isFinite(args.thresholdMs) || args.thresholdMs <= 0)) {
    throw new CanaryUsageError("--threshold-ms must be a positive number");
  }
  return args;
}

function requireEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (value.length === 0) throw new CanaryGateError(`Missing required env var ${name}`);
  return value;
}

function runGate(channel, { dryRun }) {
  const confirm = (process.env.TERMINATION_LATENCY_CANARY_CONFIRM ?? "").trim();
  if (confirm !== REQUIRED_CONFIRM_VALUE) {
    throw new CanaryGateError(
      `TERMINATION_LATENCY_CANARY_CONFIRM must be exactly "${REQUIRED_CONFIRM_VALUE}". ` +
        "This is deliberately not a boolean flag — read scripts/canaries/README.md first.",
    );
  }
  if (dryRun) return {};
  if (channel === "tavus") {
    return { tavusApiKey: requireEnv("TAVUS_API_KEY") };
  }
  return {
    recallApiKey: requireEnv("RECALL_API_KEY"),
    recallRegion: requireEnv("RECALL_API_REGION"),
  };
}

// --- Timeline recorder ------------------------------------------------
//
// Every event gets both a wall-clock ISO timestamp (for humans and for
// cross-referencing provider webhook payloads, which carry their own
// wall-clock times) and a monotonic offset in milliseconds from the first
// recorded event (for the actual delta_ms math, immune to clock skew
// between this process and anything it talks to over the network).

function createTimeline() {
  const events = [];
  let startedAtNs = null;
  function record(source, event, detail) {
    const nowNs = process.hrtime.bigint();
    if (startedAtNs === null) startedAtNs = nowNs;
    const entry = {
      source,
      event,
      detail: detail ?? null,
      ts_iso: new Date().toISOString(),
      ts_monotonic_ms: Number(nowNs - startedAtNs) / 1e6,
    };
    events.push(entry);
    return entry;
  }
  return { events, record };
}

// --- Observer signal: file-backed (preferred) or manual (fallback) ----
//
// Observer NDJSON schema (one JSON object per line), documented in full in
// docs/operations/TERMINATION_LATENCY_CANARY.md:
//   { "ts_iso": "...", "source": "daily-observer" | "recall-observer-bot",
//     "event": "track-stopped" | "participant-left" | "last-video-frame" |
//               "last-audio-sample" | "clock-sync",
//     "detail": { ... } }
//
// This function does NOT join anything itself. It expects the file to
// already contain (or be actively appended with) events from a companion
// observer process the human started before triggering termination. It
// waits, polling the file, until either a plausible "media stopped" event
// appears after the given afterIso timestamp, or a timeout elapses.
async function waitForObserverEvent(observerFilePath, afterIso, { timeoutMs = 20_000, pollMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const afterMs = Date.parse(afterIso);
  const relevantEvents = new Set(["track-stopped", "participant-left", "last-video-frame", "last-audio-sample"]);
  while (Date.now() < deadline) {
    let raw;
    try {
      raw = await readFile(observerFilePath, "utf8");
    } catch {
      raw = "";
    }
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const parsed = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {
        // Ignore partial/in-progress lines — the observer may still be
        // mid-write. We'll see the complete line on the next poll.
      }
    }
    const candidates = parsed.filter(
      (event) => relevantEvents.has(event.event) && Date.parse(event.ts_iso) >= afterMs,
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => Date.parse(b.ts_iso) - Date.parse(a.ts_iso));
      return { found: true, event: candidates[0], allEvents: parsed };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { found: false, event: null, allEvents: [] };
}

async function promptManualObserverTimestamp() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(
    "\nNo --observer-file supplied. Falling back to a manual signal.\n" +
      "This is reaction-time-biased (typically +200-400ms of human lag) —\n" +
      "treat results from this mode as a rough upper bound, not a tight\n" +
      "measurement. Prefer a real observer for any run whose result will\n" +
      "gate a decision.\n",
  );
  await rl.question("Watch/listen to the avatar now. Press ENTER the INSTANT its audio/video actually stops. ");
  const tsIso = new Date().toISOString();
  await rl.close();
  return { found: true, event: { ts_iso: tsIso, source: "manual-human", event: "manual-observed-stop", detail: null }, allEvents: [] };
}

// --- Provider port loading ----------------------------------------------
// Imported from the built dist/ output, matching how other root-level
// scripts in this repo consume workspace packages.

async function loadTavusPort(apiKey) {
  const mod = await import(new URL("../../packages/provider-tavus/dist/index.js", import.meta.url));
  return mod.createTavusVideoConversationPort({ apiKey });
}

async function loadRecallPort(apiKey, region) {
  const mod = await import(new URL("../../packages/provider-recall/dist/index.js", import.meta.url));
  return mod.createRecallMeetingBotPort({ apiKey, region });
}

// --- Main ---------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runId = randomUUID();
  const timeline = createTimeline();
  timeline.record("script", "run-start", { runId, channel: args.channel, targetId: args.targetId ?? null, dryRun: args.dryRun });

  const gate = runGate(args.channel, args);
  timeline.record("script", "gate-passed", { channel: args.channel });

  if (args.dryRun) {
    console.log(`[dry-run] Gate passed for channel=${args.channel}.`);
    console.log("[dry-run] Would call:");
    if (args.channel === "tavus") console.log(`  provider-tavus endConversation(${JSON.stringify(args.targetId ?? "<target-id>")})`);
    if (args.channel === "recall-leave") console.log(`  provider-recall leaveCall(${JSON.stringify(args.targetId ?? "<target-id>")})`);
    if (args.channel === "recall-camera") console.log(`  provider-recall stopCameraWebpage(${JSON.stringify(args.targetId ?? "<target-id>")})`);
    console.log("[dry-run] No real provider was called. No evidence file was written.");
    return;
  }

  let port;
  if (args.channel === "tavus") {
    port = await loadTavusPort(gate.tavusApiKey);
  } else {
    port = await loadRecallPort(gate.recallApiKey, gate.recallRegion);
  }

  const t0 = timeline.record("script", "termination-call-start", { channel: args.channel, targetId: args.targetId });
  let terminationError = null;
  try {
    if (args.channel === "tavus") {
      await port.endConversation(args.targetId);
    } else if (args.channel === "recall-leave") {
      await port.leaveCall(args.targetId);
    } else {
      await port.stopCameraWebpage(args.targetId);
    }
  } catch (error) {
    terminationError = error instanceof Error ? error.message : String(error);
  }
  const t1 = timeline.record("script", "termination-call-end", {
    ok: terminationError === null,
    error: terminationError,
  });

  let outcome;
  if (terminationError !== null) {
    outcome = "FAIL";
    timeline.record("script", "outcome", { outcome, reason: "termination_call_error" });
  } else {
    const observerResult = args.observerFile
      ? await waitForObserverEvent(args.observerFile, t0.ts_iso)
      : await promptManualObserverTimestamp();

    if (!observerResult.found) {
      outcome = "INCONCLUSIVE";
      timeline.record("script", "observer-result", { found: false });
      timeline.record("script", "outcome", { outcome, reason: "no_observer_event_within_timeout" });
    } else {
      timeline.record(observerResult.event.source, observerResult.event.event, observerResult.event.detail);
      const deltaMs = Date.parse(observerResult.event.ts_iso) - Date.parse(t0.ts_iso);
      const threshold = args.thresholdMs ?? DEFAULT_THRESHOLD_MS[args.channel];
      outcome = deltaMs >= 0 && deltaMs <= threshold ? "PASS" : "FAIL";
      timeline.record("script", "outcome", { outcome, deltaMs, thresholdMs: threshold });
      console.log(`\nLast independent-witness media event: ${deltaMs}ms after termination call started.`);
      console.log(`Threshold for ${args.channel}: ${threshold}ms -> ${outcome}`);
    }
  }

  await mkdir(EVIDENCE_DIR, { recursive: true });
  const evidencePath = path.join(EVIDENCE_DIR, `${args.channel}-${runId}.json`);
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        runId,
        channel: args.channel,
        targetId: args.targetId,
        outcome,
        events: timeline.events,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`\nEvidence written to ${evidencePath}`);
  console.log(`Outcome: ${outcome}`);

  process.exitCode = outcome === "PASS" ? 0 : outcome === "FAIL" ? 1 : 2;
}

main().catch((error) => {
  if (error instanceof CanaryUsageError) {
    console.error(`Usage error: ${error.message}\n`);
    console.error(usage());
    process.exitCode = 64; // EX_USAGE
    return;
  }
  if (error instanceof CanaryGateError) {
    console.error(`Gate refused to run: ${error.message}`);
    console.error("\nThis is intentional. See scripts/canaries/README.md.");
    process.exitCode = 77; // EX_NOPERM
    return;
  }
  console.error("Unexpected error:", error);
  process.exitCode = 1;
});
