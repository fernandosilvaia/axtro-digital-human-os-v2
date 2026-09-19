// Módulo exclusivo de servidor (importado apenas por server actions, mesma
// convenção de knowledge.ts): envio de e-mail transacional via Resend,
// mesmo provedor do SMTP de auth (D-V2-063, domínio axtroai.com verificado).
// Sem RESEND_API_KEY (ou em PORTAL_FAKE_PROVIDERS=1) o envio vira mock
// logado: o fluxo do produto nunca quebra por falta de chave.
import { formatUsdCents } from "./billing/plans.ts";
import { logError as trackError, logEvent } from "./telemetry.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM = "Axtro Digital Human OS <no-reply@axtroai.com>";
const TIMEOUT_MS = 10_000;

export interface EmailSendResult {
  readonly sent: boolean;
  readonly reason: "sent" | "mocked_no_key" | "provider_error";
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  tenant_admin: "Administrador(a)",
  tenant_operator: "Operador(a)",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Base publica dos links dos e-mails, lida a cada chamada (nao no import) para
 * acompanhar o ambiente em teste.
 *
 * O fallback e o dominio canonico, nunca o host cru do Railway que estava
 * repetido em quatro templates. Os dois sao origens aprovadas, entao o link
 * funcionaria, mas mandar alguem para o host do Railway o coloca numa origem
 * DIFERENTE da sessao dele, que foi exatamente a classe de problema que
 * quebrou o OAuth do calendario por dominio trocado (D-V2-174). Fora que um
 * link para `*.up.railway.app` num e-mail transacional parece phishing.
 */
function publicBase(): string {
  const configured = (process.env.PORTAL_PUBLIC_URL ?? "").trim();
  return configured.length > 0 ? configured : "https://closer.axtroai.com";
}

/* ------------------------------------------------------------------ */
/* Casco compartilhado dos e-mails                                      */
/* ------------------------------------------------------------------ */

/**
 * Antes desta versao cada template montava o proprio HTML solto, e os cinco
 * saiam SO em HTML. Tres consequencias praticas na caixa de entrada:
 *
 * 1. Sem alternativa em texto puro. Cliente que prefere texto (e filtro de
 *    spam, que compara as duas partes) recebia um multipart incompleto, o que
 *    e um dos sinais negativos mais comuns de entregabilidade.
 * 2. Sem preheader: a linha de previa ao lado do assunto puxava o comeco do
 *    corpo, entao a caixa de entrada mostrava um pedaco de frase cortada.
 * 3. Sem cabecalho e rodape comuns: nada dizia de onde vinha nem por que a
 *    pessoa recebeu, que e o que separa transacional de e-mail suspeito.
 *
 * O conteudo agora e declarado UMA vez e renderizado nas duas formas. Nao e
 * so arrumacao: HTML e texto que se escrevem separados divergem sempre, e o
 * lado que ninguem olha e justamente o texto.
 *
 * A marcacao aceita e deliberadamente minima, `*negrito*`. Valor vindo do
 * tenant (nome do workspace, do agente, da empresa) e escapado como HTML na
 * renderizacao, entao um asterisco perdido no nome no maximo deixa um trecho
 * em negrito: nunca injeta marcacao executavel.
 */
interface EmailContent {
  /** Linha de previa na caixa de entrada. Nunca aparece no corpo. */
  readonly preheader: string;
  readonly heading: string;
  /** Paragrafos em marcacao minima: `*negrito*`. */
  readonly paragraphs: readonly string[];
  readonly cta?: { readonly label: string; readonly url: string };
  /** Linhas de detalhe rotuladas, para URL que precisa aparecer por extenso. */
  readonly details?: readonly { readonly label: string; readonly value: string }[];
  readonly footnote?: string;
}

const BRAND = Object.freeze({
  product: "Axtro Digital Human OS",
  accent: "#5b4dff",
  ink: "#1b1b21",
  body: "#44444f",
  faint: "#8a8a95",
  surface: "#ffffff",
  page: "#f5f5f8",
  border: "#e6e6ec",
});

/** `*negrito*` -> <strong>, sobre texto JA escapado. */
function renderInlineHtml(escaped: string): string {
  return escaped.replaceAll(/\*([^*]+)\*/g, "<strong>$1</strong>");
}

/** `*negrito*` -> texto limpo, para a parte em texto puro. */
function renderInlineText(raw: string): string {
  return raw.replaceAll(/\*([^*]+)\*/g, "$1");
}

function renderEmailHtml(content: EmailContent): string {
  const paragraphs = content.paragraphs
    .map((paragraph) => `<p style="color:${BRAND.body};font-size:15px;line-height:1.6;margin:0 0 14px">${renderInlineHtml(escapeHtml(paragraph))}</p>`)
    .join("");
  const details = (content.details ?? [])
    .map((detail) => `<p style="color:${BRAND.body};font-size:14px;line-height:1.6;margin:0 0 8px">${escapeHtml(detail.label)}: <a href="${escapeHtml(detail.value)}" style="color:${BRAND.accent};word-break:break-all">${escapeHtml(detail.value)}</a></p>`)
    .join("");
  const cta = content.cta === undefined
    ? ""
    : `<p style="margin:22px 0 0"><a href="${escapeHtml(content.cta.url)}" style="background:${BRAND.accent};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;display:inline-block;font-size:15px;font-weight:600">${escapeHtml(content.cta.label)}</a></p>`;
  const footnote = content.footnote === undefined
    ? ""
    : `<p style="color:${BRAND.faint};font-size:12px;line-height:1.6;margin:22px 0 0">${renderInlineHtml(escapeHtml(content.footnote))}</p>`;

  return [
    `<!doctype html><html lang="pt-BR"><head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    // Trava o esquema claro: sem isto, varios clientes invertem as cores por
    // conta propria e o botao da marca some no fundo escuro.
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">`,
    `<title>${escapeHtml(content.heading)}</title>`,
    `</head>`,
    `<body style="margin:0;padding:0;background:${BRAND.page}">`,
    // Preheader: o `display:none` esconde no corpo e os espacos impedem que o
    // cliente puxe o texto seguinte para completar a previa.
    `<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}${"&#847;&zwnj;&nbsp;".repeat(30)}</span>`,
    // Uma tabela so, para centralizar no Outlook, que ignora margin:auto.
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};padding:28px 12px">`,
    `<tr><td align="center">`,
    // O `align="center"` do <td> acima cascateia text-align para TODO o
    // conteudo, entao o card precisa reancorar a esquerda. Sem isto cada
    // paragrafo sai centralizado, que e o visual que denuncia e-mail montado
    // as pressas. Achado olhando o render, nao a asserção.
    `<div style="max-width:520px;margin:0 auto;text-align:left;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:14px;overflow:hidden">`,
    `<div style="padding:18px 28px;border-bottom:1px solid ${BRAND.border}">`,
    `<span style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:13px;font-weight:700;color:${BRAND.ink};letter-spacing:0.02em">${BRAND.product}</span>`,
    `</div>`,
    `<div style="padding:26px 28px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">`,
    `<h1 style="font-size:19px;line-height:1.35;color:${BRAND.ink};margin:0 0 14px;font-weight:650">${escapeHtml(content.heading)}</h1>`,
    paragraphs, details, cta, footnote,
    `</div>`,
    `<div style="padding:16px 28px;border-top:1px solid ${BRAND.border};background:${BRAND.page}">`,
    `<p style="color:${BRAND.faint};font-size:11px;line-height:1.6;margin:0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">Mensagem automática do ${BRAND.product}. Você recebeu porque tem acesso a esta conta.</p>`,
    `</div>`,
    `</div></td></tr></table></body></html>`,
  ].join("");
}

