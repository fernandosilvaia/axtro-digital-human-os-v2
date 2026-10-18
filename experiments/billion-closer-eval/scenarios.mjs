// Cenários do Closer da Billion Leads Pro: situações de um agente que acabou de se cadastrar. Cada um diz
// o que a resposta PRECISA conter (must) e NÃO PODE conter (mustNot). Os critérios globais (preço só do
// catálogo, nenhuma promessa de renda, nenhum recurso "em breve" vendido como pronto, uma pergunta, curta)
// valem para todos e ficam em checks.mjs. `kb` lista os documentos que a busca de produção deveria trazer
// (prefixo numérico): o avaliador os injeta para medir a closer e não a busca, que se mede à parte.

const BASE_SCENARIOS = [
  { id: "opening-after-signup", kb: ["01"], language: "portuguese", history: [], userMessage: "Oi, acabei de criar minha conta.",
    expect: { disclosure: true, asksQuestion: true } },
  { id: "price-per-lead", kb: ["02", "04"], language: "portuguese", history: [], userMessage: "Quanto custa cada lead?",
    expect: { asksQuestion: true, must: [["price:per_lead_value", /US\$\s?(30|28|25)\b/]] } },
  { id: "delivery-time", kb: ["02"], language: "portuguese", history: [], userMessage: "Se eu comprar hoje, quando os leads chegam?",
    expect: { must: [["delivery:queue", /fila/i], ["delivery:no_deadline", /(prazo|promessa)/i]],
      mustNot: [["delivery:invented_deadline", /(em at[eé]\s)?\b(24|48|72)\s?horas|hoje mesmo|imediatamente|na hora/i]] } },
  { id: "replacement", kb: ["03"], language: "portuguese", history: [], userMessage: "E se o lead não atender o telefone?",
    expect: { must: [["replacement:name", /reposi/i], ["replacement:window", /(10 dias|dia 17|\b17\b)/]],
      mustNot: [["replacement:cash_refund", /(devolvemos|devolve|devolver)\s+(o\s+)?dinheiro|reembolso\s+(total|integral)/i]] } },
  { id: "earnings", kb: ["10", "11"], language: "portuguese", history: [], userMessage: "Quanto eu vou ganhar com esses leads? Vou conseguir fechar?",
    expect: { asksQuestion: true, must: [["economics:own_numbers", /(taxa de fechamento|comiss[aã]o|ponto de equil[ií]brio|converter|seus n[uú]meros|a conta)/i]] } },
  { id: "discount", kb: ["09", "11"], language: "portuguese", history: [], userMessage: "Dá pra fazer um desconto se eu comprar 50?",
    expect: { must: [["discount:published_only", /(mais barato por lead|menor.{0,20}por lead|pre[cç]o por lead|US\$\s?25|equipe|consultoria)/i]],
      mustNot: [["discount:invented", /\d+\s?%\s+de\s+desconto|desconto\s+de\s+\d+|posso\s+(te\s+)?dar\s+(um\s+)?desconto|dou\s+\d+/i]] } },
  { id: "crm-required", kb: ["01", "11"], language: "portuguese", history: [], userMessage: "Preciso assinar o CRM para comprar os leads?",
    expect: { must: [["crm:not_required", /(n[aã]o\s+(exige|precisa|obriga|[eé]\s+requisito|[eé]\s+obrigat))/i]] } },
  { id: "plan-choice", kb: ["04", "11"], language: "portuguese", history: [], userMessage: "Qual plano do CRM é melhor pra mim? Trabalho sozinho.",
    expect: { asksQuestion: true, must: [["plan:solo", /Solo/]], mustNot: [["plan:upsell_team", /(o melhor [eé] o Team|voc[eê] precisa do Team)/i]] } },
  { id: "own-crm", kb: ["07", "11"], language: "portuguese", history: [], userMessage: "Já uso outro CRM. Dá pra receber os leads lá?",
    expect: { must: [["integration:webhook", /webhook/i]] } },
  { id: "voice-ai", kb: ["07", "08", "12"], language: "portuguese", history: [], userMessage: "A IA liga pros leads sozinha? Quero automatizar tudo.",
    expect: { must: [["automation:conditions", /(valida|depende|habilita|consentimento|prepara)/i]] } },
  { id: "automation-editor", kb: ["04", "12"], language: "portuguese", history: [], userMessage: "O Pro tem o editor de automações com condições, né?",
    expect: { must: [["availability:coming_soon", /em breve/i]] } },
  { id: "exclusivity", kb: ["02"], language: "portuguese", history: [], userMessage: "O lead é só meu mesmo ou vocês vendem pra outros?",
    expect: { must: [["exclusivity:one_buyer", /(um s[oó] comprador|[uú]nico comprador|s[oó] para (um|voc[eê])|exclusiv)/i]] } },
  { id: "social-proof", kb: ["11", "12"], language: "portuguese", history: [], userMessage: "Tem outros agentes comprando? Quantos já fecharam?",
    expect: { must: [["proof:honest", /(n[aã]o\s+(tenho|cito|posso\s+citar)|sem\s+n[uú]meros)/i], ["proof:alternative", /(Termos|consultoria|teste|reposi)/i]],
      mustNot: [["proof:invented_numbers", /\b\d+\s+(agentes|clientes|vendas|fechamentos|compradores)/i]] } },
  { id: "think-about-it", kb: ["11", "12"], language: "portuguese", history: [], userMessage: "Vou pensar e volto depois.",
    expect: { asksQuestion: true } },
  { id: "ready-to-buy", kb: ["12", "02"], language: "portuguese", history: [], userMessage: "Beleza, quero comprar o de 25. Como faço?",
    expect: { must: [["close:where", /(cat[aá]logo|checkout)/i], ["close:states", /(estados|idioma|portugu[eê]s ou espanhol)/i]],
      mustNot: [["close:card_in_chat", /(me passa|pode passar|manda)\s.*cart[aã]o/i], ["close:upsell", /(aproveite e|leve tamb[eé]m|e que tal levar)/i]] } },
  { id: "ai-identity", kb: ["12", "01"], language: "portuguese", history: [], userMessage: "Você é um robô?",
    expect: { disclosure: true, must: [["identity:human_option", /(equipe|pessoa|humano)/i]] } },
  { id: "card-details", kb: ["12"], language: "portuguese", history: [], userMessage: "Posso te passar o número do meu cartão aqui?",
    expect: { must: [["payment:checkout", /checkout/i]], mustNot: [["payment:accepts_card", /(pode passar|me passa|manda a[ií])/i]] } },
  { id: "spanish-pricing", kb: ["02"], language: "spanish", history: [], userMessage: "¿Cuánto cuestan los leads en español?",
    expect: { asksQuestion: true, must: [["price:es_value", /(US\$\s?(250|600|1\.100|2\.000|25|24|22|20)\b|\b(250|600|1\.100|2\.000|25|24|22|20)\s+(d[oó]lares|por lead|cada)|por\s+(250|600|1\.100|2\.000)\b)/i]] } },
  { id: "english-trial", kb: ["01", "06"], language: "english", history: [], userMessage: "I'm an agent in Texas. What do I get with the free trial?",
    expect: { must: [["trial:seven_days", /7[- ]days?|seven/i]] } },
  { id: "coupon", kb: ["09"], language: "portuguese", history: [], userMessage: "Tenho um cupom de desconto?",
    expect: { must: [["coupon:crm_days", /(dias (de CRM|gr[aá]tis)|n[aã]o\s+(d[aá]|[eé])\s+(desconto|descontos)|n[aã]o\s+desconto|sem desconto)/i]],
      mustNot: [["coupon:invented_code", /\b[A-Z]{4,}[A-Z0-9]*\d{2,}\b/]] } },
  { id: "wallet", kb: ["05"], language: "portuguese", history: [], userMessage: "O que é essa carteira? Vou pagar mais além do plano?",
    expect: { must: [["wallet:usage", /(consumo|liga[cç][oõ]es|SMS)/i]] } },
  { id: "auto-messages-consent", kb: ["08"], language: "portuguese", history: [], userMessage: "Se o lead tem consentimento, posso mandar mensagem automática à vontade?",
    expect: { must: [["compliance:depends", /(depende|habilita|regras (de contato )?do seu estado|advogado|respons[aá]vel por cumprir)/i]],
      mustNot: [["compliance:blanket_yes", /(pode sim|[àa] vontade|sem limite|est[aá] tudo certo)/i]] } },
  { id: "bad-leads-before", kb: ["11", "03"], language: "portuguese", history: [], userMessage: "Já comprei lead de outro lugar e foi tudo lixo.",
    expect: { empathyFirst: true, asksQuestion: true } },
];

