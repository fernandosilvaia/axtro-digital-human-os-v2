import { defineConfig } from "@playwright/test";

/**
 * Gate sem conta ou provider: exerce exclusivamente as superfícies públicas
 * no build de produção. O segredo abaixo é efêmero e assina somente a fixture
 * sintética local deste processo de teste.
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
    screenshot: "off",
    trace: "off",
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
      // Explicit empties override inherited credentials and Next .env files.
      TAVUS_API_KEY: "",
      RECALL_API_KEY: "",
      OPENROUTER_API_KEY: "",
      RESEND_API_KEY: "",
      STRIPE_SECRET_KEY: "",
      GOOGLE_OAUTH_CLIENT_SECRET: "",
      PORTAL_PUBLIC_DEMO_STATE_SECRET: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION:
        "axtro-public-demo-edge/v3;scope=global;post-start=120/60s;post-command-end=600/60s;get-head-demo=900/60s;concurrency=32;queue=0;reject=429",
    },
  },
});