function renderEmailText(content: EmailContent): string {
  const lines = [content.heading, "", ...content.paragraphs.map(renderInlineText)];
  for (const detail of content.details ?? []) lines.push(`${detail.label}: ${detail.value}`);
  if (content.cta !== undefined) lines.push("", `${content.cta.label}: ${content.cta.url}`);
  if (content.footnote !== undefined) lines.push("", renderInlineText(content.footnote));
  lines.push("", `Mensagem automática do ${BRAND.product}. Você recebeu porque tem acesso a esta conta.`);
  return lines.join("\n");
}

interface SendHtmlEmailOptions {
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  /** Alternativa em texto puro. Sempre gerada do MESMO conteudo do HTML. */
  readonly text: string;
  /** Nome do evento no log estruturado de mock/erro (sem PII). */
  readonly logEvent: string;
}

const TRANSIENT_RETRY_DELAY_MS = 400;
const MAX_TRANSIENT_RETRY_DELAY_MS = 2000;

/** 429 (rate limit) e 5xx são retryable por definição; 401/402/403/422/etc são permanentes: retentar não ajudaria e só atrasaria um e-mail que vai falhar de qualquer jeito (achado onda 8, D-V2-117, mesma disciplina condicional de D-V2-116). */
function isTransientResendStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Núcleo de envio compartilhado: mock sem chave, timeout, retry condicional, log sem PII. */
async function sendHtmlEmail(options: SendHtmlEmailOptions): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  if (apiKey.trim().length === 0 || process.env.PORTAL_FAKE_PROVIDERS === "1") {
    logEvent(`${options.logEvent}_mocked`, { reason: "no_api_key_or_fake_mode", to_count: options.to.length });
    return { sent: false, reason: "mocked_no_key" };
  }

  // Uma chave estável por CHAMADA (não por tentativa): a Resend suporta
  // Idempotency-Key (docs.resend.com/api-reference/emails/send-email) e
  // aceitar isso torna a retentativa abaixo segura mesmo no caso ambíguo
  // de a 1ª tentativa ter estourado o timeout DEPOIS da Resend já ter
  // aceitado o envio (achado da própria auto-revisão, onda 8, D-V2-117):
  // sem isto, retentar em QUALQUER exceção arriscava duplicar um e-mail
  // transacional real (convite, alerta de bloqueio), mesma disciplina de
  // idempotencyKey já usada pra Stripe em video-cap.ts.
  const idempotencyKey = crypto.randomUUID();

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ from: FROM, to: options.to, subject: options.subject, html: options.html, text: options.text }),
      });
      if (!response.ok) {
        if (attempt === 1 && isTransientResendStatus(response.status)) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterSeconds = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN;
          const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
            ? Math.min(retryAfterSeconds * 1000, MAX_TRANSIENT_RETRY_DELAY_MS)
            : TRANSIENT_RETRY_DELAY_MS;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        trackError(`${options.logEvent}_failed`, new Error(`resend http ${response.status}`));
        return { sent: false, reason: "provider_error" };
      }
      return { sent: true, reason: "sent" };
    } catch (error) {
      if (attempt === 1) continue;
      trackError(`${options.logEvent}_failed`, error);
      return { sent: false, reason: "provider_error" };
    } finally {
      clearTimeout(timer);
    }
  }
  // Inatingível: o loop de 2 tentativas sempre retorna ou lança acima.
  return { sent: false, reason: "provider_error" };
}

