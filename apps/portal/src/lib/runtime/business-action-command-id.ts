import { createHash } from "node:crypto";

import { canonicalJson } from "@axtro/domain";

/**
 * ADR-041, "Idempotência amarrada ao tool_call_id do Tavus, não a um novo
 * UUID aleatório por tentativa". Módulo auxiliar novo, deliberadamente fora
 * de portal-business-action-bridge.ts: é uma função pura de derivação, sem
 * client Supabase e sem estado, então não precisa viver dentro do bridge que
 * já concentra toda a validação/side effect da admissão de negócio -- manter
 * a derivação separada deixa o próprio bridge mais fácil de ler (ele só
 * recebe um commandId já pronto, nunca decide como derivá-lo).
 *
 * tool_call_id do Tavus não tem shape documentado neste repositório (ver
 * ADR-041); não é seguro assumir que já é um UUID. deterministicBusinessActionCommandId
 * deriva um UUID versão 5 (RFC 4122 sec. 4.3 -- determinístico por
 * construção, ao contrário do UUIDv7 que ADR-013 reserva para identificador
 * com semântica de tempo de criação real) a partir da concatenação canônica
 * de (tenantId, agentId, sessionId, actionKind, toolCallId): os mesmos cinco
 * valores sempre produzem o mesmo commandId, então um retry de rede do canal
 * de dados do Daily reenviando a mesma tool_call cai no mesmo
 * commandFingerprint em admitBusinessAction e recebe "replayed" em vez de
 * admitir um segundo grant (e, no caso de register_lead, um segundo lead).
 *
 * UUID_PATTERN que portal-business-action-bridge.ts já usa para validar
 * commandId (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
 * já aceita a versão 5 no nibble de versão -- confirmado manualmente contra
 * o vetor de teste oficial da RFC 4122 (namespace DNS + "www.example.com" =>
 * 2ed6657d-e927-568b-95e1-2665a8aea6a2) antes de integrar esta função.
 *
 * Sem dependência nova: o monorepo não tem "uuid" nem equivalente instalado
 * (confirmado por grep em todo package.json antes de escrever isto); a
 * implementação usa só node:crypto (sha1), o mesmo algoritmo que a RFC 4122
 * define para UUIDv5.
 */

/**
 * Namespace fixo da Axtro Digital Human OS para esta derivação, gerado uma
 * única vez (crypto.randomUUID() local, fora de qualquer dado real de
 * produção) e congelado como constante -- NUNCA mude este valor: um
 * namespace diferente rederiva um commandId diferente para toda tool call
 * já emitida, quebrando a garantia de idempotência para retries em voo no
 * momento da troca. Não é nenhum dos namespaces padrão da própria RFC 4122
 * (DNS/URL/OID/X.500); é um namespace privado só desta aplicação.
 */
const BUSINESS_ACTION_COMMAND_ID_NAMESPACE = "0040394f-7213-4455-ac55-79bb2cb0ea44";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidToBytes(uuid: string): Buffer {
  if (!UUID_PATTERN.test(uuid)) throw new Error("uuidV5 namespace must be a UUID");
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * RFC 4122 sec. 4.3, name-based UUID with SHA-1: hash namespace bytes +
 * name bytes, take the first 16 bytes of the digest, then overwrite the
 * version nibble (byte 6 high nibble -> 0101) and the variant bits (byte 8
 * top two bits -> 10). Verified against the RFC's own DNS-namespace test
 * vector before this function was wired into the bridge (see module doc).
 */
function uuidV5(name: string, namespace: string): string {
  const digest = createHash("sha1").update(uuidToBytes(namespace)).update(Buffer.from(name, "utf8")).digest();
  const bytes = digest.subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

/**
 * Pure and deterministic: same five inputs, same output, every time, on
 * every process. Never validates its inputs as UUIDs itself -- the caller
 * (executeBusinessActionToolCall) already resolves tenantId/agentId/sessionId
 * from trusted server-side state before calling this, and admitBusinessAction
 * validates the returned commandId as a UUID on the way in regardless.
 */
export function deterministicBusinessActionCommandId(
  tenantId: string,
  agentId: string,
  sessionId: string,
  actionKind: string,
  toolCallId: string,
): string {
  const material = canonicalJson({ tenantId, agentId, sessionId, actionKind, toolCallId });
  return uuidV5(material, BUSINESS_ACTION_COMMAND_ID_NAMESPACE);
}
