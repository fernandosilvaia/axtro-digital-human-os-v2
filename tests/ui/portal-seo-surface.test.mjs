import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const portal = join(root, "apps", "portal");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
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

test("portal sitemap and AEO context describe only the public product surface", () => {
  const sitemap = read("apps/portal/src/app/sitemap.ts");
  const llms = read("apps/portal/public/llms.txt");
  const llmsFull = read("apps/portal/public/llms-full.txt");
  const landing = read("apps/portal/src/app/page.tsx");

  assert.match(sitemap, /absoluteUrl\("\/"\)/);
  assert.doesNotMatch(sitemap, /dashboard|agentes|conhecimento|configuracoes/);
  assert.match(llms, /Axtro Digital Human OS/);
  assert.match(llmsFull, /O que não deve ser afirmado/);
  assert.match(landing, /"@type": "FAQPage"/);
  assert.match(landing, /<details className="faq-item" key=\{item\.question\} open>/);
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
