import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const coordinatorModule = await import(pathToFileURL(join(root, "packages/turn-coordinator/dist/index.js")).href);

const { createTurnCoordinator, TURN_COORDINATOR_PROFILES, withPushToTalkRequired } = coordinatorModule;

function speech({ atMs, durationMs, voiced = true, energy = 0.6, isBackchannel, participantId }) {
  const signal = { type: "speech_energy", atMs, durationMs, voiced, energy };
  if (isBackchannel !== undefined) signal.isBackchannel = isBackchannel;
  if (participantId !== undefined) signal.participantId = participantId;
  return signal;
}

function transcript(atMs, punctuationComplete, semanticComplete) {
  return { type: "transcript_update", atMs, punctuationComplete, semanticComplete };
}

function stateSequence(coordinator) {
  return coordinator.directives().filter((d) => d.type === "state_changed").map((d) => d.to);
}

// Fixture: normal turn cycle end to end (baseline, not itself one of the ten
// harness fixtures but required to prove the state machine and generation
// fencing work before exercising the harder cases below).
test("turn coordinator: baseline cycle commits and completes with generation fencing", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  let atMs = 0;
  coordinator.handleSignal(speech({ atMs, durationMs: 400 }));
  atMs += 400;
  coordinator.handleSignal(speech({ atMs, durationMs: 700, voiced: false, energy: 0 }));
  atMs += 700;
  assert.equal(coordinator.state(), "committed");
  const generationId = coordinator.currentGenerationId();
  assert.ok(coordinator.isGenerationActive(generationId));

  coordinator.handleSignal({ type: "presenter_turn_completed", atMs, generationId });
  assert.equal(coordinator.state(), "idle");
  assert.equal(coordinator.currentGenerationId(), null);
  assert.equal(coordinator.isGenerationActive(generationId), false);
  assert.deepEqual(stateSequence(coordinator), ["user_speaking", "endpoint_candidate", "committed", "idle"]);
});

// Fixture: pausas no meio da frase.
test("turn coordinator fixture: mid-sentence pause returns to user_speaking instead of committing", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  let atMs = 0;
  coordinator.handleSignal(speech({ atMs, durationMs: 400 }));
  atMs += 400;
  coordinator.handleSignal(speech({ atMs, durationMs: 400, voiced: false, energy: 0 }));
  atMs += 400;
  assert.equal(coordinator.state(), "endpoint_candidate", "a short pause is only a candidate");
  coordinator.handleSignal(speech({ atMs, durationMs: 300 }));
  atMs += 300;
  assert.equal(coordinator.state(), "user_speaking", "resumed speech cancels the candidate endpoint");
  coordinator.handleSignal(speech({ atMs, durationMs: 700, voiced: false, energy: 0 }));
  assert.equal(coordinator.state(), "committed", "a real trailing silence still commits the turn");
});

// Fixture: "hum", "aham" e backchannel.
test("turn coordinator fixture: backchannel never interrupts the presenter floor", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  let atMs = 0;
  coordinator.handleSignal(speech({ atMs, durationMs: 400 }));
  atMs += 400;
  coordinator.handleSignal(speech({ atMs, durationMs: 700, voiced: false, energy: 0 }));
  atMs += 700;
  assert.equal(coordinator.state(), "committed");

  for (let i = 0; i < 5; i += 1) {
    coordinator.handleSignal(speech({ atMs, durationMs: 200, energy: 0.6, isBackchannel: true }));
    atMs += 200;
  }
  assert.equal(coordinator.state(), "committed", "backchannel is filtered before it can raise a candidate");
  assert.equal(coordinator.directives().some((d) => d.type === "playback_paused"), false);
});

// Fixture: crosstalk.
test("turn coordinator fixture: crosstalk from a second speaker is ignored, not merged", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  let atMs = 0;
  coordinator.handleSignal(speech({ atMs, durationMs: 300, participantId: "alice" }));
  atMs += 300;
  coordinator.handleSignal(speech({ atMs, durationMs: 200, participantId: "bob" }));
  atMs += 200;
  assert.equal(coordinator.state(), "user_speaking");
  assert.ok(coordinator.directives().some((d) => d.type === "crosstalk_ignored" && d.ignoredParticipantId === "bob"));

  coordinator.handleSignal(speech({ atMs, durationMs: 700, voiced: false, energy: 0, participantId: "alice" }));
  assert.equal(coordinator.state(), "committed", "alice's turn still commits despite bob's crosstalk");
});

