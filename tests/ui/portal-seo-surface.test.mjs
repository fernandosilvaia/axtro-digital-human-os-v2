import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url).pathname;
const portal = join(root, "apps", "portal");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function readDefaultSiteMetadata() {
  const siteModule = pathToFileURL(join(portal, "src", "lib", "site.ts")).href;
  const program = [
    `const site = await import(${JSON.stringify(siteModule)});`,
    "const metadata = site.createPageMetadata({ title: 'Teste', description: 'Saída verificável', path: '/termos' });",
    "console.log(JSON.stringify({ siteUrl: site.SITE_URL, absoluteUrl: site.absoluteUrl('/precos'), metadata }));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: root,
    env: {},
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("public portal SEO surface keeps private routes out of indexing", () => {
  const robots = read("apps/portal/src/app/robots.ts");
  const appLayout = read("apps/portal/src/app/(app)/layout.tsx");
  const landing = read("apps/portal/src/app/page.tsx");

  for (const route of ["/dashboard", "/agentes", "/conhecimento", "/configuracoes", "/api/"]) {
    assert.match(robots, new RegExp(route.replace("/", "\\/")));
  }
  const proxy = read("apps/portal/src/proxy.ts");
  assert.match(proxy, /robots\.txt\|sitemap\.xml\|manifest\.json\|opengraph-image/);
  // Achado real 2026-07-24: llms.txt/llms-full.txt ficaram fora do matcher
  // de exclusão do middleware de auth — o smoke test HTTP pós-deploy pegou
  // um 307 para /login em vez do conteúdo público (quebra o propósito de
  // AEO). Esta asserção de source complementa o teste HTTP real em
  // apps/portal/e2e/portal.spec.ts, que é quem realmente teria pego a falha.
  assert.match(proxy, /llms\.txt\|llms-full\.txt/);
  assert.match(appLayout, /index: false/);
  assert.match(landing, /createPageMetadata/);
  assert.doesNotMatch(landing, /Raízes Finance/);
});

test("public canonical metadata resolves to the branded origin", () => {
  const output = readDefaultSiteMetadata();

  assert.equal(output.siteUrl, "https://closer.axtroai.com");
  assert.equal(output.absoluteUrl, "https://closer.axtroai.com/precos");
  assert.equal(output.metadata.alternates.canonical, "/termos");
  assert.equal(output.metadata.robots.index, true);
  assert.equal(output.metadata.openGraph.url, "https://closer.axtroai.com/termos");
  assert.equal(output.metadata.twitter.images[0], "https://closer.axtroai.com/opengraph-image");
});

test("portal sitemap, legal metadata and AI discovery policy remain internally consistent", () => {
  const sitemap = read("apps/portal/src/app/sitemap.ts");
  const robots = read("apps/portal/src/app/robots.ts");
  const llms = read("apps/portal/public/llms.txt");
  const llmsFull = read("apps/portal/public/llms-full.txt");
  const landing = read("apps/portal/src/app/page.tsx");
  const pricing = read("apps/portal/src/app/precos/page.tsx");
  const privacy = read("apps/portal/src/app/privacidade/page.tsx");
  const terms = read("apps/portal/src/app/termos/page.tsx");

  assert.match(sitemap, /absoluteUrl\("\/"\)/);
  assert.match(sitemap, /"\/termos"/);
  assert.match(sitemap, /"\/privacidade"/);
  assert.doesNotMatch(sitemap, /dashboard|agentes|conhecimento|configuracoes|portal-production-b43e/);
  for (const [crawler, directive] of [
    ["GPTBot", "disallow"],
    ["ClaudeBot", "disallow"],
    ["Google-Extended", "disallow"],
    ["CCBot", "disallow"],
    ["OAI-SearchBot", "allow"],
    ["Claude-SearchBot", "allow"],
    ["Claude-User", "allow"],
  ]) {
    assert.match(robots, new RegExp(`userAgent: "${crawler}", ${directive}: "/"`));
  }
  assert.match(robots, /rules: \[/);
  for (const page of [terms, privacy]) {
    assert.match(page, /createPageMetadata/);
  }
  assert.match(terms, /path: "\/termos"/);
  assert.match(privacy, /path: "\/privacidade"/);
  assert.match(llms, /Axtro Digital Human OS/);
  assert.match(llmsFull, /O que não deve ser afirmado/);
  for (const document of [llms, llmsFull]) {
    assert.match(document, /https:\/\/closer\.axtroai\.com/);
    assert.match(document, /Treinamento de modelos/);
    assert.doesNotMatch(document, /portal-production-b43e\.up\.railway\.app/);
  }
  assert.match(pricing, /sala Axtro/);
  assert.match(pricing, /aguardam rollout com consentimento individual por participante/);
  assert.doesNotMatch(pricing, /reunião externa \(Zoom\/Meet\/Teams\) inclusos/);
  assert.match(privacy, /finalidade for consentida especificamente/);
  assert.match(privacy, /conversa em texto opera sem exigir nenhuma finalidade opcional/);
  assert.match(privacy, /exige consentimento\s+simultâneo a todas as finalidades opcionais/);
  assert.match(landing, /"@type": "FAQPage"/);
  assert.match(landing, /<details className="faq-item" key=\{item\.question\} open>/);
  assert.doesNotMatch(landing, /AggregateRating|"@type": "Review"|Guarantee/);
});

test("manifest and share icons exist with valid image signatures", () => {
  const manifest = JSON.parse(read("apps/portal/public/manifest.json"));
  assert.equal(manifest.lang, "pt-BR");
  assert.equal(manifest.start_url, "/");
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/icon-192.png"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/icon-512.png"));

  for (const file of [
    "public/apple-touch-icon.png",
    "public/icons/icon-192.png",
    "public/icons/icon-512.png",
  ]) {
    const absolutePath = join(portal, file.replace(/^public\//, "public/"));
    assert.equal(existsSync(absolutePath), true, `${file} should exist`);
    const signature = readFileSync(absolutePath).subarray(0, 8);
    assert.deepEqual([...signature], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

test("dashboard exposes a data-backed operational next step", () => {
  const dashboard = read("apps/portal/src/app/(app)/dashboard/page.tsx");
  assert.match(dashboard, /Próximo melhor passo/);
  assert.match(dashboard, /aria-valuenow=\{readinessPercent\}/);
  assert.match(dashboard, /nextAction\.href/);
});
