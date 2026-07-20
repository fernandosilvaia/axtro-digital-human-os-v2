// Módulo exclusivo de servidor (importado apenas por server actions, mesma
// convenção de knowledge.ts): envio de e-mail transacional via Resend —
// mesmo provedor do SMTP de auth (D-V2-063, domínio axtroai.com verificado).
// Sem RESEND_API_KEY (ou em PORTAL_FAKE_PROVIDERS=1) o envio vira mock
// logado: o fluxo do produto nunca quebra por falta de chave.
import { createHash } from "node:crypto";

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
 * E-mail de convite de equipe (modelo e-mail pré-aprovado, D-V2-060): avisa o
 * convidado para criar a conta com ESTE e-mail — o provisionamento o coloca
 * no workspace automaticamente. Falha aqui nunca desfaz o convite.
 */
export async function sendInviteEmail(options: {
  readonly to: string;
  readonly workspaceName: string;
  readonly role: string;
}): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const signupUrl = `${process.env.PORTAL_PUBLIC_URL ?? "https://portal-production-b43e.up.railway.app"}/signup`;
  const roleLabel = ROLE_LABELS[options.role] ?? options.role;

  if (apiKey.trim().length === 0 || process.env.PORTAL_FAKE_PROVIDERS === "1") {
    // Log estruturado sem PII: destinatário vira hash curto, correlacionável
    // sem expor o e-mail.
    console.info(JSON.stringify({
      event: "invite_email_mocked",
      reason: "no_api_key_or_fake_mode",
      to_hash: createHash("sha256").update(options.to.toLowerCase(), "utf8").digest("hex").slice(0, 12),
    }));
    return { sent: false, reason: "mocked_no_key" };
  }

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [options.to],
        subject: `Convite: workspace ${options.workspaceName} no Axtro Digital Human OS`,
        html,
      }),
    });
    if (!response.ok) {
      console.error(JSON.stringify({ event: "invite_email_failed", status: response.status }));
      return { sent: false, reason: "provider_error" };
    }
    return { sent: true, reason: "sent" };
  } catch (error) {
    console.error(JSON.stringify({
      event: "invite_email_failed",
      error: error instanceof Error ? error.name : "unknown",
    }));
    return { sent: false, reason: "provider_error" };
  } finally {
    clearTimeout(timer);
  }
}
