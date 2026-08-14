import type { Metadata } from "next";

import { resolveAgentFaceStageCapability } from "@/lib/meetings/stage";

import { FaceStage } from "./face-stage";

/**
 * Rota PÚBLICA consumida pelo bot do Recall.ai como "câmera" dele dentro de
 * reuniões externas (Output Media). Recebe apenas uma capability aleatória
 * curta e resolve a sala no servidor, mostrando só o rosto da agente.
 *
 * Por que pública: o bot do Recall.ai roda num navegador sem sessão nossa —
 * não há sessão de usuário disponível. A capability é tenant-bound, expira
 * em prazo curto e só seu hash fica persistido. A room URL, que é um bearer,
 * nunca aparece na URL pública/logável desta rota.
 *
 * `noindex` explícito: é superfície técnica, não conteúdo público.
 */
export const metadata: Metadata = {
  title: "Palco do agente — Axtro Digital Human OS",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AgentFacePage({
  searchParams,
}: {
  searchParams: Promise<{ cap?: string }>;
}) {
  const { cap } = await searchParams;
  let resolved = null;
  try {
    resolved = await resolveAgentFaceStageCapability(typeof cap === "string" ? cap : "");
  } catch {
    // Resolution fails closed and does not log the public bearer.
  }

  if (resolved === null) {
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

  return <FaceStage roomUrl={resolved.roomUrl} />;
}
