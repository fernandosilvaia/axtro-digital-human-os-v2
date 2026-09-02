#!/usr/bin/env node
// scripts/provision-tavus-business-tools.mjs
//
// MANUAL-ONLY, ACCOUNT-CONFIGURATION SCRIPT. Read docs/adr/ADR-041-business-
// action-tool-call-funnel.md ("Registro real das tools no Tavus") before
// running this.
//
// Never wire this into CI, cron, GitHub Actions, or a package.json script
// alias. Attaching a tool to a persona changes what that persona's LLM can
// invoke on EVERY future conversation, for EVERY tenant/session that uses
// it -- it is an operation per persona, never per call/session/tenant.
// Running it automatically (e.g. "attach on first call", "re-attach every
// call") would be an inversion of causality: the tool must already be
// attached BEFORE a conversation starts, never during one. This is exactly
// why apps/portal (business-action-tool-call.ts, the client dispatcher) may
// never import attachToolsToPersona/createTavusTool/listTavusTools --
// tests/portal/m5-01-integrity.test.mjs already enforces that invariant for
// attachToolsToPersona; keep it true for the two new functions too.
//
// WHAT THIS SCRIPT DOES:
//   1. Creates the 3 business-action tools (register_lead, propose_meeting_
//      slots, confirm_meeting_slot) on the Tavus account behind TAVUS_API_KEY,
//      using the EXACT JSON Schemas from ADR-041 ("Contrato das tools") --
//      never improvised from metodo-silva.ts or anywhere else. Idempotent:
//      if a tool with the same name already exists, it reuses that tool_id
//      instead of creating a duplicate (GET /v2/tools before every create;
//      a 409 from a genuine race is also treated as "already exists", never
//      as a failure).
//   2. Attaches the 3 resulting tool_ids to every --persona-id passed on the
//      command line, via the existing, already-tested attachToolsToPersona
//      (also idempotent per Tavus's own docs: attaching an already-attached
//      tool is a no-op that still appears in the response).
//   3. Never touches next_slide/previous_slide/go_to_slide (the 3 scene
//      tools already registered manually per D-V2-074) or any persona this
//      script wasn't explicitly told about.
//
// WHAT THIS SCRIPT DELIBERATELY DOES NOT DO:
//   - Guess which personas should receive these tools. --persona-id is
//     required (unless --dry-run) -- decide deliberately, don't default to
//     "every persona this account has". As of D-V2-074 (2026-07-19) the
//     personas already carrying next_slide/previous_slide/go_to_slide were
//     Aurora (pa2dcc2d9c3e), Amanda (pe468ba01ef5) and Rafaela
//     (p8966676f4d2) -- confirm these are still the right, current ids
//     before reusing them; this script does not assume they still are.
//   - Turn on PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED, or any other flag.
//     Running this script only makes the tools callABLE; a tenant still
//     needs the flag on, and the model still needs prompt doctrine telling
//     it when to use them (docs/adr/ADR-041-business-action-tool-call-
//     funnel.md, "Decisões do dono do produto" -- both are separate,
//     explicit decisions).
//
// Usage:
//   TAVUS_API_KEY=... node scripts/provision-tavus-business-tools.mjs \
//     --persona-id=pXXXXXXXXXXXX [--persona-id=pYYYYYYYYYYYY ...] \
//     [--dry-run]
//
// --dry-run lists which of the 3 tools already exist on the account and
// prints what would be created/attached, without creating or attaching
// anything and without requiring the confirm gate below. Safe with a real
// TAVUS_API_KEY -- it only ever calls GET /v2/tools.
//
// Required environment variables for a real (non-dry-run) run:
//   TAVUS_API_KEY
//   TAVUS_BUSINESS_TOOL_PROVISION_CONFIRM=PROVISION-REAL-TAVUS-ACCOUNT
//     Deliberately loud and specific -- not "1" or "true". A human has to
//     read this and mean it, same spirit as
//     TERMINATION_LATENCY_CANARY_CONFIRM in scripts/canaries/.

import process from "node:process";

