import type { Metadata } from "next";

import { signInDemo } from "@/lib/actions/demo";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Axtro Digital Human OS — Apresentadores digitais com governança de verdade",
  robots: { index: true, follow: true },
};

const FEATURES = [
  {
    title: "Venda em vídeo, ao vivo",
    body: "Seu agente aparece em vídeo, escuta e fala como numa reunião real — rapport, descoberta, objeções e fechamento, tudo na mesma conversa.",
  },
  {
    title: "Fecha a venda do início ao fim",
    body: "Nada de \"vou te passar pra um consultor\": o agente conduz o ciclo completo e pede o compromisso. Handoff humano existe como opção sua — não como muleta.",
  },
  {
    title: "Conhecimento governado",
    body: "O agente só cita fontes autorizadas pela sua conta, com classificação de dados, rastreabilidade e revogação imediata — ele nunca inventa preço ou promessa.",
  },
  {
    title: "Transparência que gera confiança",
    body: "Todo agente se apresenta como IA, sempre. Vender bem e ser honesto sobre o que se é andam juntos — por arquitetura, não por promessa.",
  },
  {
    title: "Custo visível por conta",
    body: "Cada token e cada minuto de vídeo viram registro imutável no ledger da sua conta, com teto diário — sem surpresa na fatura.",
  },
  {
    title: "Isolamento total entre contas",
    body: "Workspace exclusivo por cliente, com isolamento em nível de banco de dados e papéis de equipe (admin e operador).",
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
            O Digital Human OS é a plataforma operacional da Axtro para vendedores digitais
            humanizados: agentes que entram na reunião em vídeo, conversam por voz e conduzem a
            venda inteira — da descoberta ao fechamento — citando só o conhecimento autorizado
            da sua conta.
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
          <h2 style={{ fontSize: "1.3rem" }}>Converse em vídeo com uma vendedora digital agora</h2>
          <p style={{ color: "var(--text-muted)", maxWidth: 560, margin: "8px auto 20px" }}>
            Entre na demonstração, abra a Rafaela e clique em &quot;Iniciar conversa em vídeo&quot; —
            ela aparece na tela, te escuta e conduz a venda por voz, do primeiro olá ao fechamento.
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
