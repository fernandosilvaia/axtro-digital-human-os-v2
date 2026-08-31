import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../", import.meta.url);
const action = await readFile(new URL("apps/portal/src/lib/actions/agent-preview.ts", root), "utf8");
const preview = await readFile(
  new URL("apps/portal/src/app/(app)/agentes/[id]/testar/preview-chat.tsx", root),
  "utf8",
);
const readiness = await readFile(new URL("apps/portal/src/app/api/ready/checks.ts", root), "utf8");
const bootstrap = await readFile(new URL("scripts/production-readiness-bootstrap.mjs", root), "utf8");
const envExample = await readFile(new URL("apps/portal/.env.example", root), "utf8");

test("public text preview is a contract-typed fail-closed Server Action", () => {
  assert.match(action, /export async function sendAgentPreviewMessage/);
  assert.match(action, /PortalTextPreviewBrowserCommand/);
  assert.match(action, /Promise<PortalTextPreviewActionResult>/);
  assert.match(action, /outcome: "failure"/);
  assert.match(action, /error: PORTAL_TEXT_PREVIEW_RECOVERY_MESSAGE/);
  assert.match(action, /stateToken: null/);
  assert.match(action, /persistence: "disabled"/);
  assert.doesNotMatch(action, /^import(?!\s+type)\s/m);
  assert.doesNotMatch(action, /process\.env|fetch\(|\.rpc\(|createClient|createServiceRoleClient|beginAiUsage|createOpenRouter|fetchAgents|fetchTenantOverview/);
});

test("text preview UI exposes no control that can submit the legacy action", () => {
  assert.match(preview, /Proteção de privacidade em restauração/);
  assert.doesNotMatch(preview, /"use client"|sendAgentPreviewMessage|<form|<input|<textarea|<button|onSubmit|useActionState/);
});

test("readiness and production bootstrap require the same exact closed configuration", () => {
  assert.match(readiness, /env\.PORTAL_TEXT_PREVIEW_ENABLED === "false"/);
  assert.match(bootstrap, /env\.PORTAL_TEXT_PREVIEW_ENABLED === "false"/);
  assert.match(envExample, /^PORTAL_TEXT_PREVIEW_ENABLED=false$/m);
});
