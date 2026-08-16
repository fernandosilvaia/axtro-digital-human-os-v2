// Módulo exclusivo de servidor (importado apenas por server actions, mesma
// convenção de knowledge.ts): envio de e-mail transacional via Resend —
// mesmo provedor do SMTP de auth (D-V2-063, domínio axtroai.com verificado).
// Sem RESEND_API_KEY (ou em PORTAL_FAKE_PROVIDERS=1) o envio vira mock
// logado: o fluxo do produto nunca quebra por falta de chave.
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

interface SendHtmlEmailOptions {
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  /** Nome do evento no log estruturado de mock/erro (sem PII). */
  readonly logEvent: string;
}

const TRANSIENT_RETRY_DELAY_MS = 400;
const MAX_TRANSIENT_RETRY_DELAY_MS = 2000;

/** 429 (rate limit) e 5xx são retryable por definição; 401/402/403/422/etc são permanentes — retentar não ajudaria e só atrasaria um e-mail que vai falhar de qualquer jeito (achado onda 8, D-V2-117, mesma disciplina condicional de D-V2-116). */
function isTransientResendStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Núcleo de envio compartilhado — mock sem chave, timeout, retry condicional, log sem PII. */
async function sendHtmlEmail(options: SendHtmlEmailOptions): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  if (apiKey.trim().length === 0 || process.env.PORTAL_FAKE_PROVIDERS === "1") {
    logEvent(`${options.logEvent}_mocked`, { reason: "no_api_key_or_fake_mode", to_count: options.to.length });
    return { sent: false, reason: "mocked_no_key" };
  }

  // Uma chave estável por CHAMADA (não por tentativa) — a Resend suporta
  // Idempotency-Key (docs.resend.com/api-reference/emails/send-email) e
  // aceitar isso torna a retentativa abaixo segura mesmo no caso ambíguo
  // de a 1ª tentativa ter estourado o timeout DEPOIS da Resend já ter
  // aceitado o envio (achado da própria auto-revisão, onda 8, D-V2-117):
  // sem isto, retentar em QUALQUER exceção arriscava duplicar um e-mail
  // transacional real (convite, alerta de bloqueio) — mesma disciplina de
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
        body: JSON.stringify({ from: FROM, to: options.to, subject: options.subject, html: options.html }),
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
  // Inatingível — o loop de 2 tentativas sempre retorna ou lança acima.
  return { sent: false, reason: "provider_error" };
}

/**
 * E-mail de convite de equipe (modelo e-mail pré-aprovado, D-V2-060): avisa o
 * convidado para criar a conta com ESTE e-mail — o provisionamento o coloca
 * no workspace automaticamente. Falha aqui nunca desfaz o convite.
 */
export async function sendInviteEmail(options: {
  readonly to: string;
  readonly workspaceName: string;
  readonly role: string;
}): Promise<EmailSendResult> {
  const signupUrl = `${process.env.PORTAL_PUBLIC_URL ?? "https://portal-production-b43e.up.railway.app"}/signup`;
  const roleLabel = ROLE_LABELS[options.role] ?? options.role;
  const workspace = escapeHtml(options.workspaceName);
  const html = [
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px">`,
    `<h2 style="font-size:18px;margin:0 0 12px">Você foi convidado para o workspace ${workspace}</h2>`,
    `<p style="color:#444;line-height:1.5;margin:0 0 12px">Um administrador convidou <strong>${escapeHtml(options.to)}</strong> para entrar como <strong>${escapeHtml(roleLabel)}</strong> no Axtro Digital Human OS.</p>`,
    `<p style="color:#444;line-height:1.5;margin:0 0 18px">Para aceitar, crie sua conta usando exatamente este e-mail — o convite é aplicado automaticamente no primeiro acesso.</p>`,
    `<p style="margin:0 0 18px"><a href="${signupUrl}" style="background:#5b4dff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;display:inline-block">Criar minha conta</a></p>`,
    `<p style="color:#888;font-size:12px;line-height:1.5;margin:0">Se você não esperava este convite, ignore este e-mail — nada acontece sem a criação da conta.</p>`,
    `</div>`,
  ].join("");

  return sendHtmlEmail({
    to: [options.to],
    subject: `Convite: workspace ${options.workspaceName} no Axtro Digital Human OS`,
    html,
    logEvent: "invite_email",
  });
}

