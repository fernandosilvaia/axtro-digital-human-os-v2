import { defineConfig } from "@playwright/test";

/**
 * E2E da UI logada (T4). Roda o dev server em porta própria com
 * PORTAL_FAKE_PROVIDERS=1: chat, embeddings e apresentação usam os fakes
 * determinísticos. Nenhum provider pago é tocado. Credenciais da fixture de
 * cliente E2E vêm de apps/portal/.env.local e nunca da demo pública.
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
    screenshot: "off",
    trace: "off",
  },
  webServer: {
    // CI valida o BUILD DE PRODUÇÃO (next build && next start): uma classe
    // inteira de falha só-de-produção (prerender congelando env, rota que
    // quebra otimizada) passava 100% verde contra o dev server e só
    // aparecia depois do deploy (auditoria 2026-08-02). Dev local continua
    // no dev server, rápido.
    command: process.env.CI ? "next build && next start -p 3100" : "next dev -p 3100",
    url: "http://localhost:3100",
    // PW_REUSE=1: aponta pra um servidor ja rodando (debug do modo producao
    // local: `next build && next start -p 3100` + spec isolado).
    reuseExistingServer: process.env.PW_REUSE === "1",
    timeout: process.env.CI ? 420_000 : 120_000,
    env: {
      PORTAL_FAKE_PROVIDERS: "1",
      PORTAL_PUBLIC_DEMO_STATE_SECRET: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION:
        "axtro-public-demo-edge/v3;scope=global;post-start=120/60s;post-command-end=600/60s;get-head-demo=900/60s;concurrency=32;queue=0;reject=429",
    },
  },
});
