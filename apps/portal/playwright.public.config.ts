import { defineConfig } from "@playwright/test";

/**
 * Gate sem sessão nem segredos: exerce exclusivamente as superfícies públicas
 * no build de produção. O E2E autenticado permanece em playwright.config.ts.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "public-discovery.spec.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:3102",
    channel: process.env.CI ? undefined : "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "next build && next start -p 3102",
    url: "http://localhost:3102",
    reuseExistingServer: process.env.PW_REUSE === "1",
    timeout: 420_000,
    env: {
      NEXT_PUBLIC_SITE_URL: "https://closer.axtroai.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder",
      PORTAL_FAKE_PROVIDERS: "1",
    },
  },
});