/**
 * E-mail aos admins do tenant quando um agente é ativado (T9): visibilidade
 * de mudança de estado que afeta o que os clientes veem. Best-effort — nunca
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
  const dashboardUrl = `${process.env.PORTAL_PUBLIC_URL ?? "https://portal-production-b43e.up.railway.app"}/agentes`;
  const agent = escapeHtml(options.agentName);
  const workspace = escapeHtml(options.workspaceName);
  const html = [
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px">`,
    `<h2 style="font-size:18px;margin:0 0 12px">Agente ativado em ${workspace}</h2>`,
    `<p style="color:#444;line-height:1.5;margin:0 0 18px"><strong>${agent}</strong> foi ativado e já pode conversar com clientes usando o conhecimento conectado da conta.</p>`,
    `<p style="margin:0 0 18px"><a href="${dashboardUrl}" style="background:#5b4dff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;display:inline-block">Ver agentes</a></p>`,
    `</div>`,
  ].join("");

  return sendHtmlEmail({
    to: options.to,
    subject: `${options.agentName} foi ativado — ${options.workspaceName}`,
    html,
    logEvent: "agent_activated_email",
  });
}

const MEETING_STATUS_LABEL: Readonly<Record<string, string>> = {
  ended: "encerrou",
  failed: "não conseguiu concluir",
};

/**
 * E-mail aos admins quando uma reunião externa termina (achado da auditoria
 * 2026-08-06): o evento de negócio mais importante do produto — "seu agente
 * acabou de representar você numa reunião de verdade" — não disparava nada;
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
  const dashboardUrl = `${process.env.PORTAL_PUBLIC_URL ?? "https://portal-production-b43e.up.railway.app"}/agentes`;
  const agent = escapeHtml(options.agentName);
  const workspace = escapeHtml(options.workspaceName);
  const statusLabel = MEETING_STATUS_LABEL[options.status];
  const html = [
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px">`,
    `<h2 style="font-size:18px;margin:0 0 12px">Reunião externa ${statusLabel} — ${workspace}</h2>`,
    `<p style="color:#444;line-height:1.5;margin:0 0 12px"><strong>${agent}</strong> ${statusLabel} a reunião externa que você agendou.</p>`,
    `<p style="color:#444;line-height:1.5;margin:0 0 18px">Reunião: <a href="${escapeHtml(options.meetingUrl)}" style="color:#5b4dff">${escapeHtml(options.meetingUrl)}</a></p>`,
    `<p style="margin:0 0 18px"><a href="${dashboardUrl}" style="background:#5b4dff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;display:inline-block">Ver agentes</a></p>`,
    `</div>`,
  ].join("");

  return sendHtmlEmail({
    to: options.to,
    subject: `${options.agentName} ${statusLabel} a reunião externa — ${options.workspaceName}`,
    html,
    logEvent: "meeting_ended_email",
  });
}

/**
 * E-mail aos admins quando um teto diário de uso cruza 80% ou 100% (D-V2-107
 * — gap declarado em docs/COST_OPTIMIZATION.md: "os tetos cortam, mas não
 * avisam antes"). Dedup de disparo é responsabilidade do chamador
 * (lib/cost-alerts.ts) — esta função só formata e envia.
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
  const workspace = escapeHtml(options.workspaceName);
  const capLabel = escapeHtml(options.capLabel);
  const isFull = options.percentUsed >= 100;
  const headline = isFull
    ? `Teto diário de ${options.capLabel} atingido — bloqueado a partir de agora`
    : `${options.workspaceName} está perto do teto diário de ${options.capLabel}`;
  const dashboardUrl = `${process.env.PORTAL_PUBLIC_URL ?? "https://portal-production-b43e.up.railway.app"}/dashboard`;
  const html = [
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px">`,
    `<h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(headline)}</h2>`,
    `<p style="color:#444;line-height:1.5;margin:0 0 12px">Uso de hoje: <strong>${options.currentValue.toLocaleString("pt-BR")} / ${options.capValue.toLocaleString("pt-BR")}</strong> (${options.percentUsed}%) — ${capLabel}, workspace ${workspace}.</p>`,
    isFull
      ? `<p style="color:#444;line-height:1.5;margin:0 0 18px">Novas solicitações desse tipo ficam bloqueadas até a virada do dia (00:00 UTC). O teto existe pra proteger a conta contra gasto inesperado.</p>`
      : `<p style="color:#444;line-height:1.5;margin:0 0 18px">Sem ação necessária agora — é só um aviso antes de chegar no limite.</p>`,
    `<p style="margin:0 0 18px"><a href="${dashboardUrl}" style="background:#5b4dff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;display:inline-block">Ver uso no painel</a></p>`,
    `</div>`,
  ].join("");

  return sendHtmlEmail({
    to: options.to,
    subject: `${options.workspaceName}: ${options.percentUsed}% do teto diário de ${options.capLabel}`,
    html,
    logEvent: "cost_cap_alert_email",
  });
}

/**
 * E-mail de proposta pra um prospect externo, depois de um fechamento ao
 * vivo (D-V2-123): a única mensagem deste arquivo que sai pra um endereço
 * fora do tenant, nunca reaproveitada pelos outros e-mails (todos internos,
 * pra admins já cadastrados). "IA rascunha, humano manda" (doutrina já
 * documentada em docs/BRIEFING_RAISSA_CLOSER_VIDEO.md §6) — este envio
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
  const company = escapeHtml(options.prospectCompanyName);
  const closer = escapeHtml(options.closerName);
  const plan = escapeHtml(options.planLabel);
  const html = [
    `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:24px">`,
    `<h2 style="font-size:18px;margin:0 0 12px">Proposta Axtro Digital Human OS — ${company}</h2>`,
    `<p style="color:#444;line-height:1.5;margin:0 0 12px">Foi ótimo conversar com você. Como combinamos com <strong>${closer}</strong>, aqui está o link pra confirmar o plano <strong>${plan}</strong>.</p>`,
    `<p style="margin:0 0 18px"><a href="${escapeHtml(options.checkoutUrl)}" style="background:#5b4dff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;display:inline-block">Confirmar plano</a></p>`,
    `<p style="color:#888;font-size:12px;line-height:1.5;margin:0">Alguma dúvida antes de confirmar? Responda este e-mail que o time da Axtro te ajuda.</p>`,
    `</div>`,
  ].join("");

  return sendHtmlEmail({
    to: [options.to],
    subject: `Sua proposta Axtro Digital Human OS — ${options.prospectCompanyName}`,
    html,
    logEvent: "proposal_email",
  });
}
