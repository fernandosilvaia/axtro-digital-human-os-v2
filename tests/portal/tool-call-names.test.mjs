import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_ACTION_TOOL_NAMES,
  SCENE_TOOL_NAMES,
  classifyToolCallName,
  isBusinessActionToolName,
  isSceneToolName,
} from "../../apps/portal/src/lib/runtime/tool-call-names.ts";

test("tool call names: the scene and business action allowlists are the exact ADR-041 lists, disjoint", () => {
  assert.deepEqual(SCENE_TOOL_NAMES, ["next_slide", "previous_slide", "go_to_slide"]);
  assert.deepEqual(BUSINESS_ACTION_TOOL_NAMES, ["register_lead", "propose_meeting_slots", "confirm_meeting_slot"]);
  for (const name of SCENE_TOOL_NAMES) assert.equal(BUSINESS_ACTION_TOOL_NAMES.includes(name), false);
});

test("tool call names: classifyToolCallName routes scene, business_action and unknown correctly", () => {
  for (const name of ["next_slide", "previous_slide", "go_to_slide"]) {
    assert.equal(classifyToolCallName(name), "scene");
    assert.equal(isSceneToolName(name), true);
    assert.equal(isBusinessActionToolName(name), false);
  }
  for (const name of ["register_lead", "propose_meeting_slots", "confirm_meeting_slot"]) {
    assert.equal(classifyToolCallName(name), "business_action");
    assert.equal(isBusinessActionToolName(name), true);
    assert.equal(isSceneToolName(name), false);
  }
  for (const name of ["", "delete_everything", "Register_Lead", "next_slide "]) {
    assert.equal(classifyToolCallName(name), "unknown");
    assert.equal(isSceneToolName(name), false);
    assert.equal(isBusinessActionToolName(name), false);
  }
});