// Verbatim from docs/adr/ADR-041-business-action-tool-call-funnel.md,
// "Contrato das tools" -- never improvise these from metodo-silva.ts or
// anywhere else. None of the three accepts tenantId/agentId/sessionId/
// presenterId/timezone/search-window/source: the ADR is explicit that the
// server always resolves those from the already-authoritative call session,
// never from the tool call body.
const BUSINESS_TOOLS = Object.freeze([
  Object.freeze({
    name: "register_lead",
    description: "Registra um lead qualificado a partir desta conversa. Use quando tiver nome e (email ou telefone) do prospect.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        contactName: { type: "string", minLength: 1, maxLength: 200 },
        contactEmail: { type: "string", format: "email" },
        contactPhone: { type: "string", maxLength: 32 },
        qualificationSummary: { type: "string", maxLength: 2000 },
      }),
      required: ["contactName"],
    }),
  }),
  Object.freeze({
    name: "propose_meeting_slots",
    description: "Consulta horários disponíveis na agenda do time para uma reunião. Não agenda nada ainda.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        durationMinutes: { type: "integer", enum: [15, 30, 45, 60] },
        contactName: { type: "string", maxLength: 200 },
        contactEmail: { type: "string", format: "email" },
      }),
      required: ["durationMinutes"],
    }),
  }),
  Object.freeze({
    name: "confirm_meeting_slot",
    description: "Confirma um horário já oferecido por propose_meeting_slots. Nunca invente um horário fora dos oferecidos.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        proposalId: { type: "string" },
        slotIndex: { type: "integer", minimum: 0 },
        contactEmail: { type: "string", format: "email" },
      }),
      required: ["proposalId", "slotIndex", "contactEmail"],
    }),
  }),
]);

// Mesmo trio que D-V2-074 já registra, com prova de produção, para
// next_slide/previous_slide/go_to_slide -- e o mesmo que ADR-041 exige
// explicitamente para as 3 tools de negócio (linha 184): o modelo nunca
// fala nada automaticamente ao chamar (a doutrina de prompt cobre isso,
// "deixa eu já checar sua agenda aqui"), e o resultado some silenciosamente
// no contexto da conversa em vez de o modelo narrá-lo palavra por palavra.
const BUSINESS_TOOL_BEHAVIOR = Object.freeze({ onCall: "silent", onResolve: "add_to_context" });

const REQUIRED_CONFIRM_VALUE = "PROVISION-REAL-TAVUS-ACCOUNT";

class ProvisionUsageError extends Error {}
class ProvisionGateError extends Error {}

function usage() {
  return `Usage:
  TAVUS_API_KEY=... node scripts/provision-tavus-business-tools.mjs \\
    --persona-id=<personaId> [--persona-id=<personaId> ...] \\
    [--dry-run]

--dry-run lists which of the 3 business tools already exist on the account
and prints what would be created/attached, without mutating anything and
without requiring the confirm gate below.

Required environment variables for a real (non-dry-run) run:
  TAVUS_API_KEY
  TAVUS_BUSINESS_TOOL_PROVISION_CONFIRM=${REQUIRED_CONFIRM_VALUE}
`;
}

function parseArgs(argv) {
  const args = { personaIds: [], dryRun: false };
  for (const raw of argv) {
    if (raw === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    const match = /^--persona-id=(.+)$/.exec(raw);
    if (!match) throw new ProvisionUsageError(`Unrecognized argument: ${raw}`);
    args.personaIds.push(match[1]);
  }
  if (!args.dryRun && args.personaIds.length === 0) {
    throw new ProvisionUsageError("At least one --persona-id is required (unless --dry-run).");
  }
  return args;
}

function requireEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (value.length === 0) throw new ProvisionGateError(`Missing required env var ${name}`);
  return value;
}

function runGate({ dryRun }) {
  const apiKey = requireEnv("TAVUS_API_KEY");
  if (dryRun) return { apiKey };
  const confirm = (process.env.TAVUS_BUSINESS_TOOL_PROVISION_CONFIRM ?? "").trim();
  if (confirm !== REQUIRED_CONFIRM_VALUE) {
    throw new ProvisionGateError(
      `TAVUS_BUSINESS_TOOL_PROVISION_CONFIRM must be exactly "${REQUIRED_CONFIRM_VALUE}". ` +
        "This is deliberately not a boolean flag -- read the header of this script and " +
        "docs/adr/ADR-041-business-action-tool-call-funnel.md first.",
    );
  }
  return { apiKey };
}