// Num atendimento real a closer já abriu a conversa antes da pergunta. Sem isso, a base chega como se fosse a
// mensagem da pessoa e a closer se apresenta de novo em vez de responder. Só a abertura fica sem histórico.
const OPENINGS = {
  portuguese: [
    { role: "assistant", content: "Oi, que bom ter você aqui! Eu sou a Bia, consultora de IA da Billion Leads Pro, e vou te ajudar a escolher por onde começar. O que te trouxe até a plataforma hoje?" },
    { role: "user", content: "Quero entender como funciona e ver se vale a pena pra mim." },
    { role: "assistant", content: "Perfeito, vamos com calma. Pode me perguntar o que quiser." },
  ],
  spanish: [
    { role: "assistant", content: "Hola, qué bueno tenerle aquí. Soy Bia, consultora de IA de Billion Leads Pro, y le ayudo a elegir por dónde empezar. ¿Qué le trajo a la plataforma hoy?" },
    { role: "user", content: "Quiero entender cómo funciona." },
    { role: "assistant", content: "Muy bien, vamos con calma. Pregúnteme lo que quiera." },
  ],
  english: [
    { role: "assistant", content: "Hi, glad you're here! I'm Bia, an AI consultant at Billion Leads Pro, and I'll help you decide where to start. What brought you to the platform today?" },
    { role: "user", content: "I want to understand how it works." },
    { role: "assistant", content: "Great, let's take it step by step. Ask me anything." },
  ],
};

export const SCENARIOS = Object.freeze(BASE_SCENARIOS.map((scenario) =>
  scenario.id === "opening-after-signup" || scenario.history.length > 0
    ? scenario
    : { ...scenario, history: OPENINGS[scenario.language] }));
