import { defineConfig } from "@playwright/test";

/**
 * E2E da UI logada (T4). Roda o dev server em porta própria com
 * PORTAL_FAKE_PROVIDERS=1: chat, embeddings e apresentação usam os fakes
 * determinísticos — nenhum provider pago é tocado. Credenciais do usuário
 * demo vêm de apps/portal/.env.local (nunca do repositório).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:3100",
    // Chrome do sistema em dev local (Mac): sem download de browser e sem
    // atrito de Gatekeeper (o chromium baixado morre com SIGABRT nesta
    // máquina). No CI (Linux) usa o chromium baixado pelo Playwright, que
    // não tem esse problema — instalado via `playwright install --with-deps`.
    channel: process.env.CI ? undefined : "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    // CI valida o BUILD DE PRODUÇÃO (next build && next start): uma classe
    // inteira de falha só-de-produção (prerender congelando env, rota que
    // quebra otimizada) passava 100% verde contra o dev server e só
    // aparecia depois do deploy (auditoria 2026-08-02). Dev local continua
    // no dev server, rápido.
    command: process.env.CI ? "next build && next start -p 3100" : "next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: process.env.CI ? 420_000 : 120_000,
    env: { PORTAL_FAKE_PROVIDERS: "1" },
  },
});
