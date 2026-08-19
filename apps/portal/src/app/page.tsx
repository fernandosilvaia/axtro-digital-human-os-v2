import Image from "next/image";

import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { DemoSubmitButton } from "./demo-button";
import { signInDemo } from "@/lib/actions/demo";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl, createPageMetadata, SITE_NAME } from "@/lib/site";

export const metadata = createPageMetadata({
  title: "Axtro Closer AI Human | Closer de IA em vídeo com controle",
  description:
    "Conheça o Axtro Closer AI Human: uma experiência de closer de IA em vídeo com disclosure claro, contexto autorizado e supervisão da sua operação.",
  path: "/",
});

const CLOSER_PILLARS = [
  {
    number: "01",
    title: "O momento de interesse não vira espera",
    body: "Transforme uma intenção já criada em um convite claro para a próxima conversa — sem inventar urgência nem perder o contexto pelo caminho.",
  },
  {
    number: "02",
    title: "A conversa parte do que foi autorizado",
    body: "Conhecimento, política e permissões ficam definidos antes da interação. A experiência não precisa adivinhar preço, prazo ou promessa.",
  },
  {
    number: "03",
    title: "O próximo passo fica visível para a equipe",
    body: "A operação registra o que foi combinado e prepara um handoff quando uma pessoa precisa assumir a decisão ou a continuidade.",
  },
] as const;

const OPERATING_STEPS = [
  {
    number: "01",
    title: "Interesse",
    body: "Sua operação reconhece o momento em que vale abrir uma conversa — sem prometer disponibilidade que não existe.",
  },
  {
    number: "02",
    title: "Conversa",
    body: "Uma experiência em vídeo, configurada pela conta, começa com a IA identificada e um contexto delimitado.",
  },
  {
    number: "03",
    title: "Decisão",
    body: "O resultado, o contexto e a próxima ação ficam claros para quem continua a relação com aquele contato.",
  },
] as const;

const TRUST_POINTS = [
  "IA identificada desde o início",
  "Contexto e fontes autorizados",
  "Registro operacional por conversa",
] as const;

const FAQ_ITEMS = [
  {
    question: "O que é o Axtro Closer AI Human?",
    answer:
      "É o role pack comercial do Axtro Digital Human OS. Ele organiza uma experiência de closer de IA em vídeo para empresas que querem conduzir conversas com mais consistência, contexto autorizado e supervisão operacional.",
  },
  {
    question: "A Raissa é uma pessoa entrando na chamada?",
    answer:
      "Não. Raissa é a identidade visual apresentada nesta experiência. Quando uma interação em vídeo está configurada, o sistema identifica a IA de forma explícita antes da conversa e registra o disclosure correspondente.",
  },
  {
    question: "O closer de IA fecha vendas sozinho?",
    answer:
      "Não é essa a promessa. A configuração define o que a experiência pode apresentar, quais fontes pode usar e quando deve chamar uma pessoa. Decisões, propostas e ações seguem políticas e confirmações da operação.",
  },
  {
    question: "Como a empresa mantém o controle da conversa?",
    answer:
      "Cada experiência usa contexto autorizado, consentimentos aplicáveis e políticas explícitas. A plataforma mantém eventos e receipts operacionais para que a equipe possa revisar a interação e conduzir o próximo passo com clareza.",
  },
  {
    question: "Como funciona a demonstração?",
    answer:
      "A demonstração abre um workspace compartilhado com dados fictícios. Ela permite conhecer o produto sem cartão; recursos de produção e provedores reais dependem da configuração, do consentimento e da aprovação da empresa.",
  },
] as const;

