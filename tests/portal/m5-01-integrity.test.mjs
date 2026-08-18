import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const migration = await readFile(new URL("database/supabase-only/0040_production_integrity_hardening.sql", root), "utf8");
const contractMigration = await readFile(new URL("database/supabase-only/0041_provider_transcript_contract.sql", root), "utf8");
const leadRoute = await readFile(new URL("apps/portal/src/app/api/leads/video-session/route.ts", root), "utf8");
const recallRoute = await readFile(new URL("apps/portal/src/app/api/recall/webhook/route.ts", root), "utf8");
const tavusRoute = await readFile(new URL("apps/portal/src/app/api/tavus/webhook/route.ts", root), "utf8");
const transcriptRegister = await readFile(new URL("apps/portal/src/lib/transcripts/register.ts", root), "utf8");
const videoActions = await readFile(new URL("apps/portal/src/lib/actions/video-conversation.ts", root), "utf8");
const meetingActions = await readFile(new URL("apps/portal/src/lib/actions/meeting-bot.ts", root), "utf8");
const agentVideo = await readFile(new URL("apps/portal/src/lib/agent-video.ts", root), "utf8");
const proposalActions = await readFile(new URL("apps/portal/src/lib/actions/proposal.ts", root), "utf8");
const resourceActions = await readFile(new URL("apps/portal/src/lib/actions/resources.ts", root), "utf8");
const agentPreview = await readFile(new URL("apps/portal/src/lib/actions/agent-preview.ts", root), "utf8");
const brainRoute = await readFile(new URL("apps/portal/src/app/api/brain/[agentId]/chat/completions/route.ts", root), "utf8");
const brainCore = await readFile(new URL("apps/portal/src/lib/brain/chat-completion-core.ts", root), "utf8");
const meetingReceiptSource = await readFile(new URL("apps/portal/src/lib/meetings/session-receipt.ts", root), "utf8");
const paidEffectsSource = await readFile(new URL("apps/portal/src/lib/paid-effects/index.ts", root), "utf8");
const videoClient = await readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/video-call.tsx", root), "utf8");
const presentationClient = await readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/presentation-room.tsx", root), "utf8");
const meetingClient = await readFile(new URL("apps/portal/src/app/(app)/agentes/[id]/testar/external-meeting.tsx", root), "utf8");
const supabasePortalIntegration = await readFile(new URL("scripts/supabase-portal-integration.mjs", root), "utf8");
const healthRoute = await readFile(new URL("apps/portal/src/app/api/health/route.ts", root), "utf8");
const railway = JSON.parse(await readFile(new URL("railway.json", root), "utf8"));
const readiness = await import("../../apps/portal/src/app/api/ready/checks.ts");
const effects = await import("../../apps/portal/src/lib/paid-effects/index.ts");

