import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

const root = new URL("../../", import.meta.url).pathname;

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function sourceFiles(path) {
  const absolute = join(root, path);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.tsx?$/.test(entry.name) ? [child] : [];
  });
}

function relativeTypeScriptImport(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(root, dirname(importer), specifier);
  const candidates = /\.tsx?$/.test(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  const target = candidates.find((candidate) => existsSync(candidate));
  return target === undefined ? null : relative(root, target);
}

function importClosure(entries) {
  const files = new Set(entries);
  const queue = [...entries];
  while (queue.length > 0) {
    const importer = queue.shift();
    const source = read(importer);
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const target = relativeTypeScriptImport(importer, match[1]);
      if (target !== null && !files.has(target)) {
        files.add(target);
        queue.push(target);
      }
    }
  }
  return [...files];
}

test("landing is static and starts the isolated demo without shared auth", () => {
  const landing = read("apps/portal/src/app/page.tsx");
  assert.match(landing, /action="\/demo\/start" method="post"/);
  assert.doesNotMatch(landing, /createClient|getPublicSessionUser|signInDemo|DEMO_EMAIL|DEMO_PASSWORD/);
  assert.equal(existsSync(join(root, "apps/portal/src/lib/actions/demo.ts")), false);
  assert.equal(existsSync(join(root, "apps/portal/src/lib/actions/public-demo.ts")), false);
  assert.match(landing, /simulação isolada/i);
  assert.match(landing, /sem efeitos reais/i);
});

