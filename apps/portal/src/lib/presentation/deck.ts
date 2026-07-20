/**
 * Decks de apresentação ao vivo conduzidos pela agente na sala de vídeo.
 *
 * Os slides são FRAMES estruturais no arco da Reunião Silva (agenda →
 * situação → pilares → prova → investimento → próximo passo): nenhum slide
 * carrega número ou promessa — fatos de produto e preço só saem da boca da
 * agente a partir do conhecimento autorizado injetado na chamada, nunca de
 * texto fixo de slide. Isso mantém a regra "zero dado inventado" verdadeira
 * também na tela.
 */

export type DeckSlideKind =
  | "cover"
  | "agenda"
  | "frame"
  | "pillars"
  | "proof"
  | "investment"
  | "next";

export interface DeckSlide {
  readonly id: string;
  readonly kind: DeckSlideKind;
  readonly title: string;
  readonly subtitle?: string;
  readonly bullets?: readonly string[];
  readonly note?: string;
}

export interface Deck {
  readonly title: string;
  readonly slides: readonly DeckSlide[];
}

export function buildSalesDeck(options: {
  readonly agentName: string;
  readonly tenantName: string;
  readonly language: "portuguese" | "english";
}): Deck {
  if (options.language === "english") {
    return {
      title: `${options.tenantName} — Live consultation`,
      slides: [
        { id: "cover", kind: "cover", title: options.tenantName, subtitle: `Live consultation with ${options.agentName} — digital AI consultant` },
        { id: "agenda", kind: "agenda", title: "Our agenda", bullets: ["First, I listen: your context and goals", "Then, the path we propose — tied to what you told me", "And only if it makes sense: how to start"] },
        { id: "situation", kind: "frame", title: "Your situation", bullets: ["How things run today", "What it's costing — time, money, opportunity", "Where you want to be"], note: "Filled in live, in your own words" },
        { id: "pillars", kind: "pillars", title: "Our approach", bullets: ["Pillar 1 — aimed at your first priority", "Pillar 2 — aimed at your second priority", "Pillar 3 — aimed at your third priority"], note: "Specifics come from the account's official sources" },
        { id: "proof", kind: "proof", title: "Proof, not promise", bullets: ["Verifiable results from authorized sources", "What you can check yourself"] },
        { id: "investment", kind: "investment", title: "Investment", subtitle: "Presented live — anchored on what the problem already costs you" },
        { id: "next", kind: "next", title: "Next steps", bullets: ["A specific date on the calendar", "What you receive", "What we need from you"] },
      ],
    };
  }
  return {
    title: `${options.tenantName} — Consultoria ao vivo`,
    slides: [
      { id: "cover", kind: "cover", title: options.tenantName, subtitle: `Consultoria ao vivo com ${options.agentName} — consultora digital (IA)` },
      { id: "agenda", kind: "agenda", title: "Nossa agenda", bullets: ["Primeiro, eu escuto: seu contexto e seus objetivos", "Depois, o caminho que propomos — amarrado ao que você me contou", "E só se fizer sentido: como começar"] },
      { id: "situation", kind: "frame", title: "Sua situação", bullets: ["Como funciona hoje", "O que isso está custando — tempo, dinheiro, oportunidade", "Onde você quer chegar"], note: "Preenchido ao vivo, nas suas palavras" },
      { id: "pillars", kind: "pillars", title: "Nossa abordagem", bullets: ["Pilar 1 — mirado na sua primeira prioridade", "Pilar 2 — mirado na sua segunda prioridade", "Pilar 3 — mirado na sua terceira prioridade"], note: "Os detalhes vêm das fontes oficiais da conta" },
      { id: "proof", kind: "proof", title: "Prova, não promessa", bullets: ["Resultados verificáveis das fontes autorizadas", "O que você mesmo pode checar"] },
      { id: "investment", kind: "investment", title: "Investimento", subtitle: "Apresentado ao vivo — ancorado no que o problema já custa hoje" },
      { id: "next", kind: "next", title: "Próximos passos", bullets: ["Uma data específica no calendário", "O que você recebe", "O que precisamos de você"] },
    ],
  };
}

