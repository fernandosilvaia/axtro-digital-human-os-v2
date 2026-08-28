/**
 * CSRF `state` do fluxo de conexão OAuth do Google Calendar (ADR-039, onda
 * 1b-ii) — a primeira rota de callback OAuth por redirect de navegador deste
 * repositório; todo outro `api/*` existente é webhook push
 * (provider → servidor), sem essa superfície de ataque. Sem validar `state`
 * corretamente, um atacante poderia induzir um `tenant_admin` vítima a
 * conectar a conta Google DO ATACANTE ao tenant da vítima (ou vice-versa) —
 * o CSRF clássico de OAuth (RFC 6749 §10.12).
 *
 * Decisão de design (não havia precedente direto no repo pra isto — o mais
 * próximo em espírito é a evidência de consentimento/disclosure durável de
 * `consent_evidence`, mas aquilo é durável por design e este é um recurso
 * novo, de vida curta, propositalmente NÃO durável):
 *
 * - Token aleatório de 256 bits (`randomBytes(32)`, mesmo tamanho da
 *   capability de callback do Tavus em `transcripts/register.ts`), não
 *   adivinhável, gerado no início do fluxo (`createGoogleCalendarOAuthState`)
 *   e amarrado a `(tenantId, actorId)` — não a um cookie de sessão
 *   separado, porque a própria sessão Supabase (cookie httpOnly) já prova
 *   quem é o `actorId` autenticado no momento em que a rota de callback
 *   reautentica (`supabase.auth.getUser()`); o `state` só precisa provar que
 *   ESTA tentativa de callback corresponde a UMA conexão que ESTE
 *   tenant/actor iniciou de verdade, não uma que um atacante montou.
 * - Armazenado em memória de processo (`Map`), o mesmo mecanismo e a mesma
 *   ressalva operacional já documentada e aceita em `rate-limit.ts`:
 *   processo único no Railway hoje; se um dia houver réplicas, isto vira
 *   melhor-esforço por instância (um `state` gerado numa réplica e
 *   consumido noutra falharia fechado — erro visível pro usuário, "tente
 *   conectar de novo", nunca uma falha de segurança silenciosa). Não é a
 *   tabela nova `consent_evidence`-like porque não há nada aqui que precise
 *   sobreviver a um restart do processo ou ser auditável depois: um `state`
 *   nunca usado dentro da janela de 10 minutos simplesmente expira e o
 *   `tenant_admin` tenta de novo.
 * - TTL curto (10 minutos, generoso o bastante pra tela de consentimento do
 *   Google, curto o bastante pra reduzir a janela de um `state` vazado por
 *   algum caminho fora do nosso controle, ex.: log de proxy de terceiro).
 * - Uso único: consumido (removido do Map) na primeira leitura, sucesso ou
 *   falha — um `state` reaproveitado (replay) nunca é aceito de novo, seja
 *   pelo atacante seja por um retry acidental do navegador.
 * - Bound de tamanho GLOBAL (`MAX_TRACKED_STATES`) com eviction do mais
 *   antigo do processo inteiro, mesma disciplina defensiva de
 *   `rate-limit.ts`, como backstop de memória total. **Achado real da
 *   revisão de segurança adversarial**: um bound só global, sem checar
 *   tenant, permite um `tenant_admin` malicioso (ou vários coordenados —
 *   alcançável aqui porque o cadastro é self-service) gerar volume de
 *   `state` sem nunca concluir o fluxo e empurrar pra fora do Map um `state`
 *   pendente LEGÍTIMO de OUTRO tenant — mesmo respeitando o rate limiter por
 *   tenant de `calendar-connection.ts` (a soma entre tenants diferentes
 *   nunca era limitada). Por isso existe também `MAX_TRACKED_STATES_PER_TENANT`:
 *   ao atingir o teto por tenant, evict só a entrada mais antiga DAQUELE
 *   MESMO tenant, nunca de outro. A chave em si (o token de 256 bits)
 *   continua não sendo escolhível pelo chamador, então não há risco de
 *   colisão/poisoning por adivinhação — o risco fechado aqui era puramente
 *   volumétrico entre tenants distintos, não de adivinhação de chave.
 */
import { randomBytes } from "node:crypto";

const STATE_TTL_MS = 10 * 60_000;
const MAX_TRACKED_STATES = 200;

