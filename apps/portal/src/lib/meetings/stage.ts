/**
 * URL pública do palco que o bot do Recall.ai renderiza como câmera dele.
 * Precisa ser absoluta e alcançável da internet — o bot roda fora daqui.
 * Compartilhado entre a action de entrada imediata (meeting-bot.ts) e o
 * webhook que liga a câmera do bot sentinela agendado.
 */
export function agentFaceStageUrl(tavusRoomUrl: string): string {
  const base = (process.env.PORTAL_PUBLIC_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://portal-production-b43e.up.railway.app").replace(/\/$/, "");
  return `${base}/rosto-agente?sala=${encodeURIComponent(tavusRoomUrl)}`;
}
