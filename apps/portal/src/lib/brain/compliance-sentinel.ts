/**
 * Sentinela de compliance da closer de Life Insurance (Priscila, 2026-10-10).
 *
 * O prompt da vertical (`life-insurance.ts`) proíbe as afirmações abaixo, mas
 * instrução de prompt é probabilística: o mesmo raciocínio que levou o
 * travessão e o markdown para `sanitizeSpokenReply` vale, com mais peso, para
 * frases que criam exposição regulatória real. Cada resposta da vertical passa
 * por aqui DEPOIS da geração e ANTES de virar áudio.
 *
 * Princípios:
 * - Trabalha por frase. Uma frase violadora sai; o resto da resposta fica. Se
 *   nada aproveitável sobrar, entra uma frase de recuo no idioma da resposta.
 * - Só afirmação conta. "Não somos do Medicare" e "não existe licença federal"
 *   são exatamente o que a closer deve dizer, então a maioria das regras ignora
 *   frase com negação. A exceção é "não pode perder dinheiro", em que a negação
 *   é a própria promessa proibida.
 * - Termos de produto legítimos ficam de fora: "guaranteed issue", "guaranteed
 *   acceptance" e "benefício garantido por morte" não são promessa de retorno.
 * - Determinístico e sem rede: roda no caminho quente de toda resposta.
 */

export type ComplianceViolation =
  | "li_government_affiliation"
  | "li_federal_license"
  | "li_self_underwriter"
  | "li_approval_claim"
  | "li_loss_guarantee"
  | "li_definitive_quote";

export type SentinelLanguage = "english" | "spanish" | "portuguese";

export interface SentinelResult {
  readonly reply: string;
  readonly violations: readonly ComplianceViolation[];
}

interface Rule {
  readonly id: ComplianceViolation;
  readonly patterns: readonly RegExp[];
  /** Frase com negação não é afirmação: a regra não se aplica. */
  readonly negationSensitive: boolean;
}

// Fronteira de palavra ciente de acento: em JavaScript \\b só conhece ASCII, então
// "você" ou "está" nunca fechariam a palavra no fim.
function words(list: readonly string[], flags: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}'])(?:${list.join("|")})(?![\\p{L}\\p{N}])`, `${flags}u`);
}

