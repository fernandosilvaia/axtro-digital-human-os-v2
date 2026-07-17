import type { Metadata } from "next";

import { signInDemo } from "@/lib/actions/demo";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Axtro Digital Human OS — Apresentadores digitais com governança de verdade",
  robots: { index: true, follow: true },
};

const FEATURES = [
  {
    title: "Agentes com papel e políticas",
    body: "Cada apresentador digital nasce com papel definido (Sales Closer), perfil de disclosure e limites próprios — nunca um chatbot genérico solto.",
  },
  {
    title: "Conhecimento governado",
    body: "O agente só cita fontes autorizadas pela sua conta, com classificação de dados, rastreabilidade e revogação imediata.",
  },
  {
    title: "Transparência obrigatória",
    body: "Todo agente se apresenta como IA, sempre. Handoff caloroso para humanos quando a conversa pede — com contexto completo.",
  },
  {
    title: "Custo visível por conta",
    body: "Cada token consumido vira registro imutável no ledger da sua conta, com teto diário — sem surpresa na fatura.",
  },
  {
    title: "Isolamento total entre contas",
    body: "Workspace exclusivo por cliente, com isolamento em nível de banco de dados e papéis de equipe (admin e operador).",
  },
  {
    title: "Voz e avatar a caminho",
    body: "A base de tempo real (voz, avatar, telefonia, reuniões) já está construída — os provedores são conectados por conta, com bake-off transparente.",
  },
] as const;

export default async function LandingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="brand-mark" aria-hidden="true">A</span>
            <span className="brand-word">Digital Human OS</span>
          </span>
          <nav style={{ display: "flex", gap: 10 }}>
            {user ? (
              <a className="btn btn-primary" href="/dashboard">Ir para o painel</a>
            ) : (
              <>
                <a className="btn btn-ghost" href="/login">Entrar</a>
                <a className="btn btn-primary" href="/signup">Criar conta</a>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        <section className="hero">
          <span className="badge badge-accent" style={{ marginBottom: 18 }}>
            <span className="badge-dot" />Beta — Sales Closer Alpha
          </span>
          <h1>
            Apresentadores digitais que vendem<br />
            <em>com governança de verdade</em>
          </h1>
          <p>
            O Digital Human OS é a plataforma operacional da Axtro para agentes digitais humanos:
            vendedores com IA que se apresentam como IA, citam só o conhecimento autorizado da sua
            conta e entregam a conversa a um humano na hora certa.
          </p>
          <div className="hero-ctas">
            <form action={signInDemo}>
              <button type="submit" className="btn btn-primary" style={{ padding: "13px 26px", fontSize: "1rem" }}>
                Ver demonstração ao vivo
              </button>
            </form>
            <a className="btn btn-ghost" href="/signup" style={{ padding: "13px 26px", fontSize: "1rem" }}>
              Criar minha conta
            </a>
          </div>
          <p style={{ fontSize: "0.78rem", color: "var(--text-faint)", marginTop: 14 }}>
            A demonstração entra numa conta compartilhada com dados fictícios — sem cadastro, sem cartão.
          </p>
        </section>

        <section className="landing-features" aria-label="Diferenciais">
          {FEATURES.map((feature) => (
            <article key={feature.title} className="card card-hover">
              <h3 style={{ fontSize: "1rem", marginBottom: 8 }}>{feature.title}</h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", margin: 0 }}>{feature.body}</p>
            </article>
          ))}
        </section>

        <section className="landing-cta card">
          <h2 style={{ fontSize: "1.3rem" }}>Veja um agente respondendo agora</h2>
          <p style={{ color: "var(--text-muted)", maxWidth: 560, margin: "8px auto 20px" }}>
            Entre na conta de demonstração, abra um agente e converse com ele no sandbox —
            ele se apresenta como IA e mostra como qualifica um cliente de verdade.
          </p>
          <form action={signInDemo}>
            <button type="submit" className="btn btn-primary" style={{ padding: "12px 24px" }}>
              Entrar na demonstração
            </button>
          </form>
        </section>
      </main>

      <footer className="landing-footer">
        <span>© 2026 Axtro AI — todos os direitos reservados</span>
        <span>fernando@axtroai.com</span>
      </footer>
    </div>
  );
}
