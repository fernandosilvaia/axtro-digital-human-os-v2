import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

/**
 * Fluxos críticos de um cliente autenticado com providers fake:
 * login real → dashboard → agentes (ativar/pausar) → preview textual bloqueado →
 * apresentação simulada. As credenciais da fixture E2E vêm de .env.local e
 * nunca participam da demonstração pública.
 */

const envFile = readFileSync(resolve(import.meta.dirname, "../.env.local"), "utf8");
const env = Object.fromEntries(
  envFile
    .split("\n")
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
) as Record<string, string>;

const E2E_TENANT_ADMIN_EMAIL = env.E2E_TENANT_ADMIN_EMAIL ?? "";
const E2E_TENANT_ADMIN_PASSWORD = env.E2E_TENANT_ADMIN_PASSWORD ?? "";
const RAFAELA_ID = "019f6de0-0000-7000-8000-0000000a0001";
const BRUNO_NAME = "Bruno — Closer Empresarial";

function authCookiesAreIdentical(
  left: readonly Readonly<{ name: string; value: string; domain: string; path: string }>[],
  right: readonly Readonly<{ name: string; value: string; domain: string; path: string }>[],
): boolean {
  return left.length === right.length && left.every((cookie, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && candidate.name === cookie.name
      && candidate.value === cookie.value
      && candidate.domain === cookie.domain
      && candidate.path === cookie.path;
  });
}

test.beforeAll(() => {
  test.skip(
    E2E_TENANT_ADMIN_EMAIL.length === 0 || E2E_TENANT_ADMIN_PASSWORD.length === 0,
    "E2E_TENANT_ADMIN_EMAIL/E2E_TENANT_ADMIN_PASSWORD ausentes em .env.local",
  );
});

test.describe.configure({ mode: "serial" });