/** Mesmo formato de clock injetável de `provider-google-calendar` (`{ now(): number }`) — permite testar TTL de 10min sem sleep real nem depender de mock global de `Date`. */
export interface GoogleCalendarOAuthStateClock {
  now(): number;
}

const SYSTEM_CLOCK: GoogleCalendarOAuthStateClock = { now: () => Date.now() };

interface PendingGoogleCalendarOAuthState {
  readonly tenantId: string;
  readonly actorId: string;
  readonly expiresAt: number;
}

const pendingStates = new Map<string, PendingGoogleCalendarOAuthState>();

function pruneExpired(now: number): void {
  for (const [state, pending] of pendingStates) {
    if (pending.expiresAt <= now) pendingStates.delete(state);
  }
}

/**
 * Achado real da revisão de segurança adversarial (onda 1b-ii): o bound
 * global sozinho (`MAX_TRACKED_STATES`) evict o item mais antigo do Map
 * INTEIRO, sem checar de qual tenant ele é — um tenant malicioso (ou vários
 * coordenados, alcançável nesta aplicação porque o cadastro é self-service)
 * gerando volume de `state` sem nunca completar o fluxo pode empurrar pra
 * fora do Map um `state` pendente LEGÍTIMO de outro tenant, forçando esse
 * tenant_admin vítima a ver "state_invalido" no meio do próprio fluxo dele.
 * O rate limiter por tenant em `calendar-connection.ts`
 * (`google-calendar-connect:<tenantId>`, 6/min) não impede isto: a soma
 * entre tenants diferentes nunca é limitada, e mesmo um único tenant sozinho
 * respeitando esse limite poderia acumular até 60 states pendentes ao longo
 * da janela de TTL de 10 minutos (6/min × 10min) — já mais que uma fração
 * razoável do bound global de 200. Por isso este bound por tenant é
 * necessário ALÉM do bound global (que continua existindo como backstop de
 * memória total do processo): ao atingir o teto por tenant, evict só a
 * entrada mais antiga DAQUELE MESMO tenant, nunca de outro — preservando a
 * garantia central deste arquivo (nenhum tenant pode afetar o `state`
 * pendente de outro).
 */
const MAX_TRACKED_STATES_PER_TENANT = 8;

function evictOldestForTenant(tenantId: string): void {
  for (const [state, pending] of pendingStates) {
    if (pending.tenantId === tenantId) {
      pendingStates.delete(state);
      return;
    }
  }
}

function countForTenant(tenantId: string): number {
  let count = 0;
  for (const pending of pendingStates.values()) {
    if (pending.tenantId === tenantId) count += 1;
  }
  return count;
}

/**
 * Gera e persiste um `state` novo amarrado a `(tenantId, actorId)`. Chamado
 * uma vez por tentativa de conexão, no início do fluxo (Server Action
 * `startGoogleCalendarConnection`), nunca reexecutado por um retry — cada
 * clique em "Conectar"/"Reconectar" gera um `state` novo e independente.
 */
export function createGoogleCalendarOAuthState(tenantId: string, actorId: string, clock: GoogleCalendarOAuthStateClock = SYSTEM_CLOCK): string {
  const now = clock.now();
  pruneExpired(now);
  if (countForTenant(tenantId) >= MAX_TRACKED_STATES_PER_TENANT) {
    evictOldestForTenant(tenantId);
  }
  if (pendingStates.size >= MAX_TRACKED_STATES) {
    const oldestState = pendingStates.keys().next().value;
    if (oldestState !== undefined) pendingStates.delete(oldestState);
  }
  const state = randomBytes(32).toString("base64url");
  pendingStates.set(state, { tenantId, actorId, expiresAt: now + STATE_TTL_MS });
  return state;
}

export interface ConsumedGoogleCalendarOAuthState {
  readonly tenantId: string;
  readonly actorId: string;
}

/**
 * Consome (remove) e valida um `state` recebido na rota de callback.
 * `null` cobre uniformemente "nunca existiu", "já foi consumido antes"
 * (replay) e "expirou" — a rota de callback nunca precisa (nem deve)
 * distinguir esses três casos pro usuário final; todos viram o mesmo aviso
 * genérico "tente conectar de novo".
 */
export function consumeGoogleCalendarOAuthState(state: string, clock: GoogleCalendarOAuthStateClock = SYSTEM_CLOCK): ConsumedGoogleCalendarOAuthState | null {
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (pending === undefined || pending.expiresAt <= clock.now()) return null;
  return { tenantId: pending.tenantId, actorId: pending.actorId };
}
