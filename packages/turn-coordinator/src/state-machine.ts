/**
 * Pure state machine for docs/architecture/TURN_COORDINATOR.md. It decides
 * when to listen, wait, respond, interrupt and recover a false interruption.
 * It never decides commercial content. Interpretation notes for the ASCII
 * diagram in that document: the "pause" edge is bidirectional between
 * user_speaking and endpoint_candidate (a pause is one endpoint signal, and
 * resumed speech during that candidate window returns to user_speaking); a
 * confirmed interruption hands the floor to the participant (user_speaking),
 * while a false-positive recovery resumes the still-valid generation
 * (committed) rather than discarding it.
 */
export type TurnCoordinatorState =
  | "idle"
  | "user_speaking"
  | "endpoint_candidate"
  | "committed"
  | "agent_interrupted"
  | "recovered_false_interrupt";

export type TurnCoordinatorTransitionEvent =
  | "speech_started"
  | "pause_detected"
  | "max_utterance_timeout"
  | "false_start_abandoned"
  | "speech_resumed"
  | "endpoint_confirmed"
  | "presenter_turn_completed"
  | "interruption_candidate"
  | "interruption_confirmed"
  | "interruption_false_positive"
  | "playback_recovered";

const TRANSITIONS: Readonly<Record<TurnCoordinatorState, Partial<Record<TurnCoordinatorTransitionEvent, TurnCoordinatorState>>>> = Object.freeze({
  idle: Object.freeze({ speech_started: "user_speaking" }),
  user_speaking: Object.freeze({
    pause_detected: "endpoint_candidate",
    max_utterance_timeout: "endpoint_candidate",
    false_start_abandoned: "idle",
  }),
  endpoint_candidate: Object.freeze({
    speech_resumed: "user_speaking",
    endpoint_confirmed: "committed",
  }),
  committed: Object.freeze({
    presenter_turn_completed: "idle",
    interruption_candidate: "agent_interrupted",
  }),
  agent_interrupted: Object.freeze({
    interruption_confirmed: "user_speaking",
    interruption_false_positive: "recovered_false_interrupt",
  }),
  recovered_false_interrupt: Object.freeze({ playback_recovered: "committed" }),
});

export class TurnCoordinatorTransitionError extends Error {
  constructor(readonly state: TurnCoordinatorState, readonly event: TurnCoordinatorTransitionEvent) {
    super(`turn coordinator cannot handle "${event}" while in "${state}"`);
    this.name = "TurnCoordinatorTransitionError";
  }
}

/** Pure reducer: given a state and an event, return the next state or throw. */
export function reduceTurnCoordinatorState(
  state: TurnCoordinatorState,
  event: TurnCoordinatorTransitionEvent,
): TurnCoordinatorState {
  const next = TRANSITIONS[state][event];
  if (next === undefined) throw new TurnCoordinatorTransitionError(state, event);
  return next;
}

export function canHandleTurnCoordinatorEvent(state: TurnCoordinatorState, event: TurnCoordinatorTransitionEvent): boolean {
  return TRANSITIONS[state][event] !== undefined;
}
