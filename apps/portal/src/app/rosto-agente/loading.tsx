/**
 * Achado real da auto-revisão da onda 7 (D-V2-116): o novo loading.tsx da
 * raiz (apps/portal/src/app/loading.tsx) envolve QUALQUER page.tsx sem
 * loading.tsx próprio abaixo dele — inclusive esta rota, que fica fora de
 * (app)/ e não tinha loading.tsx nenhum antes. Essa página não é uma UI
 * normal: é a "câmera" que o bot do Recall.ai carrega dentro de reuniões
 * externas REAIS — o que renderiza aqui é capturado e mostrado ao vivo pra
 * participantes humanos de verdade. O skeleton cinza genérico da raiz (feito
 * pra chrome de app comum) podia piscar na tela ANTES do palco 100%
 * full-bleed #0b0b16 que face-stage.tsx já usa deliberadamente pro estado
 * "Conectando…" — um glitch visível numa call de vendas ao vivo. Este
 * loading.tsx local sobrepõe o da raiz pra este segmento e replica
 * exatamente o full-bleed escuro que o próprio FaceStage usa, então não há
 * NENHUM frame visualmente diferente entre o loading e o conteúdo real.
 */
export default function AgentFaceLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Carregando"
      style={{
        position: "fixed",
        inset: 0,
        background: "#0b0b16",
      }}
    />
  );
}