// Fixture: ruído e música.
test("turn coordinator fixture: noise and music below the speech threshold never start a turn", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  coordinator.handleSignal(speech({ atMs: 0, durationMs: 2000, voiced: true, energy: 0.05 }));
  assert.equal(coordinator.state(), "idle");
  coordinator.handleSignal(speech({ atMs: 2000, durationMs: 2000, voiced: false, energy: 0 }));
  assert.equal(coordinator.state(), "idle");
});

// Fixture: sotaques PT-BR e números e e-mails (exact-capture pacing).
test("turn coordinator fixture: PT-BR transcript content and mid-dictation pauses do not force premature commit", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.presentation);
  let atMs = 0;
  // "meu e-mail é fernando, ponto, silva, arroba, exemplo, ponto, com" (PT-BR, accents and punctuation mid-utterance).
  coordinator.handleSignal(speech({ atMs, durationMs: 500 }));
  atMs += 500;
  coordinator.handleSignal(transcript(atMs, false, false));
  coordinator.handleSignal(speech({ atMs, durationMs: 600, voiced: false, energy: 0 }));
  atMs += 600;
  assert.equal(coordinator.state(), "endpoint_candidate", "a mid-dictation pause is only a candidate, not a commit");

  coordinator.handleSignal(speech({ atMs, durationMs: 300 }));
  atMs += 300;
  assert.equal(coordinator.state(), "user_speaking", "resumed dictation cancels the earlier candidate");

  coordinator.handleSignal(transcript(atMs, true, true));
  coordinator.handleSignal(speech({ atMs, durationMs: 1000, voiced: false, energy: 0 }));
  assert.equal(coordinator.state(), "committed", "endpoint only confirms once semantically complete and silent");
});

// Fixture: falso início.
test("turn coordinator fixture: a false start is abandoned back to idle without committing", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  coordinator.handleSignal(speech({ atMs: 0, durationMs: 60 }));
  assert.equal(coordinator.state(), "user_speaking");
  coordinator.handleSignal(speech({ atMs: 60, durationMs: 500, voiced: false, energy: 0 }));
  assert.equal(coordinator.state(), "idle", "voiced duration never reached minSpeechDurationMsToStart");
  assert.ok(coordinator.directives().some((d) => d.type === "false_start_abandoned"));
});

// Fixture: interrupção durante tool preamble.
test("turn coordinator fixture: a confirmed interruption during the presenter's preamble cancels generation and scene", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  let atMs = 0;
  coordinator.handleSignal(speech({ atMs, durationMs: 400 }));
  atMs += 400;
  coordinator.handleSignal(speech({ atMs, durationMs: 700, voiced: false, energy: 0 }));
  atMs += 700;
  const generationId = coordinator.currentGenerationId();
  assert.equal(coordinator.state(), "committed", "presenter has the floor, mid tool preamble");

  coordinator.handleSignal(speech({ atMs, durationMs: 150, energy: 0.6, participantId: "caller" }));
  atMs += 150;
  assert.equal(coordinator.state(), "agent_interrupted");
  coordinator.handleSignal(speech({ atMs, durationMs: 90, energy: 0.6, participantId: "caller" }));
  atMs += 90;
  assert.equal(coordinator.state(), "user_speaking", "sustained speech confirms the interruption");
  assert.equal(coordinator.isGenerationActive(generationId), false, "the cancelled generation is no longer active");

  const directives = coordinator.directives();
  assert.ok(directives.some((d) => d.type === "generation_cancelled" && d.generationId === generationId && d.reason === "interruption_confirmed"));
  assert.ok(directives.some((d) => d.type === "scene_cancelled" && d.generationId === generationId));
});

