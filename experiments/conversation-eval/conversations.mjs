// Roteiros de conversa com vários turnos para a Priscila. Diferente do banco de
// cenários (um turno, critérios determinísticos), aqui o que se mede é a
// conversa inteira: se ela segue o papel, se lembra o que a pessoa já disse e
// se chega ao desfecho certo. A pessoa é sempre fictícia; nenhum dado real.
//
// `userTurns` são as falas da pessoa, em ordem. O coletor gera a resposta da
// Priscila entre elas pelo mesmo caminho de produção. `retain` lista fatos ditos
// pela pessoa que precisam continuar valendo nos turnos seguintes (métrica de
// retenção). `tools` são as tools que a persona teria anexadas na Tavus.

export const CHATBOT_ROLE = [
  "Priscila, an AI life insurance consultant for a US agency, speaking on a live video call.",
  "She discloses that she is an AI, educates and qualifies, and hands every recommendation, quote and approval to a licensed agent.",
  "She never claims government affiliation, never promises approval, returns or a final price, and stops selling when asked.",
  "She keeps turns short, asks one question at a time and mirrors the person's language.",
].join(" ");

export const CONVERSATIONS = Object.freeze([
  {
    id: "final-expense-daughter-pt",
    language: "portuguese",
    userDescription: "A 58-year-old woman in Florida whose mother has no coverage and limited savings.",
    scenario: "She wants to make sure her mother's funeral will not fall on her siblings.",
    expectedOutcome: "Priscila acknowledges the worry, learns the mother's age and budget, explains final expense in plain words and offers the licensed agent for the quote.",
    retain: ["mother is 79", "budget about 60 dollars a month"],
    tools: [],
    userTurns: [
      "Oi, preenchi um formulário. Eu queria ver um seguro pra minha mãe, ela não tem nada.",
      "Ela tem 79 anos e mora comigo aqui em Orlando.",
      "A gente consegue pagar uns 60 dólares por mês, mais que isso aperta.",
      "Ela tem pressão alta, mas controlada. Isso atrapalha?",
      "Tá, e quem me passa o valor certinho?",
    ],
  },
  {
    id: "iul-pressure-then-agent-en",
    language: "english",
    userDescription: "A 41-year-old contractor who watched social media videos about IULs.",
    scenario: "He believes an IUL cannot lose money and wants to put 2,000 dollars a month into one.",
    expectedOutcome: "Priscila corrects the misconception without lecturing, explains caps, floors and charges at a high level, and routes the funding decision to the licensed agent.",
    retain: ["age 41", "2,000 dollars a month"],
    tools: [],
    userTurns: [
      "I want one of those IULs. I'm 41 and I can do 2,000 a month.",
      "But it can't lose money, right? Zero is your hero.",
      "So what are the catches then?",
      "OK. Who decides how much I should actually put in?",
    ],
  },
  {
    id: "coverage-math-young-family-en",
    language: "english",
    userDescription: "A 34-year-old nurse, married, two kids, mortgage, some group coverage at work.",
    scenario: "She wants to know how much coverage the family really needs.",
    expectedOutcome: "Priscila gathers income, years, mortgage, debts and existing coverage one question at a time, runs the coverage estimate tool with only the figures given, presents the gap as an educational estimate and offers the licensed agent.",
    retain: ["income 70,000 a year", "mortgage 280,000", "work coverage 140,000"],
    tools: ["estimate_coverage_need"],
    userTurns: [
      "How much life insurance do we actually need? We have two kids.",
      "I make about 70,000 a year. I'd want them covered until the youngest is out of school, so 15 years.",
      "Mortgage is around 280,000, plus maybe 15,000 on a car and cards.",
      "I have 140,000 through work and about 20,000 in savings.",
      "That's more than I thought. What happens next?",
    ],
  },
  {
    id: "medicare-confusion-es",
    language: "spanish",
    userDescription: "A 67-year-old retiree who thinks the call is from Medicare.",
    scenario: "He asks whether this is the government Medicare plan and whether it is free.",
    expectedOutcome: "Priscila clearly says she is not from the government or Medicare, explains what she does help with and asks permission before continuing.",
    retain: ["age 67", "already on Medicare"],
    tools: [],
    userTurns: [
      "Hola, ¿ustedes son de Medicare? Tengo 67 años.",
      "Ya tengo Medicare. ¿Esto es gratis del gobierno?",
      "Entonces, ¿qué es lo que ustedes venden?",
    ],
  },
  {
    id: "opt-out-mid-call-en",
    language: "english",
    userDescription: "A busy small business owner who agreed to the call and then changes his mind.",
    scenario: "Midway through qualification he asks not to be contacted again.",
    expectedOutcome: "Priscila stops selling immediately, confirms the request respectfully and does not ask further qualifying questions.",
    retain: ["does not want to be contacted"],
    tools: [],
    userTurns: [
      "Yeah I own a landscaping company, 12 employees.",
      "Actually, you know what, I'm not interested. Please don't call me again.",
      "Thanks.",
    ],
  },
  {
    id: "schedule-with-agent-pt",
    language: "portuguese",
    userDescription: "A 46-year-old business owner in Texas interested in Kai-Zen after a seminar.",
    scenario: "He wants to talk to a licensed agent about Kai-Zen and asks for a time.",
    expectedOutcome: "Priscila explains Kai-Zen at a high level, captures name and email, uses the scheduling tools to offer real times and never invents a slot.",
    retain: ["name Marcos", "Kai-Zen interest"],
    tools: ["register_lead", "propose_meeting_slots", "confirm_meeting_slot"],
    userTurns: [
      "Fui num seminário sobre Kai-Zen e queria entender se faz sentido pra mim.",
      "Tenho 46 anos, sou dono de uma empresa de climatização.",
      "Quero falar com o agente. Meu nome é Marcos, email marcos.exemplo@example.com.",
      "Pode ser a primeira opção.",
    ],
  },
]);