/**
 * E-mail de convite de equipe (modelo e-mail pré-aprovado, D-V2-060): avisa o
 * convidado para criar a conta com ESTE e-mail. O provisionamento o coloca
 * no workspace automaticamente. Falha aqui nunca desfaz o convite.
 */
export async function sendInviteEmail(options: {
  readonly to: string;
  readonly workspaceName: string;
  readonly role: string;
}): Promise<EmailSendResult> {
  const signupUrl = `${publicBase()}/signup`;
  const roleLabel = ROLE_LABELS[options.role] ?? options.role;
  const content: EmailContent = {
    preheader: `Acesso como ${roleLabel} no workspace ${options.workspaceName}.`,
    heading: `Você foi convidado para o workspace ${options.workspaceName}`,
    paragraphs: [
      `Um administrador convidou *${options.to}* para entrar como *${roleLabel}* no ${BRAND.product}.`,
      "Para aceitar, crie sua conta usando exatamente este e-mail. O convite é aplicado automaticamente no primeiro acesso.",
    ],
    cta: { label: "Criar minha conta", url: signupUrl },
    footnote: "Se você não esperava este convite, ignore este e-mail. Nada acontece sem a criação da conta.",
  };

  return sendHtmlEmail({
    to: [options.to],
    subject: `Convite: workspace ${options.workspaceName} no ${BRAND.product}`,
    html: renderEmailHtml(content),
    text: renderEmailText(content),
    logEvent: "invite_email",
  });
}

/**
 * E-mail aos admins do tenant quando um agente é ativado (T9): visibilidade
 * de mudança de estado que afeta o que os clientes veem. Best-effort: nunca
 * desfaz a ativação já aplicada no banco.
 */