test("public demo route has a separate shell and no customer or paid-effect imports", () => {
  const session = read("apps/portal/src/lib/public-demo/server-session.ts");
  const runtime = read("apps/portal/src/lib/public-demo/state-token.ts");
  const page = read("apps/portal/src/app/(public-demo)/demo/page.tsx");
  const component = read("apps/portal/src/app/(public-demo)/demo/public-demo-workspace.tsx");
  const restrictedFiles = importClosure([
    ...sourceFiles("apps/portal/src/lib/public-demo"),
    ...sourceFiles("apps/portal/src/app/(public-demo)"),
  ]);
  const sources = restrictedFiles.map(read).join("\n");

  assert.match(page, /robots: \{ index: false, follow: false \}/);
  assert.match(session, /httpOnly: true/);
  assert.match(session, /sameSite: "lax"/);
  assert.match(session, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(session, /path: "\/demo"/);
  assert.match(session, /PUBLIC_DEMO_STATE_SECRET_ENV/);
  assert.match(session, /PUBLIC_DEMO_EDGE_POLICY_ATTESTATION_ENV/);
  assert.match(runtime, /PORTAL_PUBLIC_DEMO_STATE_SECRET/);
  assert.match(component, /fetch\("\/demo\/command"/);
  assert.match(component, /action="\/demo\/end" method="post"/);
  assert.doesNotMatch(sources, /["']use server["']/);
  assert.doesNotMatch(sources, /Next-Action/);
  assert.match(component, /Sem Supabase Auth/);
  assert.match(component, /Sem efeitos reais/);
  assert.match(component, /Um agente fictício/);
  assert.match(component, /Três fontes sintéticas/);
  assert.match(component, /Quatro etapas simuladas/);
  assert.doesNotMatch(component, /Dois agentes fictícios|Quatro conversas simuladas/);
  const imports = [...sources.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  const safeImports = new Set([
    "@/lib/public-demo",
    "@/lib/public-demo/client-result",
    "@/lib/public-demo/request",
    "@/lib/public-demo/server-session",
    "@axtro/contracts-ts",
    "@axtro/domain",
    "next",
    "next/headers",
    "next/image",
    "next/navigation",
    "next/server",
    "node:crypto",
    "react",
  ]);
  for (const specifier of imports) {
    assert.doesNotMatch(
      specifier,
      /@supabase|supabase\/|portal-data|paid-effects|provider-|billing|calendar|email|meeting-bot|transcript|service-role/i,
    );
    assert.equal(
      specifier.startsWith("./") || specifier.startsWith("../") || safeImports.has(specifier),
      true,
      `Import fora da allowlist da demo pública: ${specifier}`,
    );
  }
  assert.doesNotMatch(sources, /signInWithPassword|ensureTenantProvisioned/);
});

test("public demo mutations use dedicated bounded route handlers instead of forwardable Server Actions", () => {
  const startRoute = read("apps/portal/src/app/(public-demo)/demo/start/route.ts");
  const commandRoute = read("apps/portal/src/app/(public-demo)/demo/command/route.ts");
  const endRoute = read("apps/portal/src/app/(public-demo)/demo/end/route.ts");
  const requestGuard = read("apps/portal/src/lib/public-demo/request.ts");
  const page = read("apps/portal/src/app/(public-demo)/demo/page.tsx");
  const component = read("apps/portal/src/app/(public-demo)/demo/public-demo-workspace.tsx");

  assert.match(startRoute, /export async function POST/);
  assert.match(startRoute, /isSameOriginPublicDemoMutationRequest/);
  assert.match(startRoute, /NextResponse\.redirect\(target, 303\)/);
  assert.match(commandRoute, /isSameOriginPublicDemoMutationRequest/);
  assert.match(commandRoute, /readBoundedPublicDemoCommand/);
  assert.match(commandRoute, /"cache-control": "no-store, max-age=0"/);
  assert.match(endRoute, /export async function POST/);
  assert.match(endRoute, /isSameOriginPublicDemoMutationRequest/);
  assert.match(endRoute, /NextResponse\.redirect\(new URL\("\/", request\.url\), 303\)/);
  assert.match(requestGuard, /PUBLIC_DEMO_MAX_COMMAND_BODY_BYTES = 1024/);
  assert.match(requestGuard, /content-length/);
  assert.match(requestGuard, /TextDecoder\("utf-8", \{ fatal: true \}\)/);
  assert.match(page, /action="\/demo\/start" method="post"/);
  assert.match(component, /fetch\("\/demo\/command"/);
  assert.match(component, /action="\/demo\/end" method="post"/);
  assert.doesNotMatch([startRoute, commandRoute, endRoute, page, component].join("\n"), /["']use server["']/);
});

test("demo bypass is exact while customer routes remain behind session middleware", () => {
  const proxy = read("apps/portal/src/proxy.ts");
  const middleware = read("apps/portal/src/lib/supabase/middleware.ts");
  assert.match(proxy, /pathname === "\/" \|\| pathname === "\/demo" \|\| pathname\.startsWith\("\/demo\/"\)/);
  assert.match(middleware, /request\.nextUrl\.pathname === "\/demo"/);
  assert.match(middleware, /if \(!user && !isAuthRoute\)/);
  assert.doesNotMatch(proxy, /pathname\.startsWith\("\/demo"\)(?!\/)/);
});

test("runtime and E2E credentials are separated from the public demo", () => {
  const envExample = read("apps/portal/.env.example");
  const authenticatedE2e = read("apps/portal/e2e/portal.spec.ts");
  const authenticatedPlaywright = read("apps/portal/playwright.config.ts");
  const publicPlaywright = read("apps/portal/playwright.public.config.ts");
  const workflow = read(".github/workflows/docs-qa.yml");
  assert.match(envExample, /PORTAL_PUBLIC_DEMO_STATE_SECRET=/);
  assert.match(envExample, /E2E_TENANT_ADMIN_EMAIL=/);
  assert.match(envExample, /E2E_TENANT_ADMIN_PASSWORD=/);
  assert.doesNotMatch(envExample, /^DEMO_EMAIL=|^DEMO_PASSWORD=/m);
  assert.match(authenticatedE2e, /E2E_TENANT_ADMIN_EMAIL/);
  assert.match(authenticatedE2e, /E2E_TENANT_ADMIN_PASSWORD/);
  assert.doesNotMatch(authenticatedE2e, /env\.DEMO_EMAIL|env\.DEMO_PASSWORD/);
  for (const config of [authenticatedPlaywright, publicPlaywright]) {
    assert.match(
      config,
      /PORTAL_PUBLIC_DEMO_STATE_SECRET:\s*"000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"/,
    );
    assert.match(
      config,
      /PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION:[\s\S]{0,180}axtro-public-demo-edge\/v3;scope=global;post-start=120\/60s;post-command-end=600\/60s;get-head-demo=900\/60s;concurrency=32;queue=0;reject=429/,
    );
    assert.match(config, /screenshot:\s*"off"/);
    assert.match(config, /trace:\s*"off"/);
  }
  assert.doesNotMatch(workflow, /upload-artifact|test-results\/|playwright-report/);
  assert.match(workflow, /E2E_TENANT_ADMIN_EMAIL/);
  assert.match(workflow, /fallback de migração dos nomes antigos/);
});