test("all Tavus and Recall creation surfaces use the durable reservation boundary", () => {
  for (const source of [leadRoute, recallRoute, videoActions, meetingActions]) {
    assert.match(source, /beginProviderEffect/);
    assert.match(source, /commit(?:Known)?ProviderEffect/);
  }
  for (const source of [leadRoute, recallRoute, videoActions, meetingActions]) {
    assert.match(source, /prepareTavusWebhookCallback/);
  }
  assert.match(meetingActions, /provider:\s*"recall"[\s\S]*acquireProviderDispatch/);
  // Tavus has a specialised atomic fence: callback capability binding moves
  // reserved -> provider_in_flight and returns the sole bearer that reaches
  // the provider. A generic provider fence before it would make binding fail.
  assert.match(transcriptRegister, /Binding is itself the atomic provider dispatch fence/);
  assert.match(migration, /portal_bind_tavus_webhook_capability_service[\s\S]*state='reserved'/);
  assert.match(videoActions, /tavus:video"\)[\s\S]*prepareTavusWebhookCallback\(reservation\.reservationId\)[\s\S]*port\.createConversation/);
  assert.match(videoActions, /tavus:presentation"\)[\s\S]*prepareTavusWebhookCallback\(reservation\.reservationId\)[\s\S]*port\.createConversation/);
  assert.match(leadRoute, /tavus:institutional-lead-video"\)[\s\S]*prepareTavusWebhookCallback\(reservation\.reservationId\)[\s\S]*port\.createConversation/);
  assert.match(meetingActions, /createVideoConversation:[\s\S]*prepareTavusWebhookCallback\(tavusReservation\.reservationId[\s\S]*tavusPort\.createConversation/);
  assert.match(recallRoute, /prepareTavusWebhookCallback\(reservationId[\s\S]*tavusPort\.createConversation/);
  assert.doesNotMatch(videoActions, /acquireProviderDispatch/);
  assert.doesNotMatch(leadRoute, /acquireProviderDispatch/);
  assert.match(meetingActions, /provider:\s*"recall"/);
  assert.match(meetingActions, /provider:\s*"tavus"/);
  assert.doesNotMatch(leadRoute, /count:\s*"exact"/);
});

test("paid outliers are closed until they own a durable intent and AI validates before dispatch", () => {
  assert.doesNotMatch(agentVideo, /createTavusVideoConversationPort|\.createPersona\(|attachToolsToPersona\(/);
  assert.match(agentVideo, /durable_persona_intent_required/);
  assert.doesNotMatch(proposalActions, /createProspectCheckoutSession/);
  assert.match(proposalActions, /closing_proposal_checkout_blocked/);

  const ingestPreflight = resourceActions.lastIndexOf("assertEmbeddingInputsWithinReservedBudget");
  const ingestReservation = resourceActions.indexOf("executeReservedAiUsage({");
  assert.equal(ingestPreflight >= 0 && ingestPreflight < ingestReservation, true,
    "knowledge input must be bounded before its reservation can reach OpenRouter");
  const previewPreflight = agentPreview.lastIndexOf("prepareEmbeddingQueryForReservedUsage");
  const previewBegin = agentPreview.indexOf("const retrievalReservationResult = await beginAiUsage({");
  assert.equal(previewPreflight >= 0 && previewPreflight < previewBegin, true,
    "chat retrieval input must be bounded before the reservation fence");
  const brainPreflight = brainRoute.lastIndexOf("prepareEmbeddingQueryForReservedUsage");
  const brainBegin = brainRoute.indexOf("const begin = await beginAiUsage({");
  assert.equal(brainPreflight >= 0 && brainPreflight < brainBegin, true,
    "video retrieval input must be bounded before the reservation fence");
  const corePreflight = brainCore.lastIndexOf("assertGenerationFitsReservedInput");
  const generate = brainCore.lastIndexOf("deps.generate");
  assert.equal(corePreflight >= 0 && corePreflight < generate, true,
    "generation context must be bounded before the provider callback");
});

test("reservation schema is tenant-composite, service-only and has an unknown barrier without effect expiry", () => {
  assert.match(migration, /create table public\.provider_effect_reservations/);
  assert.match(migration, /unique \(tenant_id, id\)/);
  assert.match(migration, /foreign key\(tenant_id,recall_reservation_id\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_tenant_id::text, 0\)\)/);
  assert.match(migration, /'provider_in_flight','committed','released','unknown','cleanup_pending','completed'/);
  const reservationTable = migration.match(/create table public\.provider_effect_reservations \([\s\S]*?\n\);/)?.[0] ?? "";
  assert.doesNotMatch(reservationTable, /\beffect_expires_at\b|\bprovider_lease_until\b/);
  assert.match(reservationTable, /reconciliation_lease_until/, "reconciler lease does not release or re-dispatch an unknown effect");
  assert.match(migration, /revoke all on table public\.provider_effect_reservations from public, anon, authenticated/);
});

test("all failures after the provider fence remain unknown", () => {
  for (const error of [
    { code: "provider_rejected", httpStatus: 400 },
    { code: "provider_rejected", httpStatus: 401 },
    { code: "provider_rejected", httpStatus: 404 },
    { code: "provider_rejected", httpStatus: 422 },
    { code: "provider_rejected" },
    { code: "provider_timeout" },
    { code: "provider_unavailable" },
  ]) assert.equal(effects.deterministicProviderRejection(error), false);
  assert.doesNotMatch(paidEffectsSource, /fenceProviderFailure[\s\S]{0,400}releaseProviderEffect/);
  assert.match(migration, /state='unknown'/);
  assert.match(migration, /compensation_confirmed/);
});

test("human paid intents generate one command id at the client boundary and server code has no clock buckets", () => {
  for (const source of [videoClient, presentationClient, meetingClient]) assert.match(source, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(videoActions, /stableEffectKey|Date\.now\(\)\s*\/\s*VIDEO_CONVERSATION_DEDUP/);
  assert.match(meetingActions, /meeting-join:\$\{tenantId\}:\$\{commandId\}/);
  assert.match(meetingActions, /meetingRelatedRef = opaqueMeetingReference\(commandId\)/);
  assert.match(meetingActions, /p_meeting_ref: meetingRelatedRef/);
  assert.doesNotMatch(meetingActions, /p_meeting_url:/);
  assert.match(meetingActions, /prepareAgentFaceStage[\s\S]*roomUrl: conversation\.conversationUrl[\s\S]*url: stage\.stageUrl/);
  assert.doesNotMatch(meetingActions, /agentFaceStageUrl\(conversation\.conversationUrl\)/);
  assert.doesNotMatch(meetingActions, /relatedRef:\s*meetingUrl|conversation\.conversationUrl,\s*meetingUrl|null,\s*meetingUrl/);
  for (const source of [leadRoute, videoActions, meetingActions]) assert.match(source, /retryReleasedProviderEffect/);
  assert.doesNotMatch(meetingActions, /releaseProviderEffect\([^\n]*reconciliation_absent|releaseProviderEffect\([^\n]*compensation_confirmed/);
});

test("operator termination has a durable lease/receipt and never exposes refs to the browser", async () => {
  assert.match(paidEffectsSource, /persistCleanup[\s\S]*?voidBilling[\s\S]*?input\.terminate\(\)[\s\S]*?cleanupPersisted && billingVoided && providerTerminated[\s\S]*?reconcile/);
  assert.match(videoActions, /compensateCommittedProviderEffect[\s\S]*?terminate:\s*\(\) => port\.endConversation/);
  assert.match(leadRoute, /compensateCommittedProviderEffect[\s\S]*?terminate:\s*\(\) => port\.endConversation/);
  assert.match(meetingActions, /provider:\s*"tavus"[\s\S]*?terminate:\s*\(\) => tavusPort\.endConversation/);
  assert.match(meetingActions, /provider:\s*"recall"[\s\S]*?terminate:\s*\(\) => recallPort\.leaveCall/);
  const terminationMigration = await readFile(new URL("../../database/supabase-only/0046_provider_effect_termination_fence.sql", import.meta.url), "utf8");
  assert.match(terminationMigration, /create table public\.provider_effect_termination_receipts/);
  assert.match(terminationMigration, /force row level security/);
  assert.match(terminationMigration, /tenant admin membership required/);
  assert.match(terminationMigration, /state='completed'[\s\S]*state='committed'/);
  assert.match(paidEffectsSource, /terminateProviderEffectForOperator/);
  assert.doesNotMatch(videoActions, /findProviderEffectReservation|completeProviderEffect\(/);
  assert.doesNotMatch(meetingActions, /findProviderEffectReservation|completeProviderEffect\(/);
  assert.match(meetingActions, /Promise\.allSettled\(requests\)/);
  assert.match(meetingActions, /const tavusRequested = true/);
  assert.match(meetingActions, /TAVUS_API_KEY is not configured for an active provider termination/,
    "missing Tavus configuration is retryable only after a durable active-leg grant");
  assert.match(meetingActions, /const tavusStopped = tavusRequested && \(tavus\?\.outcome === "accepted" \|\| tavus\?\.outcome === "not_started"\)/,
    "a rejected requested Tavus leg must remain pending instead of being reported as stopped");
  assert.match(meetingActions, /stopped: recallStopped && tavusStopped/,
    "external meeting cannot report stopped while either provider leg remains unresolved");
  assert.match(paidEffectsSource, /PORTAL_PROVIDER_TERMINATION_ENABLED[\s\S]{0,180}outcome: "disabled"/,
    "provider termination stays dark-launched until explicitly enabled");
});

test("Tavus billing is held until authenticated human participation; Recall waits for camera receipt", () => {
  assert.match(videoActions, /registerTranscriptPlaceholder/);
  assert.doesNotMatch(videoActions, /activateProviderEffectBilling/);
  assert.match(videoActions, /billing stays held until the[\s\S]*transcript callback proves a human user turn/);
  assert.match(meetingActions, /alreadyActivated[\s\S]*portal_record_meeting_bot_session_service/);
  assert.match(meetingActions, /alreadyActivated[\s\S]*conversationUrl:\s*tavusReservation\?\.providerUrl/);
  assert.equal((meetingActions.match(/return \{ conversationUrl: null, scheduled:/g) ?? []).length >= 2, true,
    "held meeting delivery never exposes the provider room before signed camera evidence");
  assert.doesNotMatch(meetingActions, /activateProviderEffectBilling/);
  assert.match(leadRoute, /registerTranscriptPlaceholder[\s\S]*billing remains held[\s\S]*NextResponse\.json\(\{ url:/);
  assert.doesNotMatch(leadRoute, /activateProviderEffectBilling/);
  assert.match(recallRoute, /portal_mark_sentinel_camera_started_service[\s\S]*activateProviderEffectBilling/);
  assert.match(recallRoute, /context\.state === "camera_started"[\s\S]*activateProviderEffectBilling[\s\S]*return "noop"/);
});

test("commit atomically writes attributed cost while activation owns durable overage delivery", () => {
  const body = migration.match(/create or replace function public\.portal_commit_provider_effect_service[\s\S]*?end; \$\$;/)?.[0] ?? "";
  assert.match(body, /insert into public\.cost_events/);
  assert.match(body, /provider_request_ref/);
  assert.doesNotMatch(body, /insert into public\.billing_usage_outbox/);
  const activation = migration.match(/create or replace function public\.portal_activate_provider_effect_billing_service[\s\S]*?end; \$\$;/)?.[0] ?? "";
  assert.match(activation, /insert into public\.billing_usage_outbox/);
  assert.match(activation, /customer_delivery_state='activated'[\s\S]*return jsonb_build_object\('activated',true,'replayed',true/);
  assert.doesNotMatch(activation, /on conflict[\s\S]*do nothing/);
  assert.match(supabasePortalIntegration, /activationReplay[\s\S]*replayed: true[\s\S]*count\(\*\) FROM public\.billing_usage_outbox/);
  assert.match(migration, /portal_lease_billing_usage_service/);
  assert.match(migration, /for update skip locked/);
});

test("Recall webhook dedupe has a single fenced winner and retry-safe release", () => {
  assert.match(migration, /claim_token app\.uuid_v7 not null/);
  assert.match(migration, /if v_inserted then return jsonb_build_object\('outcome','claimed'\)[\s\S]*jsonb_build_object\('outcome','busy'\)/);
  assert.match(recallRoute, /portal_claim_recall_webhook_service/);
  assert.match(recallRoute, /portal_complete_recall_webhook_service/);
  assert.match(recallRoute, /portal_release_recall_webhook_service/);
  assert.match(recallRoute, /releaseForRetry = async[\s\S]*status:\s*503/);
  assert.match(recallRoute, /releaseForRetry\("sentinel_attach_pending"\)/);
});

test("Tavus capability preflight authorizes before body acquisition and claim binds observed time", () => {
  const preflightAt = tavusRoute.indexOf('supabase.rpc("portal_preflight_tavus_webhook_service"');
  const bodyAt = tavusRoute.indexOf("readBoundedTextBody(request, MAX_TAVUS_WEBHOOK_BYTES)");
  const parserAt = tavusRoute.indexOf("parseTavusTranscriptEvent(body)");
  const claimAt = tavusRoute.indexOf('supabase.rpc("portal_claim_tavus_webhook_service"');
  assert.equal(preflightAt >= 0 && preflightAt < bodyAt && bodyAt < parserAt && parserAt < claimAt, true);
  assert.match(tavusRoute, /TAVUS_WEBHOOK_GLOBAL_RATE_LIMIT_KEY[\s\S]*tavus-webhook:capability:\$\{capabilityHash\}/);
  assert.match(tavusRoute, /parsed\.conversationId !== preflight\.providerRef/);
  assert.match(tavusRoute, /portal_claim_tavus_webhook_service[\s\S]{0,420}p_observed_at:\s*parsed\.observedAt/);
  assert.match(transcriptRegister, /Object\.keys\(record\)\.sort\(\)[\s\S]*capabilityExpiresAt/);
  assert.match(transcriptRegister, /callbackUrl:[\s\S]*capabilityHash,[\s\S]*capabilityExpiresAt:/);
});

test("sentinel state resumes conversation_created and rejects terminal creation", () => {
  assert.match(migration, /sentinel_camera_state in \('not_requested','conversation_created','camera_started','cleanup_pending'\)/);
  assert.match(migration, /status in \('ended','failed'\).*'terminal'/);
  assert.match(recallRoute, /context\.state !== "conversation_created"/);
  assert.match(recallRoute, /portal_mark_sentinel_camera_started_service/);
  assert.match(migration, /p_tavus_conversation_id is null then 'not_requested' else 'conversation_created'/);
  assert.doesNotMatch(migration, /p_tavus_conversation_id is null then 'not_requested' else 'camera_started'/);
  assert.match(migration, /provider_bot_id=p_recall_bot_id,terminal_status=p_status/);
  assert.equal((migration.match(/pg_advisory_xact_lock\(hashtextextended\('recall-bot:'\|\|p_recall_bot_id,0\)\)/g) ?? []).length, 2,
    "terminal delivery and session registration serialize on the same bot-scoped lock");
  assert.match(migration, /'terminal',v_terminal_status is not null/);
  assert.match(meetingActions, /const receipt = await enforceMeetingSessionReceipt\(data, tavusPort\)/);
  assert.equal((meetingActions.match(/enforceMeetingSessionReceipt\(data, tavusPort\)/g) ?? []).length, 2);
  assert.match(meetingActions, /if \(receipt\.terminal\)[\s\S]{0,260}conversationUrl: null/);
  assert.match(meetingActions, /terminalBeforeDelivery[\s\S]*conversationUrl: null/);
  assert.match(meetingActions, /failureCode: "meeting_terminal_before_persistence"[\s\S]*endConversation/);
  assert.match(meetingReceiptSource, /Object\.keys\(record\)\.sort\(\)[\s\S]*tavusCleanupRequired/);
  assert.match(migration, /customer_delivery_state='voided'/);
  assert.match(migration, /billing_usage_outbox set status='voided',terminal_reason='meeting_terminal_before_delivery'/);
  assert.match(migration, /terminal billing delivery is already in flight/);
  assert.match(migration, /'recall:terminal:'\|\|p_recall_bot_id/);
  assert.match(recallRoute, /p_delivery_id:\s*deliveryId/);
  assert.match(recallRoute, /p_claim_token:\s*deliveryClaimToken/);
  assert.match(recallRoute, /activateProviderEffectBilling\(context\.recallReservationId\)[\s\S]*activateProviderEffectBilling\(reservationId\)/);
});

test("strict transcript contract is expand then contract and list limit is deterministic", () => {
  const registerTranscript = migration.match(/create or replace function public\.portal_register_provider_transcript_service[\s\S]*?end; \$\$;/)?.[0] ?? "";
  assert.match(contractMigration, /jsonb_typeof\(p_turns\) is distinct from 'array'/);
  assert.match(contractMigration, /jsonb_object_keys\(e\)\)<>2/);
  assert.match(migration, /order by t\.started_at desc,t\.id desc limit v_limit/);
  assert.match(migration, /provider transcript ownership conflict/);
  assert.doesNotMatch(registerTranscript, /v_existing\.id is distinct from p_id/);
  assert.match(contractMigration, /p_surface is distinct from 'chat'/);
  assert.match(contractMigration, /authenticatedProviderTranscriptPreclaimBlocked/);
});

test("terminal meeting transitions complete reservations while every found in_call replay consults sentinel state", () => {
  assert.match(migration, /id in \(v_session\.recall_reservation_id,v_session\.tavus_reservation_id\)[\s\S]*state='committed'/);
  assert.match(recallRoute, /if \(found && status === "in_call" && IN_CALL_EVENTS/);
  assert.doesNotMatch(recallRoute, /if \(applied && status === "in_call"/);
  assert.match(recallRoute, /context\.outcome === "terminal"[\s\S]{0,160}return "noop"/);
});

test("Recall webhook requires signed HMAC and boolean delivery receipts", () => {
  assert.match(recallRoute, /isRecallWebhookSecretConfigured\(webhookSecret\)/);
  assert.doesNotMatch(recallRoute, /RECALL_WEBHOOK_TOKEN|searchParams\.get\("token"\)/);
  assert.match(recallRoute, /portal_complete_recall_webhook_service[\s\S]{0,240}data !== true/);
  assert.match(recallRoute, /portal_release_recall_webhook_service[\s\S]{0,300}data !== true/);
});

test("liveness is independent and readiness requires schema 43 plus real-mode HMAC", () => {
  assert.doesNotMatch(healthRoute, /process\.env|createServiceRoleClient/);
  assert.equal(railway.deploy.healthcheckPath, "/api/ready");
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    PORTAL_PUBLIC_URL: "https://closer.axtroai.com",
    RECALL_API_KEY: "recall-key",
    RECALL_API_REGION: "us-west-2",
    RECALL_TRANSCRIPT_DOWNLOAD_HOSTS: "recallai-production-bot-data.s3.amazonaws.com",
    RECALL_WEBHOOK_SECRET: `whsec_${Buffer.from("x".repeat(32)).toString("base64")}`,
    TAVUS_API_KEY: "tavus-key",
    OPENROUTER_API_KEY: "openrouter-key",
    OPENROUTER_MODEL: "anthropic/claude-haiku-4.5",
    AI_USAGE_RECONCILE_SECRET: "ai-usage-reconcile-secret-test",
    AXTRO_DEPLOYMENT_ID: "deployment-integrity-test",
    BILLING_USAGE_OUTBOX_ENABLED: "false",
    PROVIDER_EFFECT_RECONCILER_ENABLED: "true",
    PROVIDER_EFFECT_RECONCILE_SECRET: "z".repeat(24),
  };
  assert.equal(readiness.readinessConfigOk(readiness.readinessConfig(base)), false, "real mode fails closed when durable billing dispatch is disabled");
  for (const broken of [
    { RECALL_WEBHOOK_SECRET: "whsec_not-base64!!!!" },
    { RECALL_API_KEY: "" },
    { RECALL_API_REGION: "moon-1" },
    { RECALL_TRANSCRIPT_DOWNLOAD_HOSTS: "127.0.0.1" },
    { TAVUS_API_KEY: "" },
    { OPENROUTER_MODEL: "unreviewed/expensive-model" },
    { AI_USAGE_RECONCILE_SECRET: "short" },
    { BILLING_USAGE_OUTBOX_ENABLED: "yes" },
    { STRIPE_PRICE_PILOTO_BASE: "price_hostile_suffix" },
  ]) assert.equal(readiness.readinessConfigOk(readiness.readinessConfig({ ...base, ...broken })), false);
  assert.equal(readiness.readinessConfigOk(readiness.readinessConfig({ ...base, BILLING_USAGE_OUTBOX_ENABLED: "true" })), false);
  assert.equal(readiness.readinessConfigOk(readiness.readinessConfig({
    ...base,
    BILLING_USAGE_OUTBOX_ENABLED: "true",
    BILLING_DISPATCH_SECRET: "y".repeat(24),
    STRIPE_SECRET_KEY: "sk_test_1234567890",
    STRIPE_WEBHOOK_SECRET: "whsec_1234567890abcdef",
    STRIPE_CONVERSATION_OVERAGE_EVENT_NAME: "axtro_conversation_overage",
    STRIPE_PRICE_PILOTO_BASE: "price_PilotoBase",
    STRIPE_PRICE_PILOTO_OVERAGE: "price_PilotoOverage",
    STRIPE_PRICE_CRESCIMENTO_BASE: "price_CrescimentoBase",
    STRIPE_PRICE_CRESCIMENTO_OVERAGE: "price_CrescimentoOverage",
    STRIPE_PRICE_ESCALA_BASE: "price_EscalaBase",
    STRIPE_PRICE_ESCALA_OVERAGE: "price_EscalaOverage",
  })), true);
  assert.equal(readiness.readinessConfigOk(readiness.readinessConfig({
    NEXT_PUBLIC_SUPABASE_URL: base.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: base.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: base.SUPABASE_SERVICE_ROLE_KEY,
    PORTAL_FAKE_PROVIDERS: "1",
    BILLING_USAGE_OUTBOX_ENABLED: "false",
    PROVIDER_EFFECT_RECONCILER_ENABLED: "false",
  })), true);
});