// Imported from the built dist/ output, matching how other root-level
// scripts in this repo consume workspace packages (scripts/production-
// readiness-bootstrap.mjs, scripts/canaries/termination-latency-canary.mjs).
async function loadProviderTavus() {
  return import(new URL("../packages/provider-tavus/dist/index.js", import.meta.url));
}

async function ensureTool(provider, options, tool) {
  const existing = await provider.findTavusToolByExactName(options, tool.name);
  if (existing) {
    console.log(`✓ Tool já existe: ${tool.name} (${existing.toolId})`);
    return existing.toolId;
  }
  const result = await provider.createTavusTool(options, tool, BUSINESS_TOOL_BEHAVIOR);
  if (result.outcome === "already_exists") {
    // Corrida real entre dois runs deste script (ou entre este script e uma
    // criação manual concorrente): o GET acima não viu a tool, mas o POST
    // encontrou um 409. Relista para achar o id -- nunca prossegue sem um
    // toolId real confirmado.
    const afterConflict = await provider.findTavusToolByExactName(options, tool.name);
    if (!afterConflict) {
      throw new Error(`Tavus respondeu 409 (já existe) para "${tool.name}", mas GET /v2/tools não encontrou nenhuma tool com esse nome exato. Aborte e investigue manualmente antes de tentar de novo.`);
    }
    console.log(`✓ Tool já existe (criada por uma corrida concorrente): ${tool.name} (${afterConflict.toolId})`);
    return afterConflict.toolId;
  }
  console.log(`+ Tool criada: ${tool.name} (${result.tool.toolId})`);
  return result.tool.toolId;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { apiKey } = runGate(args);
  const provider = await loadProviderTavus();
  const options = { apiKey };

  if (args.dryRun) {
    console.log("Modo --dry-run: só leitura, nada será criado ou anexado.\n");
    for (const tool of BUSINESS_TOOLS) {
      const existing = await provider.findTavusToolByExactName(options, tool.name);
      console.log(existing
        ? `✓ ${tool.name}: já existe na conta (${existing.toolId})`
        : `. ${tool.name}: seria criada agora`);
    }
    if (args.personaIds.length > 0) {
      console.log(`\nSeria anexado às personas: ${args.personaIds.join(", ")}`);
    } else {
      console.log("\nNenhum --persona-id informado -- rodando só a checagem de tools, sem simular attach.");
    }
    return;
  }

  console.log(`Provisionando as 3 tools de negócio na conta Tavus (ADR-041)...\n`);
  const toolIds = [];
  for (const tool of BUSINESS_TOOLS) {
    toolIds.push(await ensureTool(provider, options, tool));
  }

  console.log(`\nAnexando ${toolIds.length} tools a ${args.personaIds.length} persona(s)...`);
  for (const personaId of args.personaIds) {
    await provider.createTavusVideoConversationPort(options).attachToolsToPersona(personaId, toolIds);
    console.log(`✓ Anexado à persona ${personaId}`);
  }

  console.log("\nPronto. Isto só torna as tools CHAMÁVEIS nessas personas -- para uma call real de");
  console.log("verdade usar isso, ainda falta: (1) PORTAL_BUSINESS_ACTION_BRIDGE_ENABLED=true para o");
  console.log("tenant correspondente; (2) doutrina de quando usar cada tool escrita em metodo-silva.ts");
  console.log("(ver docs/adr/ADR-041-business-action-tool-call-funnel.md, \"Decisões do dono do produto\").");
  console.log("Registre esta execução (personas, tool_ids, data) em docs/operations/DECISIONS_LOG.md --");
  console.log("mesma disciplina que já existe para toda outra mudança de configuração de conta.");
}

main().catch((error) => {
  if (error instanceof ProvisionUsageError) {
    console.error(`${error.message}\n\n${usage()}`);
    process.exitCode = 1;
    return;
  }
  if (error instanceof ProvisionGateError) {
    console.error(`Refused: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
