import Link from "next/link";

import { formatUsdCents, PLAN_CATALOG, PLAN_ORDER } from "@/lib/billing/plans";
import { createPageMetadata } from "@/lib/site";

export const metadata = createPageMetadata({
  title: "Preços — Axtro Digital Human OS",
  description: "Planos com conversas de vídeo incluídas por mês e overage transparente — sem taxa de setup, sem contrato mínimo.",
  path: "/precos",
});

const PLAN_TAGS: Record<string, string> = {
  piloto: "Entrada",
  crescimento: "Recomendado",
  escala: "Volume",
};

const PLAN_PITCHES: Record<string, string> = {
  piloto: "Para validar o produto com os primeiros leads reais.",
  crescimento: "Para times que já vendem por vídeo toda semana.",
  escala: "Para operações de alto volume com várias agentes ativas.",
};

export default function PricingPage() {
  return (
    <main style={{ maxWidth: 1040, margin: "0 auto", padding: "56px 24px 80px" }}>
      <div style={{ marginBottom: 40 }}>
        <Link href="/" style={{ color: "var(--accent)", fontSize: "0.85rem" }}>← Axtro Digital Human OS</Link>
      </div>

      <header style={{ marginBottom: 48, maxWidth: 640 }}>
        <h1 style={{ fontSize: "2rem", marginBottom: 12, lineHeight: 1.2 }}>
          Um preço que carrega o que uma conversa em vídeo realmente custa
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: "1rem", lineHeight: 1.6 }}>
          Cada plano inclui um número de conversas de vídeo na sala Axtro e apresentações com
          slides por mês. O uso adicional é registrado conforme o plano e permanece sujeito às
          políticas operacionais e de cobrança da conta.
        </p>
      </header>

      <div className="grid grid-3" style={{ gap: 20, alignItems: "stretch" }}>
        {PLAN_ORDER.map((planId) => {
          const plan = PLAN_CATALOG[planId];
          return (
            <section
              key={plan.id}
              className="card"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                borderColor: planId === "crescimento" ? "var(--accent)" : undefined,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h2 style={{ fontSize: "1.05rem" }}>{plan.name}</h2>
                <span style={{ fontSize: "0.72rem", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {PLAN_TAGS[planId]}
                </span>
              </div>

              <div>
                <span style={{ fontSize: "1.9rem", fontWeight: 700 }}>{formatUsdCents(plan.priceUsdCents)}</span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>/mês</span>
              </div>

              <p style={{ color: "var(--text-muted)", fontSize: "0.86rem", minHeight: "2.6em" }}>
                {PLAN_PITCHES[planId]}
              </p>

              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.88rem", color: "var(--text)", display: "grid", gap: 6 }}>
                <li><strong>{plan.includedConversationsPerMonth} conversas de vídeo</strong> incluídas por mês</li>
                <li>Excedente: {formatUsdCents(plan.overageUsdCentsPerConversation)} por conversa extra</li>
                <li>Agentes e fontes de conhecimento incluídos</li>
                <li>Reuniões externas (Zoom/Meet/Teams) aguardam rollout com consentimento individual por participante</li>
                <li>Painel de uso e custo em tempo real</li>
              </ul>

              <div style={{ marginTop: "auto", paddingTop: 8 }}>
                <Link href="/signup" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: "10px 16px" }}>
                  Começar
                </Link>
              </div>
            </section>
          );
        })}
      </div>

      <p style={{ marginTop: 28, color: "var(--text-faint)", fontSize: "0.82rem", maxWidth: 640 }}>
        Crie sua conta gratuitamente e assine o plano em Configurações — sem cartão para explorar
        a plataforma primeiro. Preços em dólar (custo de operação é 100% em USD); troca e
        cancelamento de plano a qualquer momento, sem multa.
      </p>

      <p style={{ marginTop: 40, fontSize: "0.85rem" }}>
        <a href="mailto:fernando@axtroai.com?subject=Plano%20sob%20medida" style={{ color: "var(--accent)" }}>
          Precisa de um volume diferente ou um contrato anual? Fale com o time →
        </a>
      </p>
    </main>
  );
}
