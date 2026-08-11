// Alertas proativos de custo (D-V2-107): antes, nenhum dos 4 tetos diários
// do produto (vídeo, tokens do brain, tokens do chat de teste, vídeo do
// lead) avisava ninguém antes de cortar — o dono só descobria quando um
// cliente reclamava que o agente parou de responder (gap declarado em
// docs/COST_OPTIMIZATION.md). Chamado inline, no MESMO ponto que já lê o
// uso atual pra decidir bloquear — nenhuma query nova de "quanto usei
// hoje". Fire-and-forget em todo call site (nunca aguardado): nunca
// adiciona latência real no caminho de um turno de chat/vídeo ao vivo.
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendCostCapAlertEmail } from "./email.ts";
import { createServiceRoleClient } from "./supabase/service.ts";
import { logError as trackError } from "./telemetry.ts";

export type CostCapKind = "daily_tokens" | "daily_video_conversations";

const CAP_LABEL: Readonly<Record<CostCapKind, string>> = {
  daily_tokens: "tokens de IA (chat de teste + cérebro custom)",
  daily_video_conversations: "conversas de vídeo",
};

interface MaybeAlertCostCapOptions {
  readonly tenantId: string;
  readonly capKind: CostCapKind;
  readonly current: number;
  readonly cap: number;
}

/**
 * Dispara e-mail aos admins do tenant quando o uso de hoje cruza 80% ou
 * 100% de um teto diário. Best-effort: nunca lança, nunca bloqueia — todo
 * call site deve chamar sem `await`. Dedup via portal_claim_cost_alert_service
 * (0031): no máximo 1 e-mail por (tenant, teto, threshold, dia UTC), mesmo
 * sob chamadas concorrentes.
 *
 * `supabaseOverride` é só pra teste (injeta um client fake) — os 4 call
 * sites de produção nunca passam o 2º argumento; o client de service role
 * real só é criado DEPOIS do fast-path (nunca antes), pra nunca lançar por
 * falta de SUPABASE_SERVICE_ROLE_KEY no caminho comum (uso bem abaixo do teto).
 */
export async function maybeAlertCostCap(options: MaybeAlertCostCapOptions, supabaseOverride?: SupabaseClient): Promise<void> {
  const { tenantId, capKind, current, cap } = options;
  if (cap <= 0) return;
  if (current / cap < 0.8) return; // fast path: sem I/O no caso comum (a grande maioria das chamadas)
  const threshold = current >= cap ? 100 : 80;
  const alertKey = `${capKind}:${threshold}`;

  try {
    const supabase = supabaseOverride ?? createServiceRoleClient();
    const { data: claimData, error: claimError } = await supabase.rpc("portal_claim_cost_alert_service", {
      p_tenant_id: tenantId,
      p_alert_key: alertKey,
    });
    if (claimError) {
      trackError("cost_alert_claim_failed", claimError, { tenant_id: tenantId, cost_alert: alertKey });
      return;
    }
    const claimed = (claimData as { claimed?: unknown } | null)?.claimed === true;
    if (!claimed) return; // já alertado hoje pra este teto/threshold

    const [adminsResult, tenantResult] = await Promise.all([
      supabase.rpc("portal_list_admin_emails_service", { p_tenant_id: tenantId }),
      supabase.from("tenants").select("legal_name").eq("id", tenantId).maybeSingle(),
    ]);
    if (adminsResult.error) {
      trackError("cost_alert_admins_lookup_failed", adminsResult.error, { tenant_id: tenantId, cost_alert: alertKey });
      return;
    }
    const admins = Array.isArray(adminsResult.data) ? (adminsResult.data as string[]) : [];
    if (admins.length === 0) return;
    const workspaceName = typeof tenantResult.data?.legal_name === "string" ? tenantResult.data.legal_name : "sua conta";

    await sendCostCapAlertEmail({
      to: admins,
      workspaceName,
      capLabel: CAP_LABEL[capKind],
      currentValue: current,
      capValue: cap,
      percentUsed: threshold,
    });
  } catch (error) {
    trackError("cost_alert_dispatch_failed", error, { tenant_id: tenantId, cap_kind: capKind });
  }
}
