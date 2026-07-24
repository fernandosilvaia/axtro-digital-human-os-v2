import { ImageResponse } from "next/og";

export const alt = "Axtro Digital Human OS, apresentações digitais para vender e atender melhor";
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
        <div style={{ background: "#7668ff", borderRadius: 22, height: 360, opacity: 0.26, position: "absolute", right: -120, top: -140, transform: "rotate(18deg)", width: 640 }} />
        <div style={{ background: "#ff8c75", borderRadius: 999, bottom: -210, height: 420, opacity: 0.13, position: "absolute", right: 180, width: 420 }} />
        <div style={{ alignItems: "center", display: "flex", gap: 16, position: "relative" }}>
          <div style={{ alignItems: "center", background: "linear-gradient(135deg, #9a8cff, #665cff)", borderRadius: 16, display: "flex", fontSize: 26, fontWeight: 800, height: 58, justifyContent: "center", width: 58 }}>A</div>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 25, fontWeight: 700 }}>
            <span>Axtro</span>
            <span style={{ color: "#9691aa", fontSize: 13, letterSpacing: 3, marginTop: 4 }}>DIGITAL HUMAN OS</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 840, position: "relative" }}>
          <span style={{ color: "#ff9d87", fontSize: 17, fontWeight: 700, letterSpacing: 4 }}>A CONVERSA QUE MOVE RECEITA</span>
          <div style={{ fontSize: 60, fontWeight: 800, letterSpacing: -3, lineHeight: 1.04, marginTop: 20 }}>Presença digital para vender, atender e continuar.</div>
          <div style={{ color: "#b4b1bd", fontSize: 23, lineHeight: 1.35, marginTop: 22 }}>Vendas, onboarding e customer success com vídeo ao vivo, conhecimento governado e operação rastreável.</div>
        </div>
        <div style={{ color: "#9f99ff", fontSize: 15, letterSpacing: 2, position: "relative" }}>SALES CLOSER ALPHA / ACESSO ANTECIPADO</div>
      </div>
    ),
    size,
  );
}
