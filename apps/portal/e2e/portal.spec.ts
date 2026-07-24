import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Fluxos críticos da UI logada, em modo demonstração (PORTAL_FAKE_PROVIDERS=1):
 * login real → dashboard → agentes (ativar/pausar) → chat determinístico →
 * apresentação simulada. As credenciais do usuário demo vêm de .env.local.
 */

const envFile = readFileSync(resolve(import.meta.dirname, "../.env.local"), "utf8");
const env = Object.fromEntries(
  envFile
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
) as Record<string, string>;

const DEMO_EMAIL = env.DEMO_EMAIL ?? "";
const DEMO_PASSWORD = env.DEMO_PASSWORD ?? "";
const RAFAELA_ID = "019f6de0-0000-7000-8000-0000000a0001";
const BRUNO_NAME = "Bruno — Closer Empresarial";

test.beforeAll(() => {
  test.skip(DEMO_EMAIL.length === 0 || DEMO_PASSWORD.length === 0, "DEMO_EMAIL/DEMO_PASSWORD ausentes em .env.local");
});

test.describe.configure({ mode: "serial" });

test("landing pública renderiza e aponta para login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Axtro Digital Human OS/);
  await expect(page.locator('a[href="/login"]').first()).toBeVisible();
});

test("superfícies públicas de SEO/AEO respondem 200 sem sessão", async ({ request }) => {
  // Achado real 2026-07-24: llms.txt/llms-full.txt ficaram fora da lista de
  // exclusão do middleware de auth e voltavam 307 para /login — quebrava o
  // propósito de AEO (crawlers de IA não autenticam). Só um teste HTTP real
  // pega essa classe de bug; asserção de string no source (portal-seo-surface
  // .test.mjs) não pegou. Cobre todas as rotas públicas do middleware.
  for (const path of ["/robots.txt", "/sitemap.xml", "/manifest.json", "/llms.txt", "/llms-full.txt", "/opengraph-image"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} deveria responder 200 sem redirecionar`).toBe(200);
  }
});

test("rota protegida sem sessão redireciona para login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("login do usuário demo leva ao dashboard com métricas", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', DEMO_EMAIL);
  await page.fill('input[type="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.locator("h1").first()).toBeVisible();
  // T8: painel de custo estimado (rate card com preço público de tabela).
  await expect(page.getByText("Custo estimado hoje")).toBeVisible();
  await expect(page.getByText("Preço público de tabela — não é a fatura real")).toBeVisible();
});

test("agentes: lista carrega e admin ativa e pausa um rascunho", async ({ page }) => {
  await login(page);
  await page.goto("/agentes");
  const brunoRow = page.locator("tr", { hasText: BRUNO_NAME });
  await expect(brunoRow).toBeVisible();

  // Ativa o rascunho e confirma a mudança de status na própria linha.
  await brunoRow.getByRole("button", { name: "Ativar" }).click();
  await expect(brunoRow.getByRole("button", { name: "Pausar" })).toBeVisible({ timeout: 20_000 });

  // Reverte para não deixar estado sujo no tenant demo.
  await brunoRow.getByRole("button", { name: "Pausar" }).click();
  await expect(brunoRow.getByRole("button", { name: "Ativar" })).toBeVisible({ timeout: 20_000 });
});

test("chat de teste responde em modo demonstração", async ({ page }) => {
  await login(page);
  await page.goto(`/agentes/${RAFAELA_ID}/testar`);
  await page.fill("#preview-message", "Quero entender como funciona a energia solar para minha casa.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("modo demonstração", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
});

test("apresentação simulada abre o deck e navega slides", async ({ page }) => {
  await login(page);
  await page.goto(`/agentes/${RAFAELA_ID}/testar`);
  await page.getByRole("button", { name: "Iniciar apresentação" }).click();
  await expect(page.getByText("Modo demonstração — sem provider de vídeo")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1/7")).toBeVisible();
  await page.getByRole("button", { name: "Próximo →" }).click();
  await expect(page.getByText("2/7")).toBeVisible();
  await expect(page.getByText("Nossa agenda")).toBeVisible();
  await page.getByRole("button", { name: "← Anterior" }).click();
  await expect(page.getByText("1/7")).toBeVisible();
});

async function login(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/login");
  // Sessão persistida de teste anterior redireciona direto.
  if (page.url().includes("/dashboard")) return;
  await page.fill('input[type="email"]', DEMO_EMAIL);
  await page.fill('input[type="password"]', DEMO_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}
