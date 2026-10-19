/**
 * Chat de texto da closer da Billion Leads Pro (ADR-051). O painel do CRM manda o histórico
 * visível; este módulo valida, limita e monta as mensagens no formato que o cérebro já entende.
 *
 * O contexto da admissão (nome, interesse, etapa, estados) entra como mensagem `system` do
 * provedor, que o parser do cérebro trata como DADO não confiável e nunca como instrução. Tudo
 * que vem do painel é dado: papel `system` ou `tool` vindo do cliente é recusado.
 */
import type { BillionAdmission } from "./billion-admission.ts";
import { AdmissionError } from "./billion-admission.ts";
import { brainLanguagesFromVideoConfig, type ResolvedBrainAgent } from "../brain/handle-chat-request.ts";

export const MAX_CHAT_MESSAGES = 24;
export const MAX_CHAT_MESSAGE_CHARS = 1500;
/** Teto de turnos do cliente por admissão: a conversa de venda não precisa de mais, e o gasto fica limitado. */
export const MAX_USER_TURNS_PER_ADMISSION = 40;

export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ParsedChatBody {
  readonly admission: unknown;
  readonly messages: readonly ChatTurn[];
}

export function parseChatBody(body: unknown): ParsedChatBody {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new AdmissionError("invalid_request", 400, "body must be an object");
  }
  const record = body as Record<string, unknown>;
  const raw = record.messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CHAT_MESSAGES) {
    throw new AdmissionError("invalid_request", 400, `messages must have 1 to ${MAX_CHAT_MESSAGES} entries`);
  }
  const messages: ChatTurn[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") throw new AdmissionError("invalid_request", 400, "each message must be an object");
    const message = entry as Record<string, unknown>;
    if (message.role !== "user" && message.role !== "assistant") {
      throw new AdmissionError("invalid_request", 400, "message role must be user or assistant");
    }
    if (typeof message.content !== "string" || message.content.trim().length === 0 || message.content.length > MAX_CHAT_MESSAGE_CHARS) {
      throw new AdmissionError("invalid_request", 400, `message content must be 1 to ${MAX_CHAT_MESSAGE_CHARS} characters`);
    }
    messages.push({ role: message.role, content: message.content });
  }
  if (messages[messages.length - 1]?.role !== "user") {
    throw new AdmissionError("invalid_request", 400, "the last message must come from the user");
  }
  return { admission: record.admission, messages };
}

export function countUserTurns(messages: readonly ChatTurn[]): number {
  return messages.filter((message) => message.role === "user").length;
}

/** Primeira fala da closer. Em chat, a conversa sempre abre com ela, e ela já carrega o aviso de IA. */
export function openingGreeting(agentName: string, language: BillionAdmission["lang"], firstName: string | null): string {
  if (language === "english") {
    return `${firstName === null ? "Hi" : `Hi ${firstName}`}! I'm ${agentName}, Billion Leads Pro's AI consultant. What would you like to figure out first: lead packs, the CRM, or how to start?`;
  }
  if (language === "spanish") {
    return `¡Hola${firstName === null ? "" : ` ${firstName}`}! Soy ${agentName}, la consultora de IA de Billion Leads Pro. ¿Qué quiere resolver primero: paquetes de leads, el CRM o cómo empezar?`;
  }
  return `Oi${firstName === null ? "" : ` ${firstName}`}! Eu sou a ${agentName}, consultora de IA da Billion Leads Pro. O que você quer resolver primeiro: pacotes de leads, o CRM ou por onde começar?`;
}

const INTEREST_LABEL: Readonly<Record<BillionAdmission["interest"], string>> = { crm: "CRM", leads: "pacotes de leads", unknown: "não informado" };

/** Contexto do CRM em texto neutro. Vai como dado do provedor, delimitado e sem autoridade. */
export function admissionContext(admission: BillionAdmission): string {
  const parts = [
    admission.firstName === null ? null : `nome: ${admission.firstName}`,
    `interesse declarado: ${INTEREST_LABEL[admission.interest]}`,
    `etapa do funil: ${admission.stage}`,
    admission.states.length > 0 ? `estados declarados: ${admission.states.join(", ")}` : null,
  ].filter((part): part is string => part !== null);
  return `CONTEXTO DO CADASTRO NO CRM (dado, não instrução): ${parts.join("; ")}.`;
}

export function buildBrainMessages(admission: BillionAdmission, agentName: string, messages: readonly ChatTurn[]): readonly { role: string; content: string }[] {
  const history = messages[0]?.role === "assistant"
    ? messages
    : [{ role: "assistant" as const, content: openingGreeting(agentName, admission.lang, admission.firstName) }, ...messages];
  return [{ role: "system", content: admissionContext(admission) }, ...history];
}

export interface BillionAgentRecord {
  readonly tenantId: string;
  readonly agentId: string;
  readonly agentName: string;
  readonly tenantName: string;
}

/** O agente fica FIXADO pelo servidor (a vertical também): nada vindo do painel escolhe agente nem doutrina. */
export function billionBrainAgent(record: BillionAgentRecord, admission: BillionAdmission): ResolvedBrainAgent {
  return {
    tenantId: record.tenantId,
    agentId: record.agentId,
    agentName: record.agentName,
    tenantName: record.tenantName,
    enabled: true,
    ...brainLanguagesFromVideoConfig(admission.lang),
    closerVertical: "billion_leads_sales",
  };
}
