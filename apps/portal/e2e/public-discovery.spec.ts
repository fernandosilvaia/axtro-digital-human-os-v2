import { expect, test, type Page } from "@playwright/test";

const CANONICAL_ORIGIN = "https://closer.axtroai.com";
const PUBLIC_DOCUMENTS = ["/robots.txt", "/sitemap.xml", "/llms.txt", "/llms-full.txt", "/termos", "/privacidade"] as const;
const PRIVATE_PATHS = ["/dashboard", "/agentes", "/conhecimento", "/configuracoes", "/login", "/signup", "/api/"] as const;
const FORBIDDEN_STRUCTURED_DATA_KEYS = new Set(["aggregaterating", "review", "ratingvalue", "guarantee"]);

function canonicalUrl(path: "/" | "/precos") {
  return path === "/" ? CANONICAL_ORIGIN : `${CANONICAL_ORIGIN}${path}`;
}

async function expectCanonicalMetadata(page: Page, path: "/" | "/precos") {
  await expect(page).toHaveTitle(/Axtro Digital Human OS/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonicalUrl(path));
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index, follow/i);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Axtro/);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonicalUrl(path));
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectKeyboardReachableCta(page: Page) {
  const demoCta = page.getByRole("button", { name: /Ver demonstração ao vivo/ });
  await page.locator("body").focus();

  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    if (await demoCta.evaluate((element) => document.activeElement === element)) {
      await expect(demoCta).toBeFocused();
      expect(await demoCta.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== "none" && style.outlineWidth !== "0px";
      })).toBe(true);
      return;
    }
  }

  throw new Error("CTA público não foi alcançável por teclado.");
}

function assertNoForbiddenStructuredData(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoForbiddenStructuredData);
    return;
  }

  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      expect(FORBIDDEN_STRUCTURED_DATA_KEYS.has(key.toLowerCase()), `Structured data não pode declarar ${key}`).toBe(false);
      if (key === "@type") {
        expect(child, "Structured data não pode declarar Review").not.toBe("Review");
      }
      assertNoForbiddenStructuredData(child);
    }
  }
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test.describe(`superfícies públicas em ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("landing e preços preservam metadata, conteúdo verificável e navegação por teclado", async ({ page }) => {
      await page.goto("/", { waitUntil: "domcontentloaded", timeout: 8_000 });
      await expectCanonicalMetadata(page, "/");
      await expect(page.getByRole("heading", { name: /O que você precisa saber/i })).toBeVisible();
      await expect(page.locator("#faq details").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectKeyboardReachableCta(page);

      const structuredData = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(structuredData.length).toBeGreaterThan(0);
      structuredData.forEach((document) => assertNoForbiddenStructuredData(JSON.parse(document)));

      await page.goto("/precos");
      await expectCanonicalMetadata(page, "/precos");
      await expectNoHorizontalOverflow(page);
      await expect(page.getByRole("link", { name: "Começar" }).first()).toBeVisible();
    });
  });
}

test("documentos e endpoints de descoberta são públicos, consistentes e sem superfície privada", async ({ request }) => {
  const documents = new Map<string, string>();

  for (const path of PUBLIC_DOCUMENTS) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} deve responder sem redirecionar`).toBe(200);
    expect(response.headers().location, `${path} não deve redirecionar`).toBeUndefined();
    documents.set(path, await response.text());
  }

  const robots = documents.get("/robots.txt") ?? "";
  expect(robots).toMatch(/User-Agent:\s*GPTBot\s*\nDisallow:\s*\//i);
  expect(robots).toMatch(/User-Agent:\s*ClaudeBot\s*\nDisallow:\s*\//i);
  expect(robots).toMatch(/User-Agent:\s*Google-Extended\s*\nDisallow:\s*\//i);
  expect(robots).toMatch(/User-Agent:\s*CCBot\s*\nDisallow:\s*\//i);
  expect(robots).toMatch(/User-Agent:\s*OAI-SearchBot\s*\nAllow:\s*\//i);
  expect(robots).toMatch(/User-Agent:\s*Claude-SearchBot\s*\nAllow:\s*\//i);
  expect(robots).toMatch(/User-Agent:\s*Claude-User\s*\nAllow:\s*\//i);
  expect(robots).toContain(`${CANONICAL_ORIGIN}/sitemap.xml`);

  // RFC 9309: um bot com bloco próprio usa SÓ esse bloco, sem herdar o
  // disallow do "*" — cada bloco "allow" precisa repetir os paths privados
  // (achado da revisão da Auditoria 360, corrigido junto com robots.ts).
  for (const bot of ["OAI-SearchBot", "Claude-SearchBot", "Claude-User"] as const) {
    const block = robots.match(new RegExp(`User-Agent:\\s*${bot}\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\n|User-Agent:|$)`, "i"))?.[1] ?? "";
    PRIVATE_PATHS.forEach((path) =>
      expect(block, `${bot} deve excluir ${path}`).toMatch(new RegExp(`Disallow:\\s*${path.replace(/\//g, "\\/")}`, "i")),
    );
  }

  const sitemap = documents.get("/sitemap.xml") ?? "";
  expect(sitemap).toContain(`${CANONICAL_ORIGIN}/precos`);
  expect(sitemap).toContain(`${CANONICAL_ORIGIN}/termos`);
  expect(sitemap).toContain(`${CANONICAL_ORIGIN}/privacidade`);
  PRIVATE_PATHS.forEach((path) => expect(sitemap, `Sitemap não pode publicar ${path}`).not.toContain(path));

  for (const path of ["/llms.txt", "/llms-full.txt"] as const) {
    const document = documents.get(path) ?? "";
    expect(document).toContain(CANONICAL_ORIGIN);
    expect(document).not.toContain("railway.app");
  }
});
