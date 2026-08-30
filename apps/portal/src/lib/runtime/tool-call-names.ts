/**
 * ADR-041, "Um roteador único de tool call, particionado por action_kind,
 * nunca por string solta duas vezes". Duas allowlists fechadas e disjuntas:
 * fonte única da verdade para qualquer componente/Server Action que precise
 * decidir se uma tool call de uma sala ao vivo é de cena (ADR-038, sempre
 * tratada localmente no navegador, nunca chega a um Server Action) ou de
 * ação de negócio (ADR-039/041, roteada até executeBusinessActionToolCall).
 *
 * presentation-room.tsx tinha essa lista de cena hardcoded inline (linha
 * 218 antes desta onda); video-call.tsx vai precisar da mesma decisão
 * quando ganhar call object (fora do escopo desta ADR). Um nome fora das
 * duas listas nunca ganha autoridade nenhuma -- Art. 15, um nome de tool
 * desconhecido é dado não confiável por padrão.
 */
export const SCENE_TOOL_NAMES = ["next_slide", "previous_slide", "go_to_slide"] as const;
export type SceneToolName = (typeof SCENE_TOOL_NAMES)[number];

export const BUSINESS_ACTION_TOOL_NAMES = ["register_lead", "propose_meeting_slots", "confirm_meeting_slot"] as const;
export type BusinessActionToolName = (typeof BUSINESS_ACTION_TOOL_NAMES)[number];

export type ToolCallCategory = "scene" | "business_action" | "unknown";

const SCENE_TOOL_NAME_SET: ReadonlySet<string> = new Set(SCENE_TOOL_NAMES);
const BUSINESS_ACTION_TOOL_NAME_SET: ReadonlySet<string> = new Set(BUSINESS_ACTION_TOOL_NAMES);

export function classifyToolCallName(name: string): ToolCallCategory {
  if (SCENE_TOOL_NAME_SET.has(name)) return "scene";
  if (BUSINESS_ACTION_TOOL_NAME_SET.has(name)) return "business_action";
  return "unknown";
}

export function isSceneToolName(name: string): name is SceneToolName {
  return SCENE_TOOL_NAME_SET.has(name);
}

export function isBusinessActionToolName(name: string): name is BusinessActionToolName {
  return BUSINESS_ACTION_TOOL_NAME_SET.has(name);
}