export async function sendAgentActivatedEmail(options: {
  readonly to: readonly string[];
  readonly workspaceName: string;
  readonly agentName: string;
}): Promise<EmailSendResult> {
  if (options.to.length === 0) {
    return { sent: false, reason: "mocked_no_key" };
  }
  const dashboardUrl = `${publicBase()}/agentes`;
  const content: EmailContent = {
    preheader: `${options.agentName} já pode conversar com clientes.`,
    heading: `Agente ativado em ${options.workspaceName}`,
    paragraphs: [
      `*${options.agentName}* foi ativado e já pode conversar com clientes usando o conhecimento conectado da conta.`,
    ],
    cta: { label: "Ver agentes", url: dashboardUrl },
  };

  return sendHtmlEmail({
    to: options.to,
    subject: `${options.agentName} foi ativado, ${options.workspaceName}`,
    html: renderEmailHtml(content),
    text: renderEmailText(content),
    logEvent: "agent_activated_email",
  });
}

const MEETING_STATUS_LABEL: Readonly<Record<string, string>> = {
  ended: "encerrou",
  failed: "não conseguiu concluir",
};

/**
 * E-mail aos admins quando uma reunião externa termina (achado da auditoria
 * 2026-08-06): o evento de negócio mais importante do produto ("seu agente
 * acabou de representar você numa reunião de verdade") não disparava nada;
 * o dono só sabia se voltasse a abrir /testar e olhar a tabela. Best-effort,
 * mesma disciplina dos outros e-mails deste módulo.
 */
export async function sendMeetingEndedEmail(options: {
  readonly to: readonly string[];
  readonly workspaceName: string;
  readonly agentName: string;
  readonly meetingUrl: string;
  readonly status: "ended" | "failed";
}): Promise<EmailSendResult> {
  if (options.to.length === 0) {
    return { sent: false, reason: "mocked_no_key" };
  }
  const dashboardUrl = `${publicBase()}/agentes`;
  const statusLabel = MEETING_STATUS_LABEL[options.status];
  const content: EmailContent = {
    preheader: `${options.agentName} ${statusLabel} a reunião externa que você agendou.`,
    heading: `Reunião externa ${statusLabel}, ${options.workspaceName}`,
    paragraphs: [`*${options.agentName}* ${statusLabel} a reunião externa que você agendou.`],
    details: [{ label: "Reunião", value: options.meetingUrl }],
    cta: { label: "Ver agentes", url: dashboardUrl },
  };

  return sendHtmlEmail({
    to: options.to,
    subject: `${options.agentName} ${statusLabel} a reunião externa, ${options.workspaceName}`,
    html: renderEmailHtml(content),
    text: renderEmailText(content),
    logEvent: "meeting_ended_email",
  });
}

/**
 * E-mail aos admins quando um teto diário de uso cruza 80% ou 100% (D-V2-107,
 * gap declarado em docs/COST_OPTIMIZATION.md: "os tetos cortam, mas não
 * avisam antes"). Dedup de disparo é responsabilidade do chamador
 * (lib/cost-alerts.ts). Esta função só formata e envia.
 */
export async function sendCostCapAlertEmail(options: {
  readonly to: readonly string[];
  readonly workspaceName: string;
  readonly capLabel: string;
  readonly currentValue: number;
  readonly capValue: number;
  readonly percentUsed: 80 | 100;
}): Promise<EmailSendResult> {
  if (options.to.length === 0) {
    return { sent: false, reason: "mocked_no_key" };
  }
  const isFull = options.percentUsed >= 100;
  const headline = isFull
    ? `Teto diário de ${options.capLabel} atingido, bloqueado a partir de agora`
    : `${options.workspaceName} está perto do teto diário de ${options.capLabel}`;
  const dashboardUrl = `${publicBase()}/dashboard`;
  const content: EmailContent = {
    preheader: isFull
      ? `Bloqueado até a virada do dia. Teto de ${options.capLabel}.`
      : `${options.percentUsed}% do teto diário de ${options.capLabel}. Nenhuma ação necessária.`,
    heading: headline,
    paragraphs: [
      `Uso de hoje: *${options.currentValue.toLocaleString("pt-BR")} / ${options.capValue.toLocaleString("pt-BR")}* (${options.percentUsed}%), ${options.capLabel}, workspace ${options.workspaceName}.`,
      isFull
        ? "Novas solicitações desse tipo ficam bloqueadas até a virada do dia (00:00 UTC). O teto existe para proteger a conta contra gasto inesperado."
        : "Sem ação necessária agora. É só um aviso antes de chegar no limite.",
    ],
    cta: { label: "Ver uso no painel", url: dashboardUrl },
  };

  return sendHtmlEmail({
    to: options.to,
    subject: `${options.workspaceName}: ${options.percentUsed}% do teto diário de ${options.capLabel}`,
    html: renderEmailHtml(content),
    text: renderEmailText(content),
    logEvent: "cost_cap_alert_email",
  });
}

