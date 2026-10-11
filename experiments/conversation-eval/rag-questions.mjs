// Perguntas para medir a busca da base da Priscila (Ragas). Cada uma aponta o
// trecho da base que DEVERIA voltar (`doc` + `section`) e uma resposta de
// referência curta, escrita a partir desse trecho. O coletor transforma o
// trecho em `reference_contexts`; a busca real preenche `retrieved_contexts`.
// Perguntas em inglês, espanhol e português, do jeito que a pessoa falaria.

export const RAG_QUESTIONS = Object.freeze([
  {
    id: "final-expense-guaranteed-issue",
    question: "If my mom gets the guaranteed acceptance policy and passes in the first year, what does the family get?",
    doc: "02-final-expense.md",
    section: "The three ways it is issued",
    reference: "Guaranteed issue usually has a two year limited benefit period: a natural death in that period typically returns the premiums paid plus interest, not the full face amount. The licensed agent confirms the carrier's rules.",
  },
  {
    id: "iul-cash-value-can-fall",
    question: "Con un IUL, ¿de verdad nunca pierdo dinero?",
    doc: "05-indexed-universal-life.md",
    section: "How the crediting works",
    reference: "The floor keeps index losses from being credited as negative interest, but policy charges are deducted every month, so the cash value can still go down in years with low or zero credits. Caps and participation rates can change.",
  },
  {
    id: "kai-zen-risks",
    question: "What are the risks of Kai-Zen premium financing?",
    doc: "07-kai-zen-premium-financing.md",
    section: "The risks that must always be explained",
    reference: "Interest rate risk on the loan, performance risk if credits fall below the illustration, possible requests for more money or collateral, lapse risk with possible taxable gain, and program rules that can change. A licensed specialist explains the obligations.",
  },
  {
    id: "1035-annuity-to-life",
    question: "Posso trocar minha anuidade por um seguro de vida sem pagar imposto?",
    doc: "10-replacement-and-1035-exchanges.md",
    section: "1035 exchanges",
    reference: "Under section 1035 an annuity cannot be exchanged into a life insurance policy. Life to life, life to annuity and annuity to annuity can qualify, and tax free does not mean cost free.",
  },
  {
    id: "annuity-best-interest",
    question: "Why won't you just tell me which annuity to buy?",
    doc: "06-annuities-and-best-interest.md",
    section: "The best interest review (why Priscila never recommends an annuity)",
    reference: "Annuity recommendations follow a best interest standard: the licensed agent must gather and document the consumer profile before recommending anything, so Priscila educates and hands off.",
  },
  {
    id: "contestability",
    question: "What is the contestability period?",
    doc: "09-underwriting-and-what-happens-next.md",
    section: "Two clauses worth explaining",
    reference: "Usually the first two years. If the application had material misstatements, the carrier can review and contest a claim, which is why honest answers protect the family.",
  },
  {
    id: "living-benefits",
    question: "¿Puedo usar el seguro si me enfermo gravemente antes de morir?",
    doc: "08-living-benefits-and-riders.md",
    section: "Living benefits (accelerated death benefit riders)",
    reference: "Accelerated death benefit riders let the insured receive part of the death benefit while alive after a qualifying event, such as a terminal illness. What is paid early reduces what the family receives later.",
  },
  {
    id: "dime-method",
    question: "How do I figure out how much coverage I need?",
    doc: "03-term-and-mortgage-protection.md",
    section: "How much coverage: a simple, transparent estimate",
    reference: "The DIME method adds debts, years of income times annual income, the mortgage balance and education costs, then subtracts existing coverage and savings. It is an educational estimate the licensed agent refines.",
  },
]);
