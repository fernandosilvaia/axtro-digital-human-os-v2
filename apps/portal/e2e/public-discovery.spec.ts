import { expect, test, type Page } from "@playwright/test";

const CANONICAL_ORIGIN = "https://closer.axtroai.com";
const PUBLIC_DOCUMENTS = ["/robots.txt", "/sitemap.xml", "/llms.txt", "/llms-full.txt", "/termos", "/privacidade"] as const;
const CRAWL_EXCLUDED_PATHS = ["/dashboard", "/agentes", "/conversas", "/conhecimento", "/configuracoes", "/auth/", "/api/", "/rosto-agente"] as const;
const NO_INDEX_AUTH_PATHS = ["/login", "/signup", "/recuperar-senha", "/nova-senha"] as const;
const FORBIDDEN_STRUCTURED_DATA_KEYS = new Set(["aggregaterating", "review", "ratingvalue", "guarantee"]);

function canonicalUrl(path: "/" | "/precos") {
  return path === "/" ? CANONICAL_ORIGIN : `${CANONICAL_ORIGIN}${path}`;
}

async function expectCanonicalMetadata(page: Page, path: "/" | "/precos") {
  await expect(page).toHaveTitle(/Axtro Closer AI Human/);
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
  const demoCta = page.getByRole("button", { name: "Assistir à demonstração" });
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

function hasStructuredDataType(value: unknown, type: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasStructuredDataType(item, type));
  if (value === null || typeof value !== "object") return false;

  for (const [key, child] of Object.entries(value)) {
    if (key === "@type" && child === type) return true;
    if (hasStructuredDataType(child, type)) return true;
  }
  return false;
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
      await expect(page).toHaveTitle("Axtro Closer AI Human | Closer de IA em vídeo com controle");
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Axtro Closer AI Human | Closer de IA em vídeo com controle");
      await expect(page.getByRole("heading", { name: "Seu melhor closer não deveria caber na agenda." })).toBeVisible();
      await expect(page.getByRole("button", { name: "Assistir à demonstração" })).toBeVisible();
      await expect(page.getByText("IA sempre identificada", { exact: true })).toBeVisible();
      const raissa = page.getByAltText("Raissa no estúdio Axtro, identidade visual da experiência Closer AI Human");
      await expect(raissa).toBeVisible();
      await expect(raissa).toHaveAttribute("src", /raissa-closer-hero\.png/);
      await expect(page.getByRole("heading", { name: /O que você precisa saber/i })).toBeVisible();
      await expect(page.locator("#faq details").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectKeyboardReachableCta(page);

      const structuredData = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(structuredData.length).toBeGreaterThan(0);
      const parsedStructuredData = structuredData.map((document) => JSON.parse(document));
      parsedStructuredData.forEach(assertNoForbiddenStructuredData);
      expect(parsedStructuredData.some((document) => hasStructuredDataType(document, "FAQPage"))).toBe(true);

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
    CRAWL_EXCLUDED_PATHS.forEach((path) =>
      expect(block, `${bot} deve excluir ${path}`).toMatch(new RegExp(`Disallow:\\s*${path.replace(/\//g, "\\/")}`, "i")),
    );
  }

  const sitemap = documents.get("/sitemap.xml") ?? "";
  expect(sitemap).toContain(`${CANONICAL_ORIGIN}/precos`);
  expect(sitemap).toContain(`${CANONICAL_ORIGIN}/termos`);
  expect(sitemap).toContain(`${CANONICAL_ORIGIN}/privacidade`);
  [...CRAWL_EXCLUDED_PATHS, ...NO_INDEX_AUTH_PATHS].forEach((path) => expect(sitemap, `Sitemap não pode publicar ${path}`).not.toContain(path));

  for (const path of ["/llms.txt", "/llms-full.txt"] as const) {
    const document = documents.get(path) ?? "";
    expect(document).toContain(CANONICAL_ORIGIN);
    expect(document).not.toContain("railway.app");
  }
});