test("landing pública renderiza e aponta para login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Axtro Closer AI Human | Closer de IA em vídeo com controle");
  await expect(page.getByRole("heading", { name: "Seu melhor closer não deveria caber na agenda." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Assistir à demonstração" })).toBeVisible();
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

test("login da fixture de cliente leva à central com progresso e custos explicitamente atribuídos", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[type="email"]', E2E_TENANT_ADMIN_EMAIL);
  await page.fill('input[type="password"]', E2E_TENANT_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Central da sua operação de conversa." })).toBeVisible();
  await expect(page.getByText("Próximo melhor passo", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Prontidão operacional confirmada" })).toHaveAttribute("aria-valuenow", /\d+/);
  // T8: painel de custo (ledger de efeitos pagos, M5-01 renomeou de "estimado" para "atribuído").
  await expect(page.getByText("Custo atribuído hoje")).toBeVisible();
  await expect(page.getByText("Ledger estimado/reportado — não é a fatura conciliada")).toBeVisible();
});

test("demo isolada preserva cookies, tenant e papel do cliente autenticado", async ({ page, context }) => {
  await login(page);
  await page.goto("/dashboard");

  const role = await page.locator(".user-chip .role").textContent();
  const tenantSlug = await page.locator("dl div", { hasText: "Identificador" }).locator("dd").textContent();
  const authCookiesBefore = (await context.cookies())
    .filter((cookie) => cookie.name.startsWith("sb-"))
    .map(({ name, value, domain, path }) => ({ name, value, domain, path }))
    .sort((left, right) => left.name.localeCompare(right.name));
  expect(authCookiesBefore.length).toBeGreaterThan(0);

  await page.goto("/");
  await page.getByRole("button", { name: "Assistir à demonstração" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await page.getByRole("button", { name: /Agente/i }).click();
  await page.getByRole("button", { name: "Sair da demonstração" }).click();
  await expect(page).toHaveURL(/\/$/);

  const authCookiesAfter = (await context.cookies())
    .filter((cookie) => cookie.name.startsWith("sb-"))
    .map(({ name, value, domain, path }) => ({ name, value, domain, path }))
    .sort((left, right) => left.name.localeCompare(right.name));
  expect(
    authCookiesAreIdentical(authCookiesBefore, authCookiesAfter),
    "cookies de autenticação devem permanecer idênticos sem imprimir seus valores",
  ).toBe(true);
  expect((await context.cookies()).some((cookie) => cookie.name === "axtro_public_demo")).toBe(false);

  await page.goto("/dashboard");
  const roleAfter = await page.locator(".user-chip .role").textContent();
  const tenantSlugAfter = await page.locator("dl div", { hasText: "Identificador" }).locator("dd").textContent();
  expect(roleAfter === role, "papel autenticado deve permanecer idêntico sem imprimir seu valor").toBe(true);
  expect(tenantSlugAfter === tenantSlug, "tenant deve permanecer idêntico sem imprimir seu identificador").toBe(true);
});

test("navegação móvel fecha com Escape e mantém o foco dentro do menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/dashboard");

  const openMenu = page.getByRole("button", { name: "Abrir menu" });
  await expect(openMenu).toBeVisible();
  await openMenu.click();

  // O drawer e o scrim têm o mesmo nome acessível de fechamento; o toggle é
  // o único controle que também expõe aria-expanded.
  const menuToggle = page.locator(".menu-toggle");
  const firstNavigationLink = page.getByRole("link", { name: "Visão geral" });
  const signOutButton = page.getByRole("button", { name: "Sair da conta" });
  await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
  await expect(firstNavigationLink).toBeFocused();

  await page.keyboard.press("Shift+Tab");
  await expect(signOutButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(firstNavigationLink).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Abrir menu" })).toBeFocused();
  await expect(page.locator('aside[aria-label="Navegação principal"]')).toHaveAttribute("aria-hidden", "true");
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

  // Reverte para não deixar estado sujo no tenant isolado de E2E.
  await brunoRow.getByRole("button", { name: "Pausar" }).click();
  await expect(brunoRow.getByRole("button", { name: "Ativar" })).toBeVisible({ timeout: 20_000 });
});

test("preview textual permanece fechado durante a recuperação contract-first", async ({ page }) => {
  await login(page);
  await page.goto(`/agentes/${RAFAELA_ID}/testar`);
  const preview = page.locator('section[aria-labelledby="text-preview-recovery-title"]');
  await expect(preview.getByRole("heading", { name: "Proteção de privacidade em restauração" })).toBeVisible();
  await expect(preview.getByText("Nenhum provider, ledger ou transcript é acionado", { exact: false })).toBeVisible();
  await expect(preview.locator("form, input, textarea, button")).toHaveCount(0);
});

test("apresentação simulada abre o deck e navega slides", async ({ page }) => {
  await login(page);
  await page.goto(`/agentes/${RAFAELA_ID}/testar`);
  // Bridge de runtime (M5-02) exige as 5 confirmações de consentimento antes
  // de habilitar "Iniciar apresentação" — sem isto o botão fica desabilitado
  // pra sempre e o teste estoura o timeout. Escopado ao fieldset da
  // apresentação: a página também renderiza consentimento pro vídeo/reunião
  // externa com texto parecido, e um getByLabel solto bate nos dois.
  const presentationConsent = page.getByRole("group", { name: "Consentimento para esta apresentação" });
  await presentationConsent.getByLabel(/processamento essencial/).check();
  await presentationConsent.getByLabel(/gravação de áudio/).check();
  await presentationConsent.getByLabel(/transcrição persistente/).check();
  await presentationConsent.getByLabel(/análise comportamental/).check();
  await presentationConsent.getByLabel(/análise visual/).check();
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
  // estado sujo no tenant isolado de E2E (o envio de e-mail é mock no fake mode).
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
  await page.fill('input[type="email"]', E2E_TENANT_ADMIN_EMAIL);
  await page.fill('input[type="password"]', E2E_TENANT_ADMIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}