/** Deck institucional da Aurora: a plataforma se apresenta — todos os fatos abaixo são do próprio produto. */
export function buildPlatformDeck(agentName: string): Deck {
  return {
    title: "Axtro Digital Human OS",
    slides: [
      { id: "cover", kind: "cover", title: "Axtro Digital Human OS", subtitle: `Apresentado por ${agentName} — a própria plataforma, ao vivo` },
      { id: "meta", kind: "agenda", title: "O que você está vendo", bullets: ["Esta conversa É o produto: uma funcionária digital de vídeo, ao vivo", "Voz natural em português, percepção de vídeo em tempo real", "Slides conduzidos por ela — como um closer humano faria"] },
      { id: "closer", kind: "pillars", title: "O que ela faz", bullets: ["Conduz a venda de ponta a ponta com o Método Silva", "Responde fatos apenas do conhecimento autorizado da conta", "Trata objeções e fecha o próximo passo com data"] },
      { id: "knowledge", kind: "frame", title: "Conhecimento governado", bullets: ["Fontes da conta com revogação imediata", "Busca vetorial (RAG) citável e auditável", "Sem fonte, sem número: ela não inventa"] },
      { id: "governance", kind: "proof", title: "Governança de verdade", bullets: ["Disclosure de IA sempre — ela nunca finge ser humana", "Cada conversa e cada token no ledger de custos", "Isolamento por conta em todas as camadas"] },
      { id: "next", kind: "next", title: "Como começar", bullets: ["Diagnóstico com o time Axtro", "Piloto com a sua operação e as suas fontes", "Sua própria funcionária digital no ar"] },
    ],
  };
}

/**
 * Contexto de apresentação para a chamada Tavus: instruções de condução +
 * roteiro numerado do deck. A agente controla os slides com as tools
 * `next_slide` / `previous_slide` / `go_to_slide`.
 */
export function buildDeckContext(deck: Deck, language: "portuguese" | "english"): string {
  const outline = deck.slides
    .map((slide, index) => `${index + 1}. ${slide.title}${slide.bullets ? ` — ${slide.bullets.join("; ")}` : ""}`)
    .join("\n");
  if (language === "english") {
    return [
      "PRESENTATION MODE IS ON. You control a live slide deck the person is seeing next to your video, using the tools next_slide, previous_slide and go_to_slide (1-based numbers from the outline below).",
      "Conduct it like the Silva Meeting: slide 1 stays up during opening; move to the agenda when you propose it; go to 'Your situation' during discovery and mirror their words verbally; only advance to the approach after they confirm the pain; investment slide ONLY after value validation; finish on next steps with a dated commitment.",
      "One idea per slide. Announce in a few words what you're showing, call the tool, then talk to the PERSON, not the slide.",
      "",
      `DECK OUTLINE (${deck.slides.length} slides):`,
      outline,
    ].join("\n");
  }
  return [
    "MODO APRESENTAÇÃO ATIVO. Você controla um deck de slides ao vivo que a pessoa vê ao lado do seu vídeo, usando as tools next_slide, previous_slide e go_to_slide (números 1-based do roteiro abaixo).",
    "Conduza como a Reunião Silva: o slide 1 fica na abertura; vá para a agenda quando propuser a agenda; vá para 'Sua situação' durante a descoberta e espelhe verbalmente as palavras da pessoa; só avance para a abordagem depois que ela confirmar a dor; o slide de investimento SÓ depois da validação de valor; termine em próximos passos com compromisso datado.",
    "Uma ideia por slide. Anuncie em poucas palavras o que vai mostrar, chame a tool, e fale com a PESSOA, não com o slide.",
    "",
    `ROTEIRO DO DECK (${deck.slides.length} slides):`,
    outline,
  ].join("\n");
}
