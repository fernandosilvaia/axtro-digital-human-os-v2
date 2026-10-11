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
  | "li_self_licensed"
  | "li_product_recommendation"
  | "li_tax_guarantee"
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
  /**
   * Condição antes da afirmação, na mesma oração ("if you're approved, ..."),
   * descreve o processo e não promete nada. Só faz sentido na aprovação.
   */
  readonly conditionalSensitive?: boolean;
}

// Fronteira de palavra ciente de acento: em JavaScript \\b só conhece ASCII, então
// "você" ou "está" nunca fechariam a palavra no fim.
function words(list: readonly string[], flags: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}'])(?:${list.join("|")})(?![\\p{L}\\p{N}])`, `${flags}u`);
}

const NEGATION = words(["not", "no", "never", "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "won't", "can't", "cannot", "nor", "there's no", "nobody", "no one", "nadie", "ninguém", "ninguem", "não", "nao", "nunca", "nem", "jamais", "nenhum", "nenhuma", "ningún", "ninguna", "ninguno", "tampoco", "ni"], "i");

// Sem o "se" do português de propósito: ele também é pronome ("pode se
// tranquilizar, você vai ser aprovada") e deixaria passar uma promessa real.
const CONDITIONAL = words(["if", "once", "when", "whenever", "after", "until", "unless", "si", "cuando", "una vez que", "después de que", "despues de que", "quando", "assim que", "depois que", "depois de"], "i");

const RULES: readonly Rule[] = [
  {
    id: "li_government_affiliation",
    negationSensitive: true,
    patterns: [
      /\b(we('| a)re|i('| a)m|this is|i work|our team is|we work)\b[^.!?]{0,40}\b(with|from|for|part of|affiliated with|partnered with|authorized by|on behalf of)\b[^.!?]{0,20}\b(medicare|medicaid|social security|the government|a government program|the state program|veterans affairs|the va)\b/i,
      /\b(somos|soy|estoy|trabajo|trabajamos)\b[^.!?]{0,40}\b(de|del|con|para|parte de|en nombre de)\b[^.!?]{0,20}\b(medicare|medicaid|seguro social|el gobierno|gobierno|un programa del gobierno|programa del estado|asuntos de veteranos)\b/i,
      /\b(somos|sou|estou|trabalho|trabalhamos)\b[^.!?]{0,40}\b(do|da|de|com|para|parte d[oa])\b[^.!?]{0,20}\b(medicare|medicaid|seguridade social|governo|programa do governo|programa do estado)\b/i,
      // Sem sujeito em primeira pessoa: "é um benefício do governo" é a frase
      // clássica do golpe de final expense, e ninguém da conversa a afirma.
      /\b(?:government|state|federal)[- ](?:backed|sponsored|funded|run|issued)\s+(?:program|benefit|plan|policy|coverage)\b/i,
      /\b(?:this|it|that)\s+(?:is|'s)\s+(?:a\s+|an\s+)?(?:government|state|federal)\s+(?:program|benefit|plan)\b/i,
      /\b(?:programa|beneficio|plan|seguro)\s+(?:respaldado\s+por\s+el|patrocinado\s+por\s+el|del)\s+(?:gobierno|estado)\b/i,
      /\b(?:programa|benef[ií]cio|plano|seguro)\s+(?:do|garantido\s+pelo|bancado\s+pelo|patrocinado\s+pelo)\s+(?:governo|estado)\b/i,
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
    // Uma IA não tem licença. Afirmar que tem é se passar pelo agente
    // licenciado, o que a regulação de seguros trata como prática ilegal.
    id: "li_self_licensed",
    negationSensitive: true,
    patterns: [
      /\b(?:i(?:'m| am)|as)\s+(?:a|an|your)\s+(?:licensed|appointed|certified)\s+(?:insurance\s+)?(?:agent|producer|broker|advisor|adviser|consultant)\b/i,
      /\bi(?:'m| am)\s+(?:licensed|appointed)\s+(?:in|to sell|with|by)\b/i,
      /\bi\s+(?:have|hold)\s+(?:a|an|my)\s+(?:insurance\s+)?licen[sc]e\b/i,
      /\b(?:soy|como)\s+(?:su\s+|tu\s+)?(?:agente|corredora?|asesora?|productora?)\s+(?:con\s+licencia|licenciad[oa]|autorizad[oa])\b/i,
      /\b(?:tengo|cuento con)\s+(?:mi\s+|una\s+)?licencia\b/i,
      /\bestoy\s+licenciad[oa]\b/i,
      /\b(?:sou|como)\s+(?:sua\s+|seu\s+)?(?:agente|corretora?|consultora?)\s+(?:licenciad[oa]|habilitad[oa]|credenciad[oa])\b/i,
      /\b(?:tenho|possuo)\s+(?:a\s+|minha\s+|uma\s+)?licen[cç]a\b/i,
    ],
  },
  {
    // Quem recomenda produto e valor é o agente licenciado. Explicar que uma
    // família de produto combina com o que a pessoa disse continua livre.
    id: "li_product_recommendation",
    negationSensitive: true,
    patterns: [
      /\bi\s+(?:would\s+|'d\s+)?(?:recommend|suggest|advise)\s+(?:that\s+)?you\s+(?:buy|get|purchase|go with|choose|sign up for|take out)\b/i,
      /\bi\s+(?:would\s+|'d\s+)?recommend\s+(?:the\s+|an?\s+|this\s+)?(?:iul|indexed universal life|whole life|term(?: life)?|annuity|final expense|gul|universal life|kai-?zen|myga|policy|plan)\b/i,
      /\b(?:le|te)\s+(?:recomiendo|sugiero|aconsejo)\s+(?:que\s+)?(?:compre|contrate|comprar|contratar|el iul|la anualidad|la p[oó]liza)\b/i,
      /\b(?:yo\s+)?recomiendo\s+(?:el|la|un|una|esta|este)\s+(?:iul|vida entera|p[oó]liza|anualidad|seguro|plan)\b/i,
      /\b(?:eu\s+)?(?:recomendo|sugiro|aconselho)\s+(?:que\s+voc[eê]\s+)?(?:compre|contrate|feche|o iul|a anuidade|a ap[oó]lice|o seguro|o plano)\b/i,
    ],
  },
  {
    // "Livre de imposto, garantido" é a promessa clássica do IUL de rede social.
    id: "li_tax_guarantee",
    negationSensitive: true,
    patterns: [
      /\bguaranteed\s+tax[- ]free\b/i,
      /\btax[- ]free,?\s+guaranteed\b/i,
      /\b(?:libre de impuestos|sin impuestos)\s+garantizad[oa]\b|\bgarantizad[oa]\s+(?:libre de|sin)\s+impuestos\b/i,
      /\b(?:isent[oa] de impostos?|livre de impostos?)\s+garantid[oa]\b|\bgarantid[oa]\s+(?:isent[oa]|livre)\s+de\s+impostos?\b/i,
    ],
  },
  {
    id: "li_approval_claim",
    negationSensitive: true,
    conditionalSensitive: true,
    patterns: [
      /\byou('re| are|'ve been| have been| were| got)\s+(already\s+)?(pre-?)?approved\b/i,
      /\b(est[aá]s?|queda|qued[oó]|fue|ha sido|usted est[aá])\s+(ya\s+)?(pre-?)?aprobad[oa]\b/i,
      /\b(est[aá]|voc[eê] foi|foi|ficou|voc[eê] est[aá])\s+(j[aá]\s+)?(pr[eé]-?)?aprovad[oa]\b/i,
      // Promessa no futuro, o deslize mais comum numa conversa de venda
      // ("you'll be approved, don't worry"). Sempre com a pessoa como sujeito:
      // frase educativa sobre aceitação garantida de um produto passa.
      /\byou(?:'ll| will)\s+(?:definitely\s+|surely\s+|certainly\s+|easily\s+)?(?:be|get)\s+(?:pre-?)?approved\b/i,
      /\byou(?:'re| are|'ll be| will be)\s+guaranteed\s+(?:to\s+(?:be|get)\s+)?(?:approval|approved|acceptance|accepted)\b/i,
      /\byour\s+(?:approval|application)\s+(?:is|will be)\s+(?:guaranteed|a sure thing|approved)\b/i,
      /\b(?:100\s?%|a hundred percent|one hundred percent)\s+(?:pre-?)?approved\b/i,
      /\b(?:usted\s+)?(?:ser[aá]|va a ser|vas a ser|va a quedar)\s+(?:pre-?)?aprobad[oa]\b/i,
      /\b(?:le|lo|la|te)\s+(?:van a|vamos a|va a)\s+aprobar\b/i,
      /\b(?:van a|vamos a|va a)\s+aprobarl[oae]s?\b/i,
      /\bsu\s+(?:aprobaci[oó]n|solicitud)\s+(?:est[aá]|ser[aá]|queda)\s+(?:garantizada|aprobada)\b/i,
      /\b(?:voc[eê]\s+)?(?:vai ser|ser[aá]|vai ficar)\s+(?:pr[eé]-?)?aprovad[oa]\b/i,
      /\b(?:te|lhe|o|a)\s+(?:v[aã]o|vamos)\s+aprovar\b/i,
      /(?<![\p{L}])(?:v[aã]o|vamos|vai)\s+(?:te|lhe)\s+aprovar\b/iu,
      /\bsua\s+(?:aprova[cç][aã]o|proposta)\s+(?:est[aá]|vai ser|ser[aá])\s+(?:garantida|aprovada)\b/i,
    ],
  },
  {
    // A negação aqui É a promessa proibida ("não tem como perder dinheiro").
    id: "li_loss_guarantee",
    negationSensitive: false,
    patterns: [
      /\b(can('|no)?t|cannot|won't|will not|will never|never)\s+lose\s+(money|a (penny|dime|cent)|value|your (money|savings|principal))\b/i,
      /\byou\s+(?:can(?:'|no)?t|cannot)\s+lose\s+(?:with|on|in)\s+(?:this|that|an?|the|our)\b/i,
      /\bno\s+(?:puede|va a)\s+perder\s+con\s+(?:este|esta|un|una|el|la)\b/i,
      /\bn[aã]o\s+tem\s+como\s+perder\s+com\b/i,
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
  // "usted", como pede a diretiva da persona em espanhol: é o trato esperado com
  // quem compra seguro de vida, sobretudo os mais velhos.
  spanish: "Permítame ser precisa: eso lo confirma con usted el agente con licencia, con los números reales. ¿Le puedo hacer una pregunta rápida sobre su situación?",
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
    if (NEGATION.test(clause)) continue;
    if (rule.conditionalSensitive === true) {
      const before = clause.slice(0, Math.max(0, clause.indexOf(match[0])));
      if (CONDITIONAL.test(before)) continue;
    }
    return true;
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
