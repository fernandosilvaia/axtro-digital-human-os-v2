import type { Metadata } from "next";

import { FaceStage } from "./face-stage";

/**
 * Rota PÚBLICA consumida pelo bot do Recall.ai como "câmera" dele dentro de
 * reuniões externas (Output Media). Recebe a sala do Tavus por query param
 * e entra nela sozinha, mostrando só o rosto da agente.
 *
 * Por que pública: o bot do Recall.ai roda num navegador sem sessão nossa —
 * não há como autenticar. A URL da sala do Tavus JÁ É a credencial (quem
 * tem o link entra na conversa), então passá-la por query param não amplia
 * o acesso: é a mesma capacidade, carregada por outro caminho. Salas do
 * Tavus são efêmeras e expiram com a conversa.
 *
 * `noindex` explícito: é superfície técnica, não conteúdo público.
 */
export const metadata: Metadata = {
  title: "Palco do agente — Axtro Digital Human OS",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ALLOWED_ROOM_HOSTS = new Set(["tavus.daily.co"]);

export default async function AgentFacePage({
  searchParams,
}: {
  searchParams: Promise<{ sala?: string }>;
}) {
  const { sala } = await searchParams;
  const roomUrl = typeof sala === "string" ? sala.trim() : "";

  // Só aceitamos salas do próprio provider de vídeo: sem isso, esta rota
  // viraria um renderizador de página arbitrária dentro de reuniões alheias.
  let allowed = false;
  try {
    const parsed = new URL(roomUrl);
    allowed = parsed.protocol === "https:" && ALLOWED_ROOM_HOSTS.has(parsed.host);
  } catch {
    allowed = false;
  }

  if (!allowed) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0b0b16",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(226,222,255,0.75)",
          fontFamily: "system-ui, sans-serif",
          fontSize: "1rem",
          textAlign: "center",
          padding: 24,
        }}
      >
        Sala de vídeo inválida ou ausente.
      </div>
    );
  }

  return <FaceStage roomUrl={roomUrl} />;
}