// Fixture: falsa interrupção recuperada (complements the confirmed-interruption fixture above).
test("turn coordinator: a false-positive interruption recovers playback on the same generation", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  let atMs = 0;
  coordinator.handleSignal(speech({ atMs, durationMs: 400 }));
  atMs += 400;
  coordinator.handleSignal(speech({ atMs, durationMs: 700, voiced: false, energy: 0 }));
  atMs += 700;
  const generationId = coordinator.currentGenerationId();

  coordinator.handleSignal(speech({ atMs, durationMs: 150, energy: 0.6 }));
  atMs += 150;
  assert.equal(coordinator.state(), "agent_interrupted");
  coordinator.handleSignal(speech({ atMs, durationMs: 100, voiced: false, energy: 0 }));
  assert.equal(coordinator.state(), "committed", "recovery resumes the still-valid generation");
  assert.equal(coordinator.currentGenerationId(), generationId, "identity is preserved, not replaced");
  assert.ok(coordinator.directives().some((d) => d.type === "playback_resumed" && d.generationId === generationId));
  assert.equal(coordinator.directives().some((d) => d.type === "generation_cancelled"), false);
});

// Fixture: rede lenta.
test("turn coordinator fixture: network jitter signals never mutate state", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  coordinator.handleSignal(speech({ atMs: 0, durationMs: 400 }));
  const before = coordinator.state();
  coordinator.handleSignal({ type: "network_jitter_observed", atMs: 400, delayMs: 900 });
  assert.equal(coordinator.state(), before);
  coordinator.handleSignal({ type: "network_jitter_observed", atMs: 500, delayMs: 1200 });
  assert.equal(coordinator.state(), before);
});

// Fixture: agente falando demais.
test("turn coordinator fixture: sub-threshold participant noise never dislodges an over-talking presenter", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  let atMs = 0;
  coordinator.handleSignal(speech({ atMs, durationMs: 400 }));
  atMs += 400;
  coordinator.handleSignal(speech({ atMs, durationMs: 700, voiced: false, energy: 0 }));
  atMs += 700;
  assert.equal(coordinator.state(), "committed");

  for (let i = 0; i < 20; i += 1) {
    coordinator.handleSignal(speech({ atMs, durationMs: 50, energy: 0.1 }));
    atMs += 50;
  }
  assert.equal(coordinator.state(), "committed", "the presenter keeps the floor absent a qualifying barge-in");
});

test("turn coordinator: max utterance timeout forces an endpoint without silence", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.conversational);
  let atMs = 0;
  const chunkMs = 1000;
  while (coordinator.state() !== "committed" && atMs < 30_000) {
    coordinator.handleSignal(speech({ atMs, durationMs: chunkMs }));
    atMs += chunkMs;
  }
  assert.equal(coordinator.state(), "committed", "sustained speech past maxUtteranceMs still commits");
});

test("turn coordinator: accessibility push-to-talk drives the turn without energy thresholds", () => {
  const profile = withPushToTalkRequired(TURN_COORDINATOR_PROFILES.accessibility, true);
  const coordinator = createTurnCoordinator(profile);
  coordinator.handleSignal({ type: "push_to_talk_pressed", atMs: 0, participantId: "user-1" });
  assert.equal(coordinator.state(), "user_speaking");
  coordinator.handleSignal({ type: "push_to_talk_released", atMs: 4000 });
  assert.equal(coordinator.state(), "committed");
});

test("turn coordinator: noisy_phone profile requires punctuation completeness before committing", () => {
  const coordinator = createTurnCoordinator(TURN_COORDINATOR_PROFILES.noisy_phone);
  let atMs = 0;
  coordinator.handleSignal(speech({ atMs, durationMs: 500, energy: 0.6 }));
  atMs += 500;
  coordinator.handleSignal(transcript(atMs, false, true));
  coordinator.handleSignal(speech({ atMs, durationMs: 900, voiced: false, energy: 0 }));
  atMs += 900;
  assert.equal(coordinator.state(), "endpoint_candidate", "incomplete punctuation withholds commit on a noisy line");

  coordinator.handleSignal(transcript(atMs, true, true));
  assert.equal(coordinator.state(), "committed", "punctuation completion confirms the endpoint immediately");
});
