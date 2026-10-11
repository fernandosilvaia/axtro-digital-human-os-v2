import type { TextGenerationToolCall } from "@axtro/provider-openrouter";
import { createUuidV7 } from "@axtro/domain";

function sseChunk(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/**
 * SSE `chat.completion.chunk` no formato OpenAI. Com tools pedidas pelo modelo,
 * a fala (se houver) sai primeiro e as chamadas vão num delta `tool_calls`, com
 * `finish_reason: "tool_calls"`: é assim que a Tavus repassa a chamada ao
 * navegador como `conversation.tool_call`.
 */
export function buildCompletionStream(
  reply: string,
  model: string,
  toolCalls: readonly TextGenerationToolCall[] = [],
): ReadableStream<Uint8Array> {
  const id = `brain-${createUuidV7()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }],
      })));
      if (toolCalls.length > 0) {
        controller.enqueue(encoder.encode(sseChunk({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{
            index: 0,
            delta: {
              tool_calls: toolCalls.map((call, index) => ({
                index,
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.argumentsJson },
              })),
            },
            finish_reason: null,
          }],
        })));
      }
      controller.enqueue(encoder.encode(sseChunk({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop" }],
      })));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