test("demo pública isola contextos, não autentica e não alcança efeitos externos", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const observedRequests: string[] = [];
  pageA.on("request", (request) => observedRequests.push(request.url()));
  pageB.on("request", (request) => observedRequests.push(request.url()));

  try {
    await pageA.goto("/");
    await pageA.getByRole("button", { name: "Assistir à demonstração" }).click();
    await expect(pageA).toHaveURL(/\/demo$/);
    await expect(pageA.getByRole("heading", { name: /Entenda a operação antes/i })).toBeVisible();
    await expect(pageA.getByText("Simulação isolada", { exact: true }).first()).toBeVisible();

    const cookiesA = await contextA.cookies();
    const demoCookieA = cookiesA.find((cookie) => cookie.name === "axtro_public_demo");
    expect(demoCookieA).toBeDefined();
    expect(demoCookieA?.httpOnly).toBe(true);
    expect(demoCookieA?.secure).toBe(true);
    expect(demoCookieA?.sameSite).toBe("Lax");
    expect(demoCookieA?.path).toBe("/demo");
    expect(demoCookieA?.expires).toBeGreaterThan(Date.now() / 1_000);
    expect(demoCookieA?.expires).toBeLessThanOrEqual(Date.now() / 1_000 + 900);
    expect(cookiesA.some((cookie) => cookie.name.startsWith("sb-"))).toBe(false);

    await pageA.getByRole("button", { name: /Agente/i }).click();
    await expect(pageA.getByRole("heading", { name: /Raissa representa/i })).toBeVisible();
    await pageA.reload();
    await expect(pageA.getByRole("heading", { name: /Raissa representa/i })).toBeVisible();

    await pageB.goto("/");
    await pageB.getByRole("button", { name: "Assistir à demonstração" }).click();
    await expect(pageB).toHaveURL(/\/demo$/);
    await expect(pageB.getByRole("heading", { name: /Entenda a operação antes/i })).toBeVisible();
    const cookiesB = await contextB.cookies();
    const demoCookieB = cookiesB.find((cookie) => cookie.name === "axtro_public_demo");
    expect(demoCookieB).toBeDefined();
    expect(
      demoCookieB?.value !== demoCookieA?.value,
      "sessões devem usar estados distintos sem imprimir os tokens assinados",
    ).toBe(true);
    expect(cookiesB.some((cookie) => cookie.name.startsWith("sb-"))).toBe(false);

    for (const forbiddenText of [
      "Administrador",
      "Convidar membro",
      "Google Calendar",
      "Ativar agente",
      "Excluir agente",
      "Contratar plano",
    ]) {
      await expect(pageB.getByText(forbiddenText, { exact: true })).toHaveCount(0);
    }

    const protectedPage = await contextB.newPage();
    await protectedPage.goto("/dashboard");
    await expect(protectedPage).toHaveURL(/\/login/);
    await protectedPage.close();

    const externalEffectPattern = /supabase|openrouter|tavus|recall|stripe|resend|googleapis/i;
    expect(observedRequests.filter((url) => externalEffectPattern.test(new URL(url).hostname))).toEqual([]);
    expect(observedRequests.filter((url) => new URL(url).pathname.startsWith("/api/"))).toEqual([]);

    await pageA.getByRole("button", { name: "Sair da demonstração" }).click();
    await expect(pageA).toHaveURL(/\/$/);
    const cookiesAfterExit = await contextA.cookies();
    expect(cookiesAfterExit.some((cookie) => cookie.name === "axtro_public_demo")).toBe(false);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test("bypass da demo é exato e prefixos parecidos continuam protegidos", async ({ request }) => {
  for (const path of ["/demo", "/demo/guia"] as const) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} não pode redirecionar para auth`).not.toBe(307);
    expect(response.headers().location).toBeUndefined();
  }

  for (const path of ["/demolition", "/demo.evil", "/demographic", "/dashboard"] as const) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} deve permanecer protegido`).toBe(307);
    expect(response.headers().location).toMatch(/\/login/);
  }
});
