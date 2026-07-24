import Image from "next/image";

import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { signInDemo } from "@/lib/actions/demo";
import { createClient } from "@/lib/supabase/server";
import { absoluteUrl, createPageMetadata, SITE_NAME } from "@/lib/site";

export const metadata = createPageMetadata({
  title: "Axtro Digital Human OS | Closer digital para cada conversa que importa",
  description:
    "Apresentadores digitais para vendas, onboarding e customer success, com vídeo ao vivo, conhecimento governado e operação rastreável.",
  path: "/",
});

const FEATURE_CARDS = [
  {
    number: "01",
    title: "Conduz a conversa inteira",
    body: "Descoberta, contexto, objeções e próximo passo em uma só presença. O lead não é empurrado de um canal para outro.",
    accent: "violet",
  },
  {
    number: "02",
    title: "Responde com o que sua empresa autorizou",
    body: "Fontes governadas, contexto por conta e rastreabilidade para vender com clareza, sem inventar preço, prazo ou promessa.",
    accent: "coral",
  },
  {
    number: "03",
    title: "Continua depois do sim",
    body: "O mesmo sistema pode apresentar, fazer onboarding, atualizar customer success e preparar o handoff quando ele realmente fizer sentido.",
    accent: "blue",
  },
] as const;

const OPERATING_MOMENTS = [
  { label: "Vendas", detail: "Mais conversas qualificadas, menos lead perdido", icon: "↗" },
  { label: "Onboarding", detail: "A mesma clareza desde o primeiro dia", icon: "◌" },
  { label: "Customer Success", detail: "Atualizações que não dependem de lembrete", icon: "✦" },
] as const;

const FAQ_ITEMS = [
  {
    question: "O que é o Axtro Digital Human OS?",
    answer: "O Axtro Digital Human OS é uma plataforma para criar e operar apresentadores digitais que participam de conversas em vídeo, conduzem vendas, fazem onboarding e apoiam customer success. A operação combina presença digital, contexto autorizado e registros de execução para que a empresa escale atendimento sem transformar o agente em uma caixa-preta.",
  },
  {
    question: "Para quem o Digital Human OS foi criado?",
    answer: "A plataforma foi criada para empresas que precisam conduzir muitas conversas com consistência, especialmente times de vendas, implantação e relacionamento. O primeiro produto é o Sales Closer Alpha, mas o kernel suporta papéis de apresentação, qualificação, onboarding e atualização de clientes conforme os provedores e fluxos da conta são configurados.",
  },
  {
    question: "O agente digital pode conduzir uma venda?",
    answer: "Sim. O Sales Closer Alpha foi desenhado para conduzir descoberta, contexto, objeções e próximo passo em uma conversa de vídeo. A ação precisa seguir políticas e confirmações do sistema. Quando uma transferência para uma pessoa fizer sentido, o handoff acontece com contexto, controle de Presenter e registro operacional.",
  },
  {
    question: "Como a governança funciona?",
    answer: "Cada conversa usa conhecimento autorizado pela conta, passa por políticas explícitas e registra eventos, ações e receipts. Isso permite revisar o que aconteceu, controlar permissões, separar tenants e evitar que o agente invente preço, promessa ou conclusão de ação sem confirmação do sistema.",
  },
  {
    question: "O agente se identifica como inteligência artificial?",
    answer: "Sim. O disclosure de IA é obrigatório no início da interação e não pode ser removido pelo estilo da persona. A plataforma foi construída para que presença digital e transparência caminhem juntas, com a prova do disclosure persistida fora do prompt.",
  },
  {
    question: "Existe uma demonstração do produto?",
    answer: "Sim. A demonstração pública entra em uma conta compartilhada com dados fictícios e permite conhecer o workspace e a experiência do agente configurado. Ela não exige cadastro nem cartão. A ativação de provedores reais, uso em produção e decisões de lançamento dependem da configuração e da aprovação da empresa.",
  },
] as const;

