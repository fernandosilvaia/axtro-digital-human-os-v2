import { ImageResponse } from "next/og";

export const alt = "Axtro Closer AI Human, closer de IA em vídeo com presença identificada e operação sob controle";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "#08090d",
          color: "#f5f4f1",
          display: "flex",
          flexDirection: "column",
          fontFamily: "Arial, sans-serif",
          height: "100%",
          justifyContent: "space-between",
          overflow: "hidden",
          padding: "56px 68px",
          position: "relative",
          width: "100%",
        }}
      >
        <div style={{ background: "#ef3639", borderRadius: 22, height: 360, opacity: 0.26, position: "absolute", right: -120, top: -140, transform: "rotate(18deg)", width: 640 }} />
        <div style={{ background: "#ff6b57", borderRadius: 999, bottom: -210, height: 420, opacity: 0.13, position: "absolute", right: 180, width: 420 }} />
        <div style={{ alignItems: "center", display: "flex", gap: 16, position: "relative" }}>
          <div style={{ alignItems: "center", background: "linear-gradient(135deg, #ff5e5e, #bd171d)", borderRadius: 16, display: "flex", fontSize: 26, fontWeight: 800, height: 58, justifyContent: "center", width: 58 }}>A</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 25, fontWeight: 700 }}>
            <span>Axtro</span>
            <span style={{ color: "#b7a4a5", fontSize: 13, letterSpacing: 3, marginTop: 4 }}>CLOSER AI HUMAN</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 840, position: "relative" }}>
          <span style={{ color: "#ff8c82", fontSize: 17, fontWeight: 700, letterSpacing: 4 }}>CLOSER DE IA EM VÍDEO</span>
          <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: -3, lineHeight: 1.04, marginTop: 20 }}>Presença em vídeo para a conversa que importa.</div>
          <div style={{ color: "#c5bfc0", fontSize: 23, lineHeight: 1.35, marginTop: 22 }}>Contexto autorizado, identificação de IA e controle operacional para a sua equipe comercial.</div>
        </div>
        <div style={{ color: "#ff9a91", fontSize: 15, letterSpacing: 2, position: "relative" }}>IA IDENTIFICADA · CONHECIMENTO AUTORIZADO · HANDOFF COM CONTEXTO</div>
      </div>
    ),
    size,
  );
}