const STRUCTURED_DATA = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${absoluteUrl("/")}#organization`,
    name: "Axtro AI",
    url: absoluteUrl("/"),
    logo: absoluteUrl("/icons/icon-512.png"),
    description: "Empresa responsável pelo Axtro Closer AI Human e pelo Axtro Digital Human OS.",
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${absoluteUrl("/")}#website`,
    name: SITE_NAME,
    url: absoluteUrl("/"),
    inLanguage: "pt-BR",
    publisher: { "@id": `${absoluteUrl("/")}#organization` },
    description: "Axtro Closer AI Human: closer de IA em vídeo com contexto autorizado e operação rastreável.",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": `${absoluteUrl("/")}#software`,
    name: "Axtro Closer AI Human",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: absoluteUrl("/"),
    image: absoluteUrl("/opengraph-image"),
    inLanguage: "pt-BR",
    publisher: { "@id": `${absoluteUrl("/")}#organization` },
    description: "Experiência de closer de IA em vídeo com disclosure claro, contexto autorizado e supervisão da operação.",
    featureList: [
      "Experiência de vídeo configurável",
      "Contexto e fontes autorizados",
      "Disclosure de inteligência artificial",
      "Registro operacional por conversa",
      "Handoff com contexto",
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  },
];

export default async function LandingPage() {
  const user = await getPublicSessionUser();

  return (
    <div className="landing landing--closer">
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <a className="brand-lockup" href="#top" aria-label="Axtro Closer AI Human, início">
            <span className="brand-mark" aria-hidden="true">A</span>
            <span>
              <span className="brand-word">Axtro</span>
              <span className="brand-subword">Closer AI Human</span>
            </span>
          </a>
          <nav className="landing-nav-links" aria-label="Navegação da landing page">
            <a href="#como-funciona">Como funciona</a>
            <a href="#sistema">O sistema</a>
            <a href="#governanca">Governança</a>
            <a href="#faq">FAQ</a>
          </nav>
          <nav className="landing-nav-actions" aria-label="Ações de conta">
            {user ? (
              <a className="btn btn-primary btn-small" href="/dashboard">Abrir sistema <ArrowIcon /></a>
            ) : (
              <>
                <a className="btn btn-ghost btn-small" href="/login">Entrar</a>
                <a className="btn btn-primary btn-small" href="/signup">Começar <ArrowIcon /></a>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero hero-premium closer-hero" aria-labelledby="closer-hero-title">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-pulse" /> Closer AI Human em vídeo</div>
            <h1 id="closer-hero-title">Seu melhor closer não deveria caber na agenda.</h1>
            <p className="hero-lead">
              Raissa apresenta uma experiência de closer de IA em vídeo: contexto autorizado,
              disclosure claro e a sua operação no controle da conversa.
            </p>
            <div className="hero-ctas hero-ctas-left">
              <form action={signInDemo}>
                <DemoSubmitButton className="btn btn-primary btn-large">Assistir à demonstração <ArrowIcon /></DemoSubmitButton>
              </form>
              <a className="btn btn-ghost btn-large" href="#como-funciona">Como funciona <ChevronIcon /></a>
            </div>
            <div className="hero-proof-row" aria-label="Compromissos da demonstração">
              <span><CheckIcon /> IA sempre identificada</span>
              <span><CheckIcon /> Dados fictícios na demo</span>
              <span><CheckIcon /> Sem cartão</span>
            </div>
          </div>

          <div className="hero-visual closer-hero-visual" aria-label="Raissa em uma experiência demonstrativa do Axtro Closer AI Human">
            <Image
              className="hero-image closer-hero-image"
              src="/assets/digital-human/raissa-closer-hero.png"
              alt="Raissa no estúdio Axtro, identidade visual da experiência Closer AI Human"
              width={1537}
              height={1023}
              priority
              sizes="(max-width: 980px) 100vw, 58vw"
            />
            <div className="hero-floating-card hero-floating-card-top closer-disclosure-card">
              <span className="floating-label"><span className="status-dot" /> IA IDENTIFICADA</span>
              <strong>Experiência demonstrativa</strong>
              <span>Vídeo configurável por conta</span>
            </div>
            <div className="hero-floating-card hero-floating-card-bottom closer-control-card">
              <span className="floating-label">OPERAÇÃO NO CONTROLE</span>
              <strong>Contexto antes da conversa</strong>
              <span className="floating-signal"><span /> Disclosure <span /> Consentimento <span /> Receipt</span>
            </div>
            <div className="hero-visual-caption"><span>01</span><span>Axtro Closer AI Human</span></div>
          </div>
        </section>

        <section className="proof-strip closer-proof-strip" aria-label="Pilares da experiência">
          <span className="proof-strip-label">Uma conversa que respeita o momento — e o controle da sua operação</span>
          <div className="proof-strip-items">
            <span>CONTEXTO AUTORIZADO</span><i /> <span>DISCLOSURE DE IA</span><i /> <span>SUPERVISÃO HUMANA</span>
          </div>
        </section>

        <section className="landing-section closer-flow-section" id="como-funciona" aria-labelledby="closer-flow-title">
          <RevealOnScroll className="section-heading split-heading closer-section-heading">
            <div>
              <span className="section-kicker">Do interesse à decisão</span>
              <h2 id="closer-flow-title">O interesse não deveria esfriar até a próxima vaga na agenda.</h2>
            </div>
            <p>
              O closer não é uma promessa de piloto automático. É uma experiência deliberada para
              transformar o momento de interesse em uma conversa clara, sob regras da sua equipe.
            </p>
          </RevealOnScroll>
          <div className="closer-flow-grid">
            {OPERATING_STEPS.map((step, index) => (
              <RevealOnScroll key={step.number} delay={index * 90} className="closer-flow-wrap">
                <article className="closer-flow-card">
                  <span className="closer-flow-number">{step.number}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <span className="closer-flow-index" aria-hidden="true">{index < OPERATING_STEPS.length - 1 ? "→" : "●"}</span>
                </article>
              </RevealOnScroll>
            ))}
          </div>
        </section>

        <section className="landing-section closer-system-section" id="sistema" aria-labelledby="closer-system-title">
          <RevealOnScroll className="closer-system-layout">
            <div className="closer-system-visual">
              <Image
                src="/assets/digital-human/hero-presenter.png"
                alt="Visual do sistema de apresentador digital Axtro em uma interface de operação"
                width={1680}
                height={945}
                sizes="(max-width: 980px) 100vw, 48vw"
              />
              <span className="closer-system-visual-label">A camada do sistema</span>
            </div>
            <div className="closer-system-copy">
              <span className="section-kicker">Mais do que uma tela bonita</span>
              <h2 id="closer-system-title">A presença chama atenção. O sistema sustenta a conversa.</h2>
              <p>
                A Axtro conecta identidade, fontes autorizadas, políticas de execução e recibos
                operacionais para que a experiência de vídeo possa ser útil sem virar uma caixa-preta.
              </p>
              <ul className="closer-trust-list">
                {TRUST_POINTS.map((point) => <li key={point}><CheckIcon /> {point}</li>)}
              </ul>
              <a className="text-link" href="/signup">Conhecer o workspace <ArrowIcon /></a>
            </div>
          </RevealOnScroll>
        </section>

        <section className="landing-section closer-pillars-section" aria-labelledby="closer-pillars-title">
          <RevealOnScroll className="section-heading centered-heading closer-section-heading">
            <span className="section-kicker">O que muda na operação</span>
            <h2 id="closer-pillars-title">Presença para a conversa. Clareza para quem decide.</h2>
            <p>Uma base para tratar cada interação importante com mais contexto e menos improviso.</p>
          </RevealOnScroll>
          <div className="feature-grid closer-pillar-grid">
            {CLOSER_PILLARS.map((pillar, index) => (
              <RevealOnScroll key={pillar.number} delay={index * 90} className="feature-card-wrap">
                <article className="feature-card closer-pillar-card">
                  <div className="feature-card-top"><span>{pillar.number}</span><span aria-hidden="true">Axtro</span></div>
                  <div className="feature-card-line" />
                  <h3>{pillar.title}</h3>
                  <p>{pillar.body}</p>
                </article>
              </RevealOnScroll>
            ))}
          </div>
        </section>

        <section className="landing-section governance-section closer-governance-section" id="governanca">
          <RevealOnScroll className="governance-layout closer-governance-layout">
            <div className="governance-copy">
              <span className="section-kicker">Confiança por arquitetura</span>
              <h2>Vender bem importa. Saber por que uma resposta saiu importa ainda mais.</h2>
              <p>
                Antes de entrar em campo, a experiência recebe um propósito, um contexto autorizado
                e regras claras. Cada etapa sensível deixa evidência para a empresa revisar e agir.
              </p>
              <a className="text-link" href="/signup">Construir minha operação <ArrowIcon /></a>
            </div>
            <div className="closer-governance-list" aria-label="Princípios de governança do sistema">
              <article><span>01</span><strong>Disclosure</strong><p>A IA se apresenta antes de participar.</p></article>
              <article><span>02</span><strong>Contexto</strong><p>Fontes e limites pertencem à sua operação.</p></article>
              <article><span>03</span><strong>Receipts</strong><p>Ações sensíveis pedem confirmação e deixam rastro.</p></article>
            </div>
          </RevealOnScroll>
        </section>

        <section className="landing-section faq-section closer-faq-section" id="faq" aria-labelledby="faq-title">
          <RevealOnScroll className="section-heading split-heading closer-section-heading">
            <div>
              <span className="section-kicker">Respostas diretas</span>
              <h2 id="faq-title">O que você precisa saber antes de levar um closer de IA para a operação.</h2>
            </div>
            <p>
              Transparência vem antes da contratação. Estas são as respostas essenciais sobre a
              demonstração, o escopo e o controle da experiência.
            </p>
          </RevealOnScroll>
          <RevealOnScroll className="faq-list">
            {FAQ_ITEMS.map((item) => (
              <details className="faq-item" key={item.question}>
                <summary>{item.question}<span aria-hidden="true">+</span></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </RevealOnScroll>
        </section>

        <section className="landing-section closing-section closer-closing-section">
          <RevealOnScroll className="closing-panel closer-closing-panel">
            <div className="closing-panel-mark"><span className="eyebrow-pulse" /> Próxima conversa</div>
            <h2>Veja como uma conversa em vídeo pode começar com mais clareza.</h2>
            <p>Entre no workspace de demonstração e conheça o Axtro Closer AI Human com dados fictícios.</p>
            <form action={signInDemo}>
              <DemoSubmitButton className="btn btn-light btn-large">Abrir demonstração <ArrowIcon /></DemoSubmitButton>
            </form>
            <span className="closing-note">Demo compartilhada, dados fictícios, sem cadastro e sem cartão.</span>
          </RevealOnScroll>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">A</span><span><span className="brand-word">Axtro</span><span className="brand-subword">Closer AI Human</span></span></div>
        <span>© 2026 Axtro AI. Conversas com presença, operação com clareza.</span>
        <a href="/precos">Planos e preços</a>
        <a href="/termos">Termos de Uso</a>
        <a href="/privacidade">Privacidade</a>
        <a href="mailto:fernando@axtroai.com">fernando@axtroai.com</a>
      </footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }} />
    </div>
  );
}

/**
 * A página pública continua útil quando a infraestrutura de autenticação está
 * indisponível: a única consequência é mostrar os CTAs de visitante. Rotas
 * protegidas preservam a sua verificação de sessão e nunca usam este fallback.
 */
async function getPublicSessionUser() {
  try {
    const supabase = await createClient();
    const user = supabase.auth.getUser()
      .then(({ data, error }) => (error ? null : data.user))
      .catch(() => null);
    return await Promise.race([
      user,
      new Promise<null>((resolve) => setTimeout(resolve, 1_000)),
    ]);
  } catch {
    return null;
  }
}

function ArrowIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ChevronIcon() {
  return <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function CheckIcon() {
  return <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="m3 7 2.3 2.3L11 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
