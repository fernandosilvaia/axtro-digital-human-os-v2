import { defineConfig } from "@playwright/test";

/**
 * Mesmo papel de playwright.config.ts (E2E da UI logada, T4), mas apontado
 * pro Supabase local isolado deste repo (supabase/config.toml, portas
 * 58420-58429; `supabase start` precisa estar de pé) em vez do projeto
 * hospedado real que apps/portal/.env.local usa. Nunca editar .env.local pra
 * isso: as credenciais da fixture vêm de .env.e2e-local.local (gitignorado).
 * Roda só e2e/portal-local.spec.ts, numa porta fixa própria (3101, livre de
 * 3100 que playwright.config.ts já usa) -- como o `next dev` recusa dois
 * processos na mesma pasta apps/portal mesmo em portas diferentes (lockfile
 * em .next/), pare qualquer dev server manual desta pasta antes de rodar
 * (mesma restrição que playwright.config.ts já tem).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "portal-local.spec.ts",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:3101",
    channel: process.env.CI ? undefined : "chrome",
    screenshot: "off",
    trace: "off",
  },
  webServer: {
    command: "next dev -p 3101",
    url: "http://localhost:3101",
    // PW_REUSE=1: aponta pra um servidor já rodando, mesmo padrão de
    // playwright.config.ts (debug contra um dev server manual já de pé).
    reuseExistingServer: process.env.PW_REUSE === "1",
    timeout: 120_000,
    env: {
      PORTAL_FAKE_PROVIDERS: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:58421",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
      SUPABASE_SERVICE_ROLE_KEY:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
      PORTAL_PUBLIC_DEMO_STATE_SECRET: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      PORTAL_PUBLIC_DEMO_EDGE_POLICY_ATTESTATION:
        "axtro-public-demo-edge/v3;scope=global;post-start=120/60s;post-command-end=600/60s;get-head-demo=900/60s;concurrency=32;queue=0;reject=429",
    },
  },
});