/**
 * E-mail de proposta pra um prospect externo, depois de um fechamento ao
 * vivo (D-V2-123): a única mensagem deste arquivo que sai pra um endereço
 * fora do tenant, nunca reaproveitada pelos outros e-mails (todos internos,
 * pra admins já cadastrados). "IA rascunha, humano manda" (doutrina já
 * documentada em docs/BRIEFING_RAISSA_CLOSER_VIDEO.md §6). Este envio
 * exige clique explícito de um admin depois de revisar empresa/e-mail/
 * plano, nunca dispara sozinho no meio de uma call.
 */
export async function sendProposalEmail(options: {
  readonly to: string;
  readonly prospectCompanyName: string;
  readonly closerName: string;
  readonly planLabel: string;
  readonly checkoutUrl: string;
}): Promise<EmailSendResult> {
  const content: EmailContent = {
    preheader: `Plano ${options.planLabel}, como combinado com ${options.closerName}.`,
    heading: `Proposta ${BRAND.product} para ${options.prospectCompanyName}`,
    paragraphs: [
      `Foi ótimo conversar com você. Como combinamos com *${options.closerName}*, aqui está o link para confirmar o plano *${options.planLabel}*.`,
    ],
    cta: { label: "Confirmar plano", url: options.checkoutUrl },
    footnote: "Alguma dúvida antes de confirmar? Responda este e-mail que o time da Axtro te ajuda.",
  };

  return sendHtmlEmail({
    to: [options.to],
    subject: `Sua proposta ${BRAND.product} para ${options.prospectCompanyName}`,
    html: renderEmailHtml(content),
    text: renderEmailText(content),
    logEvent: "proposal_email",
  });
}

/**
 * E-mail do link de cobrança do `request_checkout` (ADR-040): igual a
 * `sendProposalEmail` no destino (sai pra um prospect externo, fora do
 * tenant) e na doutrina "IA rascunha, humano manda", mas o clique humano
 * aqui já aconteceu -- é a aprovação do `tenant_admin` na tela de
 * checkout pendente, não um segundo clique de "enviar e-mail" separado.
 * A Server Action de aprovação dispara este envio automaticamente, no
 * mesmo fluxo que já criou a Checkout Session e gravou `committed`.
 */
export async function sendCheckoutLinkEmail(options: {
  readonly to: string;
  readonly productDisplayName: string;
  readonly unitAmountCents: number;
  readonly quantity: number;
  readonly checkoutUrl: string;
}): Promise<EmailSendResult> {
  const totalCents = options.unitAmountCents * options.quantity;
  const priceLine = options.quantity > 1
    ? `${formatUsdCents(totalCents)} (${options.quantity} × ${formatUsdCents(options.unitAmountCents)})`
    : formatUsdCents(options.unitAmountCents);
  const content: EmailContent = {
    preheader: `${options.productDisplayName}, ${priceLine}.`,
    heading: `Confirmação de pagamento: ${options.productDisplayName}`,
    paragraphs: [
      `Como combinado, aqui está o link para confirmar *${options.productDisplayName}* (*${priceLine}*).`,
    ],
    cta: { label: "Confirmar pagamento", url: options.checkoutUrl },
    footnote: "Alguma dúvida antes de confirmar? Responda este e-mail.",
  };

  return sendHtmlEmail({
    to: [options.to],
    subject: `Link de pagamento: ${options.productDisplayName}`,
    html: renderEmailHtml(content),
    text: renderEmailText(content),
    logEvent: "checkout_link_email",
  });
}
