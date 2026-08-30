/**
 * ADR-041, "Um roteador único de tool call, particionado por action_kind".
 * Função pura compartilhável por presentation-room.tsx e (futuramente, fora
 * do escopo desta ADR) video-call.tsx. Cena permanece tratada localmente por
 * cada componente, sem chamar esta função -- ela só encaminha o caminho de
 * negócio até a Server Action nova; um nome de cena ou desconhecido devolve
 * null, e quem chama decide o que fazer (hoje, nada).
 */
import { executeBusinessActionToolCall } from "@/lib/actions/business-action-tool-call";
import { classifyToolCallName } from "@/lib/runtime/tool-call-names";

export interface ToolCallMessage {
  readonly message_type?: string;
  readonly event_type?: string;
  readonly conversation_id?: string;
  readonly properties?: {
    readonly tool_call_id?: string;
    readonly name?: string;
    readonly arguments?: string | Record<string, unknown>;
  };
}

export interface DispatchToolCallInput {
  readonly agentId: string;
  readonly commandId: string;
  readonly mode: "video" | "presentation";
  readonly message: ToolCallMessage;
}

export interface DispatchToolCallResult {
  readonly toolCallId: string;
  readonly status: "success" | "error";
  readonly output: string;
}

export async function dispatchToolCall(input: DispatchToolCallInput): Promise<DispatchToolCallResult | null> {
  const name = input.message.properties?.name ?? "";
  const toolCallId = input.message.properties?.tool_call_id;
  if (!toolCallId) return null;
  if (classifyToolCallName(name) !== "business_action") return null;

  const rawArguments = input.message.properties?.arguments ?? {};
  const result = await executeBusinessActionToolCall(input.agentId, input.commandId, input.mode, name, toolCallId, rawArguments);
  return Object.freeze({ toolCallId, status: result.status, output: result.output });
}
