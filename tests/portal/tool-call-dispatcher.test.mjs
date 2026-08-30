import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { test } from "node:test";

import ts from "typescript";

/**
 * tool-call-dispatcher.ts imports via alias (@/lib/actions/business-action-tool-call,
 * @/lib/runtime/tool-call-names) -- mesmo mecanismo de calendar-connection.test.mjs:
 * ts.transpileModule + vm.Script com um require fake, porque um import()
 * direto não resolve o alias @/ fora do bundler do Next.
 */
const dispatcherSource = await readFile(
  new URL("../../apps/portal/src/app/(app)/agentes/[id]/testar/tool-call-dispatcher.ts", import.meta.url),
  "utf8",
);

function loadDispatcher(options = {}) {
  const calls = { executeBusinessActionToolCall: [] };
  const mocks = new Map([
    ["@/lib/actions/business-action-tool-call", {
      async executeBusinessActionToolCall(agentId, commandId, mode, toolName, toolCallId, rawArguments) {
        calls.executeBusinessActionToolCall.push({ agentId, commandId, mode, toolName, toolCallId, rawArguments });
        return options.result ?? { status: "success", output: "ok" };
      },
    }],
    ["@/lib/runtime/tool-call-names", {
      classifyToolCallName(name) {
        if (["next_slide", "previous_slide", "go_to_slide"].includes(name)) return "scene";
        if (["register_lead", "propose_meeting_slots", "confirm_meeting_slot"].includes(name)) return "business_action";
        return "unknown";
      },
    }],
  ]);

  const compiled = ts.transpileModule(dispatcherSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "tool-call-dispatcher.ts",
  }).outputText;
  const moduleObj = { exports: {} };
  const requireMock = (specifier) => {
    const resolved = mocks.get(specifier);
    if (resolved === undefined) throw new Error(`Unexpected tool-call-dispatcher import: ${specifier}`);
    return resolved;
  };
  const wrapper = new vm.Script(`(function (require, module, exports) { ${compiled}\n})`, {
    filename: "tool-call-dispatcher.runtime.cjs",
  });
  // Ver comentário equivalente em business-action-tool-call.test.mjs: não
  // passe Object/Error/String/Date aqui -- este arquivo cria `{}` como
  // default de rawArguments, e comparar esse objeto (criado no realm do vm)
  // contra um Object.prototype de outro realm quebraria assert.deepEqual.
  wrapper.runInNewContext({})(requireMock, moduleObj, moduleObj.exports);
  return { dispatcher: moduleObj.exports, calls };
}

test("dispatchToolCall returns null for a scene tool name without ever calling the business action Server Action", async () => {
  const { dispatcher, calls } = loadDispatcher();
  const result = await dispatcher.dispatchToolCall({
    agentId: "019b0000-0000-7000-8000-000000000001",
    commandId: "019b0000-0000-7000-8000-000000000002",
    mode: "presentation",
    message: { properties: { name: "next_slide", tool_call_id: "call-1", arguments: "{}" } },
  });
  assert.equal(result, null);
  assert.equal(calls.executeBusinessActionToolCall.length, 0);
});

test("dispatchToolCall returns null for an unrecognized tool name", async () => {
  const { dispatcher, calls } = loadDispatcher();
  const result = await dispatcher.dispatchToolCall({
    agentId: "019b0000-0000-7000-8000-000000000001",
    commandId: "019b0000-0000-7000-8000-000000000002",
    mode: "presentation",
    message: { properties: { name: "delete_everything", tool_call_id: "call-1", arguments: "{}" } },
  });
  assert.equal(result, null);
  assert.equal(calls.executeBusinessActionToolCall.length, 0);
});

test("dispatchToolCall returns null when tool_call_id is missing, even for a business action name", async () => {
  const { dispatcher, calls } = loadDispatcher();
  const result = await dispatcher.dispatchToolCall({
    agentId: "019b0000-0000-7000-8000-000000000001",
    commandId: "019b0000-0000-7000-8000-000000000002",
    mode: "presentation",
    message: { properties: { name: "register_lead", arguments: "{}" } },
  });
  assert.equal(result, null);
  assert.equal(calls.executeBusinessActionToolCall.length, 0);
});

test("dispatchToolCall forwards a business action tool call to executeBusinessActionToolCall and echoes its result", async () => {
  const { dispatcher, calls } = loadDispatcher({ result: { status: "success", output: "Lead registrado." } });
  const result = await dispatcher.dispatchToolCall({
    agentId: "019b0000-0000-7000-8000-000000000001",
    commandId: "019b0000-0000-7000-8000-000000000002",
    mode: "presentation",
    message: { properties: { name: "register_lead", tool_call_id: "call-1", arguments: '{"contactName":"Ana"}' } },
  });
  assert.equal(result.toolCallId, "call-1");
  assert.equal(result.status, "success");
  assert.equal(result.output, "Lead registrado.");
  assert.equal(calls.executeBusinessActionToolCall.length, 1);
  assert.equal(calls.executeBusinessActionToolCall[0].agentId, "019b0000-0000-7000-8000-000000000001");
  assert.equal(calls.executeBusinessActionToolCall[0].commandId, "019b0000-0000-7000-8000-000000000002");
  assert.equal(calls.executeBusinessActionToolCall[0].mode, "presentation");
  assert.equal(calls.executeBusinessActionToolCall[0].toolName, "register_lead");
  assert.equal(calls.executeBusinessActionToolCall[0].toolCallId, "call-1");
  assert.equal(calls.executeBusinessActionToolCall[0].rawArguments, '{"contactName":"Ana"}');
});

test("dispatchToolCall defaults rawArguments to an empty object when the message carries none", async () => {
  const { dispatcher, calls } = loadDispatcher();
  await dispatcher.dispatchToolCall({
    agentId: "019b0000-0000-7000-8000-000000000001",
    commandId: "019b0000-0000-7000-8000-000000000002",
    mode: "video",
    message: { properties: { name: "propose_meeting_slots", tool_call_id: "call-2" } },
  });
  // rawArguments veio do realm do vm -- spread pra um objeto deste realm
  // antes de comparar (mesmo motivo do comentário em loadDispatcher acima).
  assert.deepEqual({ ...calls.executeBusinessActionToolCall[0].rawArguments }, {});
});
