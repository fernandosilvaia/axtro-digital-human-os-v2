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
  // /rosto-agente é a CÂMERA do bot do Recall.ai nas reuniões externas — o
  // bot navega sem sessão nossa; se o matcher do middleware derrubar essa
  // rota, o agente perde o rosto em TODAS as reuniões Meet/Zoom/Teams em
  // produção. /recuperar-senha idem para usuários sem senha. Mesma classe
  // de bug que já aconteceu duas vezes (llms.txt, api/*).
  for (const path of ["/robots.txt", "/sitemap.xml", "/manifest.json", "/llms.txt", "/llms-full.txt", "/opengraph-image", "/rosto-agente", "/recuperar-senha"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} deveria responder 200 sem redirecionar`).toBe(200);
  }
});

test("rotas /api/* servidor-a-servidor nunca redirecionam para /login", async ({ request }) => {
  // Mesma classe de bug do achado de 2026-07-24 (llms.txt), desta vez em
  // /api/brain e /api/leads/video-session (2026-07-29): cada rota ali tem a
  // própria autenticação por segredo/bearer, nunca sessão de cookie — mas o
  // matcher do middleware só excluía api/health, então as outras caíam no
  // 307 pro /login antes de tocar a lógica da rota. O matcher agora exclui
  // api/* inteiro; este teste prova isso com HTTP real, não com leitura de
  // regex no source.
  const health = await request.get("/api/health", { maxRedirects: 0 });
  expect(health.status(), "/api/health deveria responder 200 sem redirecionar").toBe(200);

  const brain = await request.post("/api/brain/00000000-0000-7000-8000-000000000000/chat/completions", {
    maxRedirects: 0,
    data: { messages: [{ role: "user", content: "oi" }] },
  });
  expect(brain.status(), "/api/brain/.../chat/completions não deveria redirecionar pro login").not.toBe(307);

  const leads = await request.post("/api/leads/video-session", { maxRedirects: 0, data: {} });
  expect(leads.status(), "/api/leads/video-session não deveria redirecionar pro login").not.toBe(307);
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

  // Auto-reparo: se um run anterior falhou ENTRE ativar e pausar, o Bruno
  // ficou ativo no tenant compartilhado e todo run seguinte quebraria aqui
  // pra sempre (auditoria 2026-08-02). Restaura o baseline antes de agir.
  const leftoverPause = brunoRow.getByRole("button", { name: "Pausar" });
  if (await leftoverPause.isVisible().catch(() => false)) {
    await leftoverPause.click();
    await expect(brunoRow.getByRole("button", { name: "Ativar" })).toBeVisible({ timeout: 20_000 });
  }

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

test("signup renderiza o formulário de criação de conta", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});

test("configurações: seção de plano visível e ciclo completo de convite (criar → revogar)", async ({ page }) => {
  await login(page);
  await page.goto("/configuracoes");
  // D-V2-101 trocou a seção estática "Plano e contratação" pela cobrança
  // real ("Plano e cobrança", com card de plano OU aviso de indisponível —
  // os dois estados válidos do BillingSection desacoplado).
  await expect(page.getByText("Plano e cobrança")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver todos os planos" })).toBeVisible();

  // Convite com e-mail único por execução; revogado ao final pra não deixar
  // estado sujo no tenant demo (e o envio de e-mail é mock no fake mode).
  const inviteEmail = `e2e-${Date.now().toString(36)}@example.com`;
  await page.fill("#invite-email", inviteEmail);
  await page.getByRole("button", { name: "Convidar" }).click();
  await expect(page.getByText("Convite registrado", { exact: false })).toBeVisible({ timeout: 20_000 });

  const inviteRow = page.locator("tr", { hasText: inviteEmail });
  await expect(inviteRow).toBeVisible();
  await inviteRow.getByRole("button", { name: "Revogar" }).click();
  await expect(inviteRow).not.toBeVisible({ timeout: 20_000 });
});

test("conhecimento: revogar e reativar uma fonte restaura o estado", async ({ page }) => {
  await login(page);
  await page.goto("/conhecimento");
  // Precisa ser uma fonte COM conteúdo ingerido: reativar exige versões
  // (achado real — a fonte seed "FAQ" nunca teve ingestão e não reativa).
  const sourceName = "Método Silva — Biblioteca de Objeções e Respostas (Kit 05)";
  await expect(page.getByText(sourceName)).toBeVisible();

  // Auto-reparo: run anterior pode ter morrido com a fonte revogada — reativa
  // antes, senão o botão "Revogar" não existe e o teste quebra pra sempre.
  const leftoverReactivate = page.getByRole("button", { name: `Reativar a fonte ${sourceName}` });
  if (await leftoverReactivate.isVisible().catch(() => false)) {
    await leftoverReactivate.click();
    await expect(page.getByRole("button", { name: `Revogar a fonte ${sourceName}` })).toBeVisible({ timeout: 20_000 });
  }

  await page.getByRole("button", { name: `Revogar a fonte ${sourceName}` }).click();
  await expect(page.getByRole("button", { name: `Reativar a fonte ${sourceName}` })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: `Reativar a fonte ${sourceName}` }).click();
  await expect(page.getByRole("button", { name: `Revogar a fonte ${sourceName}` })).toBeVisible({ timeout: 20_000 });
});

test("termos e privacidade são públicos e linkados no signup", async ({ page, request }) => {
  for (const path of ["/termos", "/privacidade"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} deveria ser público`).toBe(200);
  }
  await page.goto("/signup");
  await expect(page.locator('a[href="/termos"]')).toBeVisible();
  await expect(page.locator('a[href="/privacidade"]')).toBeVisible();
});

test("ciclo de vida completo do agente: criar → ativar → pausar → excluir", async ({ page }) => {
  await login(page);
  await page.goto("/agentes");

  // Nome único por execução — e o teste limpa atrás de si via exclusão.
  const agentName = `E2E Ciclo ${Date.now().toString(36)}`;
  await page.fill("#agent-name", agentName);
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  const row = page.locator("tr", { hasText: agentName });
  // 30s: no CI o e2e roda contra o build de produção num runner lento —
  // action + revalidação + RSC levam mais que no dev server local.
  await expect(row).toBeVisible({ timeout: 30_000 });

  await row.getByRole("button", { name: "Ativar" }).click();
  await expect(row.getByRole("button", { name: "Pausar" })).toBeVisible({ timeout: 20_000 });

  await row.getByRole("button", { name: "Pausar" }).click();
  await expect(row.getByRole("button", { name: "Ativar" })).toBeVisible({ timeout: 20_000 });

  // Exclusão exige dupla confirmação deliberada.
  await row.getByRole("button", { name: `Excluir o rascunho ${agentName}` }).click();
  await row.getByRole("button", { name: `Confirmar exclusão de ${agentName}` }).click();
  await expect(row).not.toBeVisible({ timeout: 20_000 });
});

test("ciclo de vida da fonte: criar pendente → excluir", async ({ page }) => {
  await login(page);
  await page.goto("/conhecimento");

  const sourceName = `E2E Fonte ${Date.now().toString(36)}`;
  await page.fill("#source-name", sourceName);
  await page.getByRole("button", { name: /Cadastrar/ }).click();
  const row = page.locator("tr", { hasText: sourceName });
  await expect(row).toBeVisible({ timeout: 30_000 });

  await row.getByRole("button", { name: `Excluir a fonte ${sourceName}` }).click();
  await row.getByRole("button", { name: `Confirmar exclusão da fonte ${sourceName}` }).click();
  await expect(row).not.toBeVisible({ timeout: 20_000 });
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
