import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const [videoCall, presentationRoom, externalMeeting, lifecycle] = await Promise.all([
  readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/video-call.tsx", root), "utf8"),
  readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/presentation-room.tsx", root), "utf8"),
  readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/external-meeting.tsx", root), "utf8"),
  readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/call-lifecycle.ts", root), "utf8"),
]);

function functionBody(source, name, endMarker) {
  const start = source.indexOf(name);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `could not locate ${name}`);
  return source.slice(start, end);
}

test("operator stop controls retain retryable client state until the server confirms", () => {
  const stop = functionBody(lifecycle, "const end = useCallback", "  const reset = useCallback");
  assert.match(stop, /await stopAction\(agentId, attempt\.commandId\)/);
  assert.match(stop, /if \(!result\.stopped\)[\s\S]*setError/);
  assert.ok(stop.indexOf("if (!result.stopped)") < stop.indexOf("clearCommand(attempt.commandId)"));
  for (const source of [videoCall, presentationRoom]) {
    assert.match(source, /useCallLifecycle/);
    assert.match(source, /Confirmando encerramento/);
    assert.match(source, /role="alert"/);
    assert.match(source, /O provider confirmou o pedido de encerramento/);
    assert.match(source, /Tentar encerrar/);
  }
  assert.match(videoCall, /stopAction: stopVideoConversation/);
  assert.match(presentationRoom, /stopAction: stopPresentationConversation/);
  assert.doesNotMatch(videoCall, /conversa encerrada/);
  assert.doesNotMatch(presentationRoom, /Apresentação encerrada/);

  const externalStop = functionBody(externalMeeting, "function stopMeeting()", "  const returnedConversationUrl");
  assert.match(externalStop, /await stopExternalMeeting\(agentId, commandId\)/);
  assert.match(externalStop, /if \(result\.stopped && result\.error === null\)/);
  assert.match(externalStop, /setStopped\(false\)[\s\S]*setStopError/);
  assert.match(externalStop, /catch[\s\S]*setStopError/);
  assert.doesNotMatch(externalStop, /setSuccess\(null\)/);
  assert.match(externalMeeting, /O provider confirmou o pedido para que \{agentName\} saia da reunião/);
  assert.doesNotMatch(externalMeeting, /\{agentName\} saiu da reunião/);
});
