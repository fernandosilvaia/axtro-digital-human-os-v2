import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const [videoCall, presentationRoom, externalMeeting] = await Promise.all([
  readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/video-call.tsx", root), "utf8"),
  readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/presentation-room.tsx", root), "utf8"),
  readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/external-meeting.tsx", root), "utf8"),
]);

function functionBody(source, name, endMarker) {
  const start = source.indexOf(name);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `could not locate ${name}`);
  return source.slice(start, end);
}

test("operator stop controls retain retryable client state until the server confirms", () => {
  const videoStop = functionBody(videoCall, "function end()", "  async function copyRoomLink");
  assert.match(videoStop, /await stopVideoConversation\(agentId, commandId\)/);
  assert.match(videoStop, /if \(!result\.stopped\)[\s\S]*setError/);
  assert.ok(videoStop.indexOf("if (!result.stopped)") < videoStop.indexOf("setUrl(null)"));
  assert.ok(videoStop.indexOf("if (!result.stopped)") < videoStop.indexOf("setActiveCommandId(null)"));
  assert.doesNotMatch(videoStop, /setUrl\(null\);[\s\S]{0,180}await stopVideoConversation/);
  assert.match(videoCall, /Confirmando encerramento/);
  assert.match(videoCall, /role="alert"/);
  assert.match(videoCall, /O provider confirmou o pedido de encerramento da conversa/);
  assert.doesNotMatch(videoCall, /conversa encerrada/);

  const presentationStop = functionBody(presentationRoom, "const leave = useCallback", "  useEffect(() =>");
  assert.match(presentationStop, /await stopPresentationConversation\(agentId, commandId\)/);
  assert.match(presentationStop, /if \(!result\.stopped\)[\s\S]*setError/);
  assert.ok(presentationStop.indexOf("if (!result.stopped)") < presentationStop.indexOf("commandIdRef.current = null"));
  assert.doesNotMatch(presentationRoom, /void stopPresentationConversation/);
  assert.match(presentationRoom, /Confirmando encerramento/);
  assert.match(presentationRoom, /role="alert"/);
  assert.match(presentationRoom, /O provider confirmou o pedido de encerramento da apresentação/);
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