const STRUCTURED_DATA = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Axtro AI",
    url: absoluteUrl("/"),
    logo: absoluteUrl("/icon.svg"),
    description: "Empresa responsável pelo Axtro Digital Human OS.",
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: absoluteUrl("/"),
    inLanguage: "pt-BR",
    description: "Apresentadores digitais para vendas, onboarding e customer success.",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: absoluteUrl("/"),
    image: absoluteUrl("/opengraph-image"),
    inLanguage: "pt-BR",
    description: "Plataforma operacional para agentes digitais com vídeo, voz, conhecimento governado e receipts de execução.",
    featureList: ["Vendas em vídeo", "Onboarding", "Customer success", "Conhecimento governado", "Handoff com contexto"],
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="landing">
      <div className="landing-orbit landing-orbit-one" aria-hidden="true" />
      <div className="landing-orbit landing-orbit-two" aria-hidden="true" />
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <a className="brand-lockup" href="#top" aria-label="Axtro Digital Human OS, início">
            <span className="brand-mark" aria-hidden="true">A</span>
            <span>
              <span className="brand-word">Axtro</span>
              <span className="brand-subword">Digital Human OS</span>
            </span>
          </a>
          <nav className="landing-nav-links" aria-label="Navegação da landing page">
            <a href="#sistema">O sistema</a>
            <a href="#momentos">Casos de uso</a>
            <a href="#governanca">Governança</a>
            <a href="#faq">FAQ</a>
          </nav>
          <nav className="landing-nav-actions">
            {user ? (
              <a className="btn btn-primary btn-small" href="/dashboard">Abrir workspace <ArrowIcon /></a>
            ) : (
              <>
                <a className="btn btn-ghost btn-small" href="/login">Entrar</a>
                <a className="btn btn-primary btn-small" href="/signup">Criar conta <ArrowIcon /></a>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero hero-premium">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-pulse" /> Sales Closer Alpha <span className="eyebrow-separator">/</span> acesso antecipado</div>
            <h1>
              A conversa que move sua receita <span className="gradient-text">não pode depender do acaso.</span>
            </h1>
            <p className="hero-lead">
              O Axtro Digital Human OS coloca uma presença digital treinada para conduzir vendas,
              onboarding e customer success com consistência, vídeo ao vivo e conhecimento governado.
            </p>
            <div className="hero-ctas hero-ctas-left">
              <form action={signInDemo}>
                <button type="submit" className="btn btn-primary btn-large">Ver demonstração ao vivo <ArrowIcon /></button>
              </form>
              <a className="btn btn-ghost btn-large" href="#sistema">Entender o sistema <ChevronIcon /></a>
            </div>
            <div className="hero-proof-row">
              <span><CheckIcon /> Dados fictícios na demo</span>
              <span><CheckIcon /> Sem cartão</span>
              <span><CheckIcon /> IA sempre identificada</span>
            </div>
          </div>

          <div className="hero-visual" aria-label="Visual de um apresentador digital da Axtro">
            <div className="hero-visual-glow" aria-hidden="true" />
            <Image
              className="hero-image"
              src="/assets/digital-human/hero-presenter.png"
              alt="Apresentador digital sintético em uma interface luminosa de vendas"
              width={1680}
              height={945}
              priority
            />
            <div className="hero-floating-card hero-floating-card-top">
              <span className="floating-label"><span className="status-dot status-dot-live" /> AO VIVO</span>
              <strong>Rafaela está pronta</strong>
              <span>Sales Closer · pt-BR</span>
            </div>
            <div className="hero-floating-card hero-floating-card-bottom">
              <span className="floating-label">OPERAÇÃO</span>
              <strong>Governance layer active</strong>
              <span className="floating-signal"><span /> Knowledge <span /> Policy <span /> Receipt</span>
            </div>
            <div className="hero-visual-caption"><span>01</span><span>Digital presence, engineered for revenue</span></div>
          </div>
        </section>

        <section className="proof-strip" aria-label="Áreas de aplicação">
          <span className="proof-strip-label">Uma presença digital para cada conversa que importa</span>
          <div className="proof-strip-items">
            <span>VENDAS</span><i /> <span>ONBOARDING</span><i /> <span>CUSTOMER SUCCESS</span><i /> <span>OPERAÇÕES</span>
          </div>
        </section>

        <section className="landing-section intro-section" id="sistema">
          <RevealOnScroll className="section-heading split-heading">
            <div>
              <span className="section-kicker">A camada que faltava</span>
              <h2>Não é mais um chatbot. É uma operação comercial com presença.</h2>
            </div>
            <p>
              Pessoas compram quando sentem clareza, ritmo e confiança. O Digital Human OS junta
              presença em vídeo, inteligência contextual e uma camada de governança para que sua equipe
              possa escalar o que funciona sem perder o controle.
            </p>
          </RevealOnScroll>

          <div className="feature-grid">
            {FEATURE_CARDS.map((feature, index) => (
              <RevealOnScroll key={feature.number} delay={index * 90} className="feature-card-wrap">
                <article className={`feature-card feature-card-${feature.accent}`}>
                  <div className="feature-card-top"><span>{feature.number}</span><ArrowUpIcon /></div>
                  <div className="feature-card-line" />
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                  <span className="feature-card-bottom">Capacidade nativa <span>↗</span></span>
                </article>
              </RevealOnScroll>
            ))}
          </div>
        </section>

        <section className="landing-section moments-section" id="momentos">
          <RevealOnScroll className="section-heading centered-heading">
            <span className="section-kicker">Uma base, vários momentos</span>
            <h2>A mesma inteligência. Mais lugares para gerar valor.</h2>
            <p>Comece pelo closer. Expanda para onde sua operação perde energia hoje.</p>
          </RevealOnScroll>
          <div className="moments-grid">
            {OPERATING_MOMENTS.map((moment, index) => (
              <RevealOnScroll key={moment.label} delay={index * 100} className="moment-card-wrap">
                <article className="moment-card">
                  <div className="moment-icon">{moment.icon}</div>
                  <div>
                    <span className="moment-index">0{index + 1}</span>
                    <h3>{moment.label}</h3>
                    <p>{moment.detail}</p>
                  </div>
                  <span className="moment-arrow">↗</span>
                </article>
              </RevealOnScroll>
            ))}
          </div>
        </section>

        <section className="landing-section governance-section" id="governanca">
          <RevealOnScroll className="governance-layout">
            <div className="governance-copy">
              <span className="section-kicker">Confiança por arquitetura</span>
              <h2>Vender bem é importante. Saber exatamente por que a resposta saiu é decisivo.</h2>
              <p>
                Cada conversa nasce com um contexto autorizado, passa por políticas claras e deixa
                evidência operacional. O seu agente pode ser convincente sem ser uma caixa-preta.
              </p>
              <a className="text-link" href="/signup">Construir minha operação <ArrowIcon /></a>
            </div>
            <div className="governance-visual" aria-label="Fluxo de governança do Digital Human OS">
              <div className="governance-orbit orbit-a" aria-hidden="true" />
              <div className="governance-orbit orbit-b" aria-hidden="true" />
              <div className="governance-center"><span className="brand-mark">A</span><strong>Digital<br />Human OS</strong><small>decision layer</small></div>
              <div className="governance-node node-knowledge"><span>01</span><strong>Knowledge</strong><small>fontes autorizadas</small></div>
              <div className="governance-node node-policy"><span>02</span><strong>Policy</strong><small>limites claros</small></div>
              <div className="governance-node node-receipt"><span>03</span><strong>Receipt</strong><small>ação confirmada</small></div>
              <div className="governance-node node-timeline"><span>04</span><strong>Timeline</strong><small>histórico rastreável</small></div>
            </div>
          </RevealOnScroll>
        </section>

        <section className="landing-section faq-section" id="faq" aria-labelledby="faq-title">
          <RevealOnScroll className="section-heading split-heading">
            <div>
              <span className="section-kicker">Respostas diretas</span>
              <h2 id="faq-title">O que você precisa saber antes de colocar um agente em campo.</h2>
            </div>
            <p>
              Clareza vem antes da contratação. Estas são as respostas essenciais sobre escopo,
              transparência, governança e o primeiro passo para testar a plataforma.
            </p>
          </RevealOnScroll>
          <RevealOnScroll className="faq-list">
            {FAQ_ITEMS.map((item) => (
              <details className="faq-item" key={item.question} open>
                <summary>{item.question}<span aria-hidden="true">+</span></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </RevealOnScroll>
        </section>

        <section className="landing-section closing-section">
          <RevealOnScroll className="closing-panel">
            <div className="closing-panel-mark"><span className="eyebrow-pulse" /> NEXT CONVERSATION</div>
            <h2>O próximo grande salto comercial da sua empresa pode começar por uma conversa.</h2>
            <p>Veja a Rafaela em ação e descubra como uma presença digital pode entrar na sua operação.</p>
            <form action={signInDemo}>
              <button type="submit" className="btn btn-light btn-large">Entrar na demonstração <ArrowIcon /></button>
            </form>
            <span className="closing-note">Demo compartilhada, dados fictícios, sem cadastro e sem cartão.</span>
          </RevealOnScroll>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">A</span><span><span className="brand-word">Axtro</span><span className="brand-subword">Digital Human OS</span></span></div>
        <span>© 2026 Axtro AI. Vendas com presença, operação com clareza.</span>
        <a href="mailto:fernando@axtroai.com">fernando@axtroai.com</a>
      </footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }} />
    </div>
  );
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

function ArrowUpIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 14 14 4M6 4h8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
