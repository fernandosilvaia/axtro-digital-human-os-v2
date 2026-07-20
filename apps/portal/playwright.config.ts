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
    // Chrome do sistema: sem download de browser e sem atrito de Gatekeeper
    // no macOS (o chromium baixado morre com SIGABRT nesta máquina).
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "next dev -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORTAL_FAKE_PROVIDERS: "1" },
  },
});
