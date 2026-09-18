/**
 * CSRF `state` do fluxo de conexão OAuth do Google Calendar (ADR-039, onda
 * 1b-ii), a primeira rota de callback OAuth por redirect de navegador deste
 * repositório; todo outro `api/*` existente é webhook push
 * (provider → servidor), sem essa superfície de ataque. Sem validar `state`
 * corretamente, um atacante poderia induzir um `tenant_admin` vítima a
 * conectar a conta Google DO ATACANTE ao tenant da vítima (ou vice-versa):
 * o CSRF clássico de OAuth (RFC 6749 §10.12).
 *
 * POR QUE ISTO DEIXOU DE SER UM MAP EM MEMÓRIA (D-V2-174)
 * A versão anterior guardava os `state` pendentes num `Map` de processo. O
 * arquivo documentava como ressalva o risco de múltiplas réplicas, mas o modo
 * de falha real é outro e acontece com UMA instância só: quem grava é a
 * Server Action `startGoogleCalendarConnection` e quem lê é o route handler
 * do callback, e o Next.js empacota os dois separadamente, então cada lado
 * carrega a própria instância do módulo e o próprio Map. O que a Action
 * gravava, o callback nunca enxergava.
 *
 * Medido em produção em 2026-09-13: `state` novo, callback chamado 5 segundos
 * depois, mesma sessão, `numReplicas: 1`, sem restart no intervalo, e ainda
 * assim `state_invalido`. A conexão de calendário nunca pôde ser concluída
 * desde que foi construída.
 *
 * O armazenamento agora é a tabela `google_calendar_oauth_states` (0065),
 * acessada só por duas RPC `service_role`. Isso reverte conscientemente a
 * decisão registrada na versão anterior deste arquivo ("não precisa
 * sobreviver a restart, então não vira tabela"): aquele raciocínio partia da
 * premissa de que o Map funcionava entre os dois lados, e ele nunca
 * funcionou.
 *
 * O que NÃO mudou, e continua valendo:
 * - Token aleatório de 256 bits (`randomBytes(32)`), não adivinhável, gerado
 *   no início do fluxo e amarrado a `(tenantId, actorId)`.
 * - TTL curto (10 minutos): generoso para a tela de consentimento do Google,
 *   curto o bastante para reduzir a janela de um `state` vazado por algum
 *   caminho fora do nosso controle.
 * - Uso único, agora garantido de verdade: o `DELETE ... RETURNING` da RPC é
 *   atômico, enquanto `Map.get` seguido de `Map.delete` não impedia sozinho
 *   duas leituras concorrentes.
 * - Teto por tenant (o achado da revisão adversarial): um tenant que abre
 *   fluxos sem concluir nunca pode empurrar para fora o `state` pendente de
 *   outro tenant, porque a poda é feita dentro do próprio tenant.
 *
 * O que mudou além do armazenamento: o banco guarda o SHA-256 do token, nunca
 * o token. Mesma disciplina de `portal_resolve_agent_brain_config_service`,
 * que casa por hash de segredo. Quem consegue ler a tabela não consegue
 * completar o fluxo pendente de ninguém.
 */
import { createHash, randomBytes } from "node:crypto";

import { createServiceRoleClient } from "@/lib/supabase/service";

const STATE_TTL_SECONDS = 600;

/**
 * Cliente de serviço injetável. Existe só para teste: o caminho de produção
 * sempre usa `createServiceRoleClient`. Sem isto, testar este módulo exigiria
 * um Postgres de verdade, e o comportamento que mais importa aqui (recusar
 * quando não dá para provar que o `state` era legítimo) é justamente o que
 * precisa ser fácil de exercitar.
 */
export interface GoogleCalendarOAuthStateDeps {
  readonly serviceClient?: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
}

/** O banco nunca vê o token, só este hash. */
function hashState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/**
 * Gera e persiste um `state` novo amarrado a `(tenantId, actorId)`. Chamado
 * uma vez por tentativa de conexão, no início do fluxo (Server Action
 * `startGoogleCalendarConnection`), cada clique em "Conectar"/"Reconectar"
 * gera um `state` novo e independente.
 *
 * Lança se a persistência falhar: seguir para o Google com um `state` que o
 * callback nunca vai reconhecer só produziria o mesmo erro confuso lá na
 * frente, que é exatamente o defeito que esta versão corrige.
 */
export async function createGoogleCalendarOAuthState(
  tenantId: string,
  actorId: string,
  dependencies: GoogleCalendarOAuthStateDeps = {},
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  const service = dependencies.serviceClient ?? createServiceRoleClient();
  const { error } = await service.rpc("portal_begin_google_calendar_oauth_state_service", {
    p_state_hash: hashState(state),
    p_tenant_id: tenantId,
    p_actor_id: actorId,
    p_ttl_seconds: STATE_TTL_SECONDS,
  });
  if (error) {
    const detail = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "unknown";
    throw new Error(`google calendar oauth state could not be stored: ${detail}`);
  }
  return state;
}

export interface ConsumedGoogleCalendarOAuthState {
  readonly tenantId: string;
  readonly actorId: string;
}

/**
 * Consome (remove) e valida um `state` recebido na rota de callback.
 * `null` cobre uniformemente "nunca existiu", "já foi consumido antes"
 * (replay) e "expirou": a rota de callback nunca precisa (nem deve)
 * distinguir esses três casos pro usuário final; todos viram o mesmo aviso
 * genérico "tente conectar de novo". Falha de infraestrutura também vira
 * `null`: recusar é o comportamento seguro quando não dá para provar que o
 * `state` era legítimo.
 */
export async function consumeGoogleCalendarOAuthState(
  state: string,
  dependencies: GoogleCalendarOAuthStateDeps = {},
): Promise<ConsumedGoogleCalendarOAuthState | null> {
  let service;
  try {
    service = dependencies.serviceClient ?? createServiceRoleClient();
  } catch {
    // Service role indisponível: recusar é o comportamento seguro.
    return null;
  }
  const { data, error } = await service.rpc("portal_consume_google_calendar_oauth_state_service", {
    p_state_hash: hashState(state),
  });
  if (error) return null;
  const row = data as { outcome?: string; tenantId?: string; actorId?: string } | null;
  if (row === null || row.outcome !== "found" || typeof row.tenantId !== "string" || typeof row.actorId !== "string") {
    return null;
  }
  return { tenantId: row.tenantId, actorId: row.actorId };
}