const NEGATION = words(["not", "no", "never", "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "won't", "can't", "cannot", "nor", "there's no", "não", "nao", "nunca", "nem", "jamais", "nenhum", "nenhuma", "ningún", "ninguna", "ninguno", "tampoco", "ni"], "i");

const RULES: readonly Rule[] = [
  {
    id: "li_government_affiliation",
    negationSensitive: true,
    patterns: [
      /\b(we('| a)re|i('| a)m|this is|i work|our team is|we work)\b[^.!?]{0,40}\b(with|from|for|part of|affiliated with|partnered with|authorized by|on behalf of)\b[^.!?]{0,20}\b(medicare|medicaid|social security|the government|a government program|the state program|veterans affairs|the va)\b/i,
      /\b(somos|soy|estoy|trabajo|trabajamos)\b[^.!?]{0,40}\b(de|del|con|para|parte de|en nombre de)\b[^.!?]{0,20}\b(medicare|medicaid|seguro social|el gobierno|gobierno|un programa del gobierno|programa del estado|asuntos de veteranos)\b/i,
      /\b(somos|sou|estou|trabalho|trabalhamos)\b[^.!?]{0,40}\b(do|da|de|com|para|parte d[oa])\b[^.!?]{0,20}\b(medicare|medicaid|seguridade social|governo|programa do governo|programa do estado)\b/i,
    ],
  },
  {
    id: "li_federal_license",
    negationSensitive: true,
    patterns: [/\b(federal(ly)?[- ]licen[sc]ed|federal licen[sc]e|licencia federal|licença federal|licenciad[oa] federal(mente)?)\b/i],
  },
  {
    id: "li_self_underwriter",
    negationSensitive: true,
    patterns: [
      /\b(i('| a)m|i work as)\b[^.!?]{0,15}\bunderwriter\b/i,
      /\bsoy\b[^.!?]{0,15}\bsuscript(or|ora)\b/i,
      /\bsou\b[^.!?]{0,15}\bsubscrit(or|ora)\b/i,
    ],
  },
  {
    id: "li_approval_claim",
    negationSensitive: true,
    patterns: [
      /\byou('re| are|'ve been| have been| were| got)\s+(already\s+)?(pre-?)?approved\b/i,
      /\b(est[aá]s?|queda|qued[oó]|fue|ha sido|usted est[aá])\s+(ya\s+)?(pre-?)?aprobad[oa]\b/i,
      /\b(est[aá]|voc[eê] foi|foi|ficou|voc[eê] est[aá])\s+(j[aá]\s+)?(pr[eé]-?)?aprovad[oa]\b/i,
    ],
  },
  {
    // A negação aqui É a promessa proibida ("não tem como perder dinheiro").
    id: "li_loss_guarantee",
    negationSensitive: false,
    patterns: [
      /\b(can('|no)?t|cannot|won't|will not|will never|never)\s+lose\s+(money|a (penny|dime|cent)|value|your (money|savings|principal))\b/i,
      /\b(no|nunca)\s+(puede|vas a|va a|va usted a)?\s*perder\s+(dinero|su dinero|tu dinero|un centavo)\b/i,
      /\b(n[aã]o|nunca)\s+(pode|vai)?\s*perde[r]?\s+(dinheiro|seu dinheiro|um centavo|valor)\b/i,
    ],
  },
  {
    // "Não existe retorno garantido" é a frase certa: aqui a negação absolve.
    id: "li_loss_guarantee",
    negationSensitive: true,
    patterns: [
      /\bguaranteed\s+(return|returns|growth|gains|profit|profits|interest growth)\b/i,
      /\b(rendimiento|retorno|ganancia|crecimiento)\s+garantizad[oa]s?\b/i,
      /\b(rendimento|retorno|lucro|ganho|crescimento)\s+garantid[oa]s?\b/i,
    ],
  },
];

const QUOTE_AMOUNT = /(\$\s?\d[\d,.]*|\b\d[\d,.]*\s?(dollars|d[oó]lares|reais)\b|R\$\s?\d)/i;
const QUOTE_PERIOD = /\b(premium|per month|a month|monthly|each month|al mes|por mes|mensual(es)?|prima|por m[eê]s|mensal(idade)?|pr[eê]mio)\b/i;
const QUOTE_HEDGE = /\b(example|for example|e\.g\.|around|about|roughly|approximately|could|might|may|typically|usually|depends|depending|estimate|ballpark|range|illustrat\w*|ejemplo|por ejemplo|alrededor|aproximadamente|depende|podr[ií]a|t[ií]picamente|estimad\w*|exemplo|por exemplo|cerca de|em torno|depende|poderia|tipicamente|estimativa|faixa|ilustrativ\w*)\b/i;

const FALLBACK: Readonly<Record<SentinelLanguage, string>> = {
  english: "Let me be precise here: that is something the licensed agent confirms with you, with the real numbers. Can I ask you one quick question about your situation?",
  spanish: "Déjame ser precisa: eso lo confirma contigo el agente con licencia, con los números reales. ¿Te puedo hacer una pregunta rápida sobre tu situación?",
  portuguese: "Deixa eu ser precisa: isso quem confirma com você é o agente licenciado, com os números reais. Posso te fazer uma pergunta rápida sobre a sua situação?",
};

const LANGUAGE_MARKERS: Readonly<Record<SentinelLanguage, RegExp>> = {
  english: words(["the", "you", "your", "and", "is", "are", "with", "that", "this", "what", "it's", "i'm", "we're"], "gi"),
  spanish: words(["usted", "el", "los", "las", "y", "eso", "pero", "muy", "puede", "tiene", "qué", "está", "también", "su", "tu", "es"], "gi"),
  portuguese: words(["você", "voce", "não", "nao", "isso", "mas", "muito", "pode", "tem", "está", "também", "pra", "seu", "sua", "é", "uma"], "gi"),
};

/** Idioma da própria resposta, para o recuo sair no idioma em que a conversa está. */
export function detectReplyLanguage(text: string, fallback: SentinelLanguage): SentinelLanguage {
  let best: SentinelLanguage = fallback;
  let bestScore = 0;
  for (const language of ["english", "spanish", "portuguese"] as const) {
    const score = text.match(LANGUAGE_MARKERS[language])?.length ?? 0;
    if (score > bestScore) {
      best = language;
      bestScore = score;
    }
  }
  return best;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

// A negação só absolve a afirmação da MESMA oração: em "No problem, you're
// approved" o "No" pertence a outra oração e não desfaz a promessa.
const CLAUSE_BREAK = /[,;:]|\s(but|however|pero|sin embargo|mas|porém|porem)\s/gi;

function clauseAround(sentence: string, start: number, end: number): string {
  let from = 0;
  let to = sentence.length;
  for (const match of sentence.matchAll(CLAUSE_BREAK)) {
    const at = match.index ?? 0;
    if (at < start) from = at + match[0].length;
    else if (at >= end) { to = at; break; }
  }
  return sentence.slice(from, to);
}

function ruleMatches(rule: Rule, sentence: string): boolean {
  for (const pattern of rule.patterns) {
    const match = pattern.exec(sentence);
    if (!match) continue;
    if (!rule.negationSensitive) return true;
    const clause = clauseAround(sentence, match.index, match.index + match[0].length);
    if (!NEGATION.test(clause)) return true;
  }
  return false;
}

function sentenceViolations(sentence: string): ComplianceViolation[] {
  const found: ComplianceViolation[] = [];
  for (const rule of RULES) {
    if (!found.includes(rule.id) && ruleMatches(rule, sentence)) found.push(rule.id);
  }
  if (QUOTE_AMOUNT.test(sentence) && QUOTE_PERIOD.test(sentence) && !QUOTE_HEDGE.test(sentence)) {
    found.push("li_definitive_quote");
  }
  return found;
}

export function enforceLifeInsuranceCompliance(reply: string, fallbackLanguage: SentinelLanguage): SentinelResult {
  const sentences = splitSentences(reply);
  const kept: string[] = [];
  const violations = new Set<ComplianceViolation>();
  for (const sentence of sentences) {
    const found = sentenceViolations(sentence);
    if (found.length === 0) {
      kept.push(sentence);
      continue;
    }
    for (const violation of found) violations.add(violation);
  }
  if (violations.size === 0) return { reply, violations: [] };
  const language = detectReplyLanguage(reply, fallbackLanguage);
  const remainder = kept.join(" ").trim();
  // Uma sobra curta demais ("Claro.") soaria cortada no áudio: melhor o recuo inteiro.
  const safeReply = remainder.length >= 25 ? remainder : FALLBACK[language];
  return { reply: safeReply, violations: [...violations] };
}
