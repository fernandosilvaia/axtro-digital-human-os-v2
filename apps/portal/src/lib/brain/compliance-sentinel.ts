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
  | "li_claims_human"
  | "li_cd_comparison"
  | "li_product_recommendation"
  | "li_sensitive_id_request"
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
      // "Backed by Medicare" / "endorsed by the government": o verbo de ligação
      // não é "with" nem "from", e a frase afirma o vínculo do mesmo jeito.
      /\b(?:we(?:'re| are)|i(?:'m| am)|this (?:is|plan is|policy is|program is))\s+(?:fully\s+|officially\s+|also\s+)?(?:backed|endorsed|sponsored|funded|run|operated|supported)\s+by\s+(?:the\s+)?(?:u\.?s\.?\s+|federal\s+|state\s+)?(?:government|medicare|medicaid|social security|irs|va)\b/i,
      /\b(?:estamos|somos|esto es)\s+(?:respaldad[oa]s?|avalad[oa]s?|patrocinad[oa]s?|financiad[oa]s?)\s+por\s+(?:el\s+)?(?:gobierno|medicare|medicaid|seguro social)\b/i,
      /\b(?:somos|estamos|isso [eé])\s+(?:apoiad[oa]s?|avalad[oa]s?|patrocinad[oa]s?|financiad[oa]s?|garantid[oa]s?)\s+pel[oa]\s+(?:governo|medicare|medicaid)\b/i,
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
      // Sem preposição: "I'm fully licensed", "Yes, I am licensed".
      /\bi(?:'m| am)\s+(?:(?:fully|properly|officially|also|totally|already)\s+)?(?:state[- ])?licen[sc]ed\b/i,
      // Com o nome antes: "I'm Priscila, a licensed insurance agent". Sensível a
      // maiúscula de propósito, para "I'm here, a licensed agent will call" passar.
      /\b[Ii](?:'m| am)\s+(?:\p{Lu}\p{Ll}+,?\s+)?(?:a|an|your)\s+(?:(?:state|fully)[- ]?)?licen[sc]ed\s+(?:insurance\s+)?(?:agent|producer|broker|advisor|adviser|consultant)\b/u,
      /\b(?:soy|estoy)\s+(?:(?:completamente|totalmente|plenamente)\s+)?licenciad[oa]\b/i,
      /\bsou\s+(?:(?:totalmente|plenamente|devidamente)\s+)?(?:licenciad[oa]|habilitad[oa])\b/i,
    ],
  },
  {
    // Leis de divulgação de IA (Califórnia, Utah, Maine) e a regra de falsa
    // identidade da FTC miram a IA que se passa por pessoa. "Sou uma IA" é o
    // que ela deve dizer, então a negação absolve estas frases.
    id: "li_claims_human",
    negationSensitive: true,
    patterns: [
      /\bi(?:'m| am)\s+(?:(?:really|actually|truly|just|definitely)\s+)?(?:a\s+)?(?:real|actual|live|living|flesh[- ]and[- ]blood)\s+(?:person|human|woman|man)\b/i,
      /\bi(?:'m| am)\s+(?:(?:really|actually|truly|just)\s+)?(?:a\s+)?(?:human|person)(?![\w-])/i,
      /\byou(?:'re| are)\s+(?:talking|speaking)\s+(?:to|with)\s+(?:a\s+)?(?:real|live|actual)\s+(?:person|human)\b/i,
      /\bsoy\s+(?:(?:realmente|de verdad)\s+)?(?:una\s+)?(?:persona|humana?)(?![\p{L}\p{N}-])/iu,
      /\bsou\s+(?:(?:realmente|de verdade)\s+)?(?:uma\s+)?(?:pessoa|humana?)(?![\p{L}\p{N}-])/iu,
    ],
  },
  {
    // Aqui a negação É a afirmação proibida ("I'm not a robot"), como em
    // "não tem como perder dinheiro".
    id: "li_claims_human",
    negationSensitive: false,
    patterns: [
      /\bi(?:'m| am)\s+not\s+(?:an?\s+)?(?:ai|a\.i\.|artificial|robot|bot|chatbot|machine|computer|automated|virtual assistant|recording)(?![\w-])/i,
      /\bno\s+soy\s+(?:un\s+|una\s+)?(?:robot|rob[oó]t|bot|chatbot|m[aá]quina|ia|inteligencia artificial|asistente virtual|grabaci[oó]n)(?![\p{L}\p{N}-])/iu,
      /\bn[aã]o\s+sou\s+(?:um\s+|uma\s+)?(?:rob[oô]|bot|chatbot|m[aá]quina|ia|intelig[eê]ncia artificial|assistente virtual|grava[cç][aã]o)(?![\p{L}\p{N}-])/iu,
    ],
  },
  {
    // A norma de publicidade da NAIC (Model 570) proíbe comparar anuidade a um
    // CD bancário de forma enganosa. "Não é um CD" é a frase certa.
    id: "li_cd_comparison",
    negationSensitive: true,
    patterns: [
      /\b(?:like|similar(?:\s+in\s+\w+)?\s+to|same\s+as|just\s+like|works\s+like|acts\s+like|as\s+safe\s+as|safer\s+than|better\s+than|comparable\s+to|equivalent\s+to)\s+(?:a\s+|an\s+|your\s+|the\s+)?(?:bank\s+)?(?:cds?|certificates?\s+of\s+deposit)(?![\w-])/i,
      /\b(?:think\s+of\s+(?:it|this)\s+as|basically|essentially)\s+(?:a\s+|an\s+)?(?:bank\s+)?(?:cds?|certificates?\s+of\s+deposit)(?![\w-])/i,
      /\bcd[- ]like\b/i,
      /\b(?:como|similar\s+a|igual\s+que|parecid[oa]\s+a)\s+(?:un|el)\s+(?:cd|certificado\s+de\s+dep[oó]sito)(?![\p{L}\p{N}])/iu,
      /\b(?:como|igual\s+a|parecid[oa]\s+com|semelhante\s+a)\s+(?:um|o)\s+(?:cdb|certificado\s+de\s+dep[oó]sito)(?![\p{L}\p{N}])/iu,
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
      /\byou\s+should\s+(?:definitely\s+|really\s+|absolutely\s+)?(?:get|buy|take|choose|go with|sign up for|purchase)\s+(?:the\s+|an?\s+|this\s+)?(?:iul|whole life|term|annuity|gul|final expense|kai-?zen|universal life|policy|plan)\b/i,
      /\bi(?:'d| would)\s+(?:definitely\s+|honestly\s+)?(?:go with|pick|choose|take|get)\s+(?:the\s+|an?\s+)?(?:iul|whole life|term|annuity|gul|final expense|kai-?zen|policy|plan)\b/i,
      /\bmy\s+recommendation\s+(?:is|would be)\s+(?:the\s+|an?\s+)?(?:iul|whole life|term|annuity|gul|final expense|kai-?zen|policy|plan)\b/i,
      /\b(?:deber[ií]a|debe|tiene que)\s+(?:contratar|comprar|tomar|elegir)\s+(?:el|la|un|una)?\s*(?:iul|vida entera|anualidad|p[oó]liza|seguro|plan)\b/i,
      /\b(?:voc[eê]\s+)?(?:deveria|deve|tem que)\s+(?:contratar|comprar|fechar|escolher)\s+(?:o|a|um|uma)?\s*(?:iul|vida inteira|anuidade|ap[oó]lice|seguro|plano)\b/i,
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
      /\byou('re| are|'ve been| have been| were| got)\s+(?:(?:already|definitely|officially|fully|totally|certainly|surely|absolutely|now)\s+)*(?:been\s+)?(?:pre[- ]?)?(?:approved|accepted)\b/i,
      /\b(est[aá]s?|queda|qued[oó]|fue|ha sido|usted est[aá])\s+(?:(?:ya|definitivamente|oficialmente|totalmente)\s+)*(?:pre[- ]?)?aprobad[oa]\b/i,
      /\b(est[aá]|voc[eê] foi|foi|ficou|voc[eê] est[aá])\s+(?:(?:j[aá]|oficialmente|totalmente|definitivamente)\s+)*(?:pr[eé][- ]?)?aprovad[oa]\b/i,
      // Exige "been": "you've approved the form" é a pessoa aprovando, não sendo aprovada.
      /\byou(?:'ve| have)\s+(?:(?:already|officially|definitely|fully|totally)\s+)+been\s+(?:pre[- ]?)?(?:approved|accepted)\b/i,
      // O sujeito é a proposta, não a pessoa.
      /\byour\s+(?:application|policy|coverage|request)\s+(?:has been|was|is|got)\s+(?:(?:already|officially)\s+)?(?:pre[- ]?)?(?:approved|accepted)\b/i,
      /\bsu\s+(?:solicitud|p[oó]liza)\s+(?:ya\s+)?(?:fue|ha sido|est[aá]|queda)\s+aprobad[oa]\b/i,
      /\bsua\s+(?:proposta|solicita[cç][aã]o|ap[oó]lice)\s+(?:j[aá]\s+)?(?:foi|est[aá]|ficou)\s+aprovad[oa]\b/i,
      // "You qualify for the full coverage" é aprovação dita de outro jeito.
      /\byou\s+(?:definitely\s+|already\s+|certainly\s+)?qualify\s+for\s+(?:the\s+|this\s+|that\s+|our\s+)?(?:full\s+|entire\s+)?(?:coverage|policy|plan|benefit)\b/i,
      /\busted\s+(?:ya\s+)?califica\s+para\s+(?:la\s+|esta\s+)?(?:cobertura|p[oó]liza|plan)\b/i,
      /\bvoc[eê]\s+(?:j[aá]\s+)?(?:se\s+)?qualifica\s+para\s+(?:a\s+|essa\s+)?(?:cobertura|ap[oó]lice|plano)\b/i,
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
  {
    // A regra 8 do prompt proíbe coletar SSN, conta ou cartão por voz. O prompt
    // é a primeira defesa; esta é a segunda.
    id: "li_sensitive_id_request",
    negationSensitive: true,
    patterns: [
      /\b(?:read|tell|give|send|share|say|text|email|type|provide|confirm)\s+(?:me\s+)?(?:your|ur)\s+(?:full\s+)?(?:social security(?: number)?|ssn|bank account(?: number)?|routing number|credit card(?: number)?|debit card(?: number)?|card number|driver'?s licen[sc]e(?: number)?|password)\b/i,
      /\bwhat(?:'s| is)\s+your\s+(?:full\s+)?(?:social security(?: number)?|ssn|bank account(?: number)?|routing number|credit card(?: number)?|card number)\b/i,
      /\b(?:d[ií]game|dame|d[eé]me|comp[aá]rtame|env[ií]eme|l[eé]ame)\s+(?:su|tu)\s+(?:n[uú]mero de\s+)?(?:seguro social|ssn|cuenta bancaria|tarjeta(?: de cr[eé]dito)?)\b/i,
      /\b(?:me\s+)?(?:fale|passe|diga|envie|mande|informe)\s+(?:o\s+)?(?:seu|sua)\s+(?:n[uú]mero\s+do\s+)?(?:ssn|social security|seguro social|conta banc[aá]ria|cart[aã]o(?: de cr[eé]dito)?)\b/i,
    ],
  },
];

const QUOTE_AMOUNT = /(\$\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:dollars|d[oó]lares|reais|bucks|usd)\b|R\$\s?\d)/i;
const QUOTE_PERIOD = /(?:\b(?:premium|per month|a month|monthly|each month|every month|per year|a year|every year|each year|annually|annual|yearly|al mes|por mes|mensual(?:es)?|cada mes|al a[nñ]o|por a[nñ]o|anual(?:es)?|prima|por m[eê]s|mensal(?:idade)?|cada m[eê]s|todo m[eê]s|por ano|ao ano|pr[eê]mio)\b|\/\s?(?:mo|month|yr|year)\b)/i;
// Hedge que vale na frase inteira: aproximação ou ilustração explícita.
const QUOTE_HEDGE = /\b(example|for example|e\.g\.|around|about|roughly|approximately|typically|usually|often|depends|depending|estimate|ballpark|range|starting at|as low as|illustrat\w*|ejemplo|por ejemplo|alrededor|aproximadamente|depende|t[ií]picamente|estimad\w*|exemplo|por exemplo|cerca de|em torno|tipicamente|estimativa|faixa|ilustrativ\w*)\b/i;
// Modal só vale ANTES do valor: "might see $40 a month" hedgeia o preço, mas em
// "$85 a month, and that may not change" o "may" fala de outra coisa.
const QUOTE_MODAL_BEFORE = /\b(could|might|may|can|podr[ií]a|poderia|puede|pode)\b/i;

function isDefinitiveQuote(sentence: string): boolean {
  const amount = QUOTE_AMOUNT.exec(sentence);
  if (amount === null || !QUOTE_PERIOD.test(sentence)) return false;
  return !QUOTE_HEDGE.test(sentence) && !QUOTE_MODAL_BEFORE.test(sentence.slice(0, amount.index));
}

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

// Caracteres que o ouvido não distingue e a regex distingue. Sem isto, um
// apóstrofo tipográfico ("you’re approved") ou um zero-width dentro da palavra
// desligava a regra inteira, e o TTS lê as duas versões do mesmo jeito.
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤ㅤ︀-️﻿]/g;
const APOSTROPHES = /[‘’‛ʼʹ`´′＇]/g;
const DASHES = /[‐-―−﹘﹣－]/g;
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d", "ԛ": "q", "ԝ": "w",
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I",
  "ο": "o", "α": "a", "ε": "e", "ι": "i", "ν": "v", "ρ": "p", "τ": "t", "υ": "u", "κ": "k",
  "Α": "A", "Β": "B", "Ε": "E", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X",
};
const HOMOGLYPH_PATTERN = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");

/** Só para casar regra: a resposta que vai ao áudio nunca é a normalizada. */
export function normalizeForMatching(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(APOSTROPHES, "'")
    .replace(DASHES, "-")
    .replace(HOMOGLYPH_PATTERN, (char) => HOMOGLYPHS[char] ?? char)
    .replace(/\s+/g, " ");
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);
}

// A negação só absolve a afirmação da MESMA oração: em "No problem, you're
// approved" o "No" pertence a outra oração e não desfaz a promessa.
const CLAUSE_BREAK = /[,;:]|\s(but|however|pero|sin embargo|mas|porém|porem)\s/gi;

function clauseStart(sentence: string, start: number): number {
  let from = 0;
  for (const match of sentence.matchAll(CLAUSE_BREAK)) {
    const at = match.index ?? 0;
    if (at < start) from = at + match[0].length;
    else break;
  }
  return from;
}

// "Don't worry" e "no te preocupes" têm a palavra de negação, mas não negam a
// afirmação que vem depois: "Don't worry you're approved" é uma promessa.
const NEGATION_IDIOMS = /\b(?:do not|don't|no)\s+worr(?:y|ies|ying)\b|\bno\s+te\s+preocupes?\b|\bno\s+se\s+preocupe\b|\bn[aã]o\s+(?:se|te)\s+preocupe?s?\b/giu;

function ruleMatches(rule: Rule, sentence: string): boolean {
  for (const pattern of rule.patterns) {
    const match = pattern.exec(sentence);
    if (!match) continue;
    if (!rule.negationSensitive) return true;
    // A negação só absolve o que vem ANTES da afirmação na mesma oração, ou
    // dentro dela ("we're not with Medicare"). Uma negação depois ("you're
    // pre-approved with no medical exam") fala de outra coisa e não desfaz a promessa.
    const from = clauseStart(sentence, match.index);
    const scope = sentence.slice(from, match.index + match[0].length).replace(NEGATION_IDIOMS, " ");
    if (NEGATION.test(scope)) continue;
    if (rule.conditionalSensitive === true && CONDITIONAL.test(sentence.slice(from, match.index))) continue;
    return true;
  }
  return false;
}

function sentenceViolations(sentence: string): ComplianceViolation[] {
  const found: ComplianceViolation[] = [];
  for (const rule of RULES) {
    if (!found.includes(rule.id) && ruleMatches(rule, sentence)) found.push(rule.id);
  }
  if (isDefinitiveQuote(sentence)) found.push("li_definitive_quote");
  return found;
}

export function enforceLifeInsuranceCompliance(reply: string, fallbackLanguage: SentinelLanguage): SentinelResult {
  const sentences = splitSentences(reply);
  const kept: string[] = [];
  const violations = new Set<ComplianceViolation>();
  for (const sentence of sentences) {
    // Casa na cópia normalizada; guarda a frase original para o áudio.
    const found = sentenceViolations(normalizeForMatching(sentence));
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
