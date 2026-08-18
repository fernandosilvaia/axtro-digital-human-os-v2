import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const [videoActions, meetingActions, leadRoute, recallRoute, presentationClient, bridgeMigration] = await Promise.all([
  readFile(new URL("apps/portal/src/lib/actions/video-conversation.ts", root), "utf8"),
  readFile(new URL("apps/portal/src/lib/actions/meeting-bot.ts", root), "utf8"),
  readFile(new URL("apps/portal/src/app/api/leads/video-session/route.ts", root), "utf8"),
  readFile(new URL("apps/portal/src/app/api/recall/webhook/route.ts", root), "utf8"),
  readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/presentation-room.tsx", root), "utf8"),
  readFile(new URL("database/supabase-only/0043_portal_runtime_bridge_contract.sql", root), "utf8"),
]);

function appearsBefore(source, first, second, message) {
  const firstAt = source.indexOf(first);
  const secondAt = source.indexOf(second);
  assert.equal(firstAt >= 0 && secondAt >= 0 && firstAt < secondAt, true, message);
}

test("direct Tavus actions admit a purpose-scoped runtime session before any paid reservation", () => {
  appearsBefore(videoActions, "const runtimeAdmission = await admitAuthenticatedTavusChannel", "await beginProviderEffect(reservationInput)", "runtime admission must precede Tavus reservation");
  assert.match(videoActions, /requestedPurposes:\s*VIDEO_RUNTIME_PURPOSES/);
  assert.match(videoActions, /user\?\.app_metadata\?\.actor_id/);
  assert.doesNotMatch(videoActions, /actorId:\s*user\.id/);
  assert.match(videoActions, /assertPortalProviderDispatchActive\(\{ grant, consumerKind: "tavus" \}\)/);
  assert.match(videoActions, /commitProviderEffectOrCompensate[\s\S]*?bindPortalProviderChannel/);
  assert.doesNotMatch(videoActions, /acquireProviderDispatch/);
});

test("participant-unbound channels fail closed before processing lead or meeting data", () => {
  appearsBefore(meetingActions, "participantScopedMeetingAdmissionReady", "await beginProviderEffect(recallInput)", "external meeting block must precede Recall reservation");
  appearsBefore(leadRoute, "controlTowerParticipantAdmissionReady", "readBoundedTextBody(request", "lead route must close before parsing lead context");
  assert.match(leadRoute, /runtime_admission_required/);
});

test("a Recall callback needs a matching durable grant and consumes Tavus immediately before the specialised Tavus fence", () => {
  assert.match(bridgeMigration, /portal_runtime_provider_channel_receipts pr[\s\S]*pr\.provider_id='recall'[\s\S]*pr\.provider_ref=s\.recall_bot_id/);
  assert.match(bridgeMigration, /'runtimeGrantId',b\.id[\s\S]*'runtimeCommandFingerprint',b\.command_fingerprint/);
  appearsBefore(recallRoute, "const runtimeGrant = runtimeGrantFromSentinelContext(context)", "await beginProviderEffect(effectInput)", "sentinel runtime binding must precede reservation");
  appearsBefore(recallRoute, "assertPortalProviderDispatchActive({ grant: runtimeGrant, consumerKind: \"tavus\" })", "prepareTavusWebhookCallback(reservationId", "runtime grant must be consumed before Tavus callback fence");
  assert.match(recallRoute, /commitProviderEffect\(reservationId[\s\S]*?bindPortalProviderChannel/);
});

test("provider tool calls cannot mutate the browser scene or report false success", () => {
  const handler = presentationClient.match(/const handleToolCall[\s\S]*?\n  }, \[\]\);/)?.[0] ?? "";
  assert.match(handler, /Comando de cena recusado/);
  assert.match(handler, /status: "error"/);
  assert.doesNotMatch(handler, /goTo\(/);
  assert.doesNotMatch(handler, /status: "success"/);
  assert.match(presentationClient, /manifesto, geração e recibo validados pelo servidor/);
});
