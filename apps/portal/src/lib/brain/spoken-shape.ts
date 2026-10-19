/**
 * Limitador de fala das closers de vertical (2026-10-17).
 *
 * A avaliação ao vivo com o modelo de produção mostrou que o prompt não segura
 * o tamanho do turno: em 72 respostas, 38 passaram de 4 frases e 19 fizeram
 * mais de uma pergunta, nas duas versões do prompt. Em voz isso é monólogo, e
 * quem perde é a pessoa do outro lado. Instrução de prompt é probabilística;
 * o tamanho do turno é uma propriedade que dá para garantir depois da geração.
 *
 * Política (medida em 144 respostas gravadas, sem nenhuma pergunta perdida):
 * - até 4 frases e no máximo 1 pergunta: passa intacta;
 * - acima disso, ficam 3 frases afirmativas mais a pergunta que conduz o turno;
 * - frases que carregam compromisso (aviso de IA, agente licenciado, negação de
 *   vínculo com governo, verificação de licença) entram primeiro na contagem;
 * - perguntas encadeadas ("É o custo? Ou o encaixe?") viram uma só pergunta.
 *
 * Determinístico, sem rede, e idempotente: rodar duas vezes dá o mesmo texto.
 */

export const SPOKEN_MAX_SENTENCES = 4;

// Elogio à pergunta no começo da fala ("Ótima pergunta."). Em 32 de 108 respostas ao vivo o modelo abriu
// assim, mesmo com a regra no prompt, e é o cheiro de robô mais fácil de notar. Sai só o elogio; o que vem
// depois é a resposta e fica.
const PRAISE_OPENERS = [
  /^(?:(?:[óo]tima|boa|excelente|muito boa|que (?:[óo]tima|boa))\s+pergunta(?:\s+essa)?|[óo]timo que (?:voc[eê] )?perguntou)[!.,:;]+\s*(?:e\s+)?/i,
  /^(?:[óo]timo|boa|excelente),?\s+voc[eê]\s+(?:est[aá] fazendo|fez|fez uma) (?:a |uma )?(?:pergunta certa|boa pergunta)[!.,:;]+\s*/i,
  /^(?:great|good|excellent|fantastic|fair) question[!.,:;]+\s*(?:and\s+)?/i,
  /^(?:excelente|buena|muy buena|gran) pregunta[!.,:;]+\s*(?:y\s+)?/i,
];

// Tique de "vou ser honesto/transparente com você:" no começo de frase. Aparece em quase todo turno longo
// e soa como fórmula; a frase honesta que vem depois fica, sem o prefixo.
const HONESTY_TICS = [
  /^(?:(?:agora|ent[aã]o|mas|olha|bom|bem)[,.]?\s+)?(?:deixa eu|vou|quero|deixe-me) ser (?:bem |muito )?(?:transparente|honesto|honesta|direto|direta|claro|clara|sincero|sincera)(?: com voc[eê])?[:,.]?\s*/i,
  /^(?:(?:now|so|but|look)[,.]?\s+)?(?:let me be|i'll be|i will be|i want to be) (?:honest|transparent|direct|upfront|straight)(?: with you)?[:,.]?\s*/i,
  /^(?:le voy a ser|voy a ser|d[eé]jeme ser) (?:honesto|honesta|directo|directa|transparente)(?: con usted)?[:,.]?\s*/i,
];
// O mesmo tique no fim de uma frase: "..., mas deixa eu ser direto com você."
const TRAILING_TIC = /[,;]?\s*(?:mas\s+|e\s+)?(?:deixa eu|vou|quero) ser (?:bem |muito )?(?:transparente|honesto|honesta|direto|direta|claro|clara|sincero|sincera)(?: com voc[eê])?\s*([.!?])$/i;

function stripTic(sentence: string): string {
  for (const pattern of HONESTY_TICS) {
    const match = pattern.exec(sentence);
    if (match === null) continue;
    const rest = sentence.slice(match[0].length);
    return rest.trim().length === 0 ? "" : rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  const trailing = TRAILING_TIC.exec(sentence);
  if (trailing !== null) {
    const head = sentence.slice(0, trailing.index).trim();
    return head.length === 0 ? "" : `${head}${trailing[1]}`;
  }
  return sentence;
}

function stripPraiseOpener(text: string): string {
  for (const pattern of PRAISE_OPENERS) {
    const match = pattern.exec(text);
    if (match === null) continue;
    const rest = text.slice(match[0].length);
    if (rest.trim().length === 0) return text;
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return text;
}

// Frases que não podem ser a primeira a cair quando o corte acontece.
const PROTECTED_SENTENCE = /(\bAI\b|\bIA\b|inteligencia artificial|inteligência artificial|licensed|licencia|licenciad|department of insurance|departamento de seguros|medicare|government|gobierno|governo|human team|equipo humano|time humano|no obligation|sin compromiso|sem compromisso)/i;
// "Or is it...?", "Ou é...?": a segunda pergunta continua a primeira.
const QUESTION_CONTINUATION = /^(?:or|and|ou|e|o|y|u)\b/i;
const ABBREVIATION = /\b(?:U\.S|Dr|Mr|Mrs|Ms|St|vs|e\.g|i\.e|a\.m|p\.m|etc|Sr|Sra|Srta|Dra)\./gi;
const DOT_PLACEHOLDER = "\u0001";

function isQuestion(sentence: string): boolean {
  return /\?["')\]”’]*$/.test(sentence);
}

function splitSentences(text: string): string[] {
  const protectedText = text.replace(ABBREVIATION, (match) => match.slice(0, -1) + DOT_PLACEHOLDER);
  return protectedText
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.replaceAll(DOT_PLACEHOLDER, ".").trim())
    .filter((sentence) => sentence.length > 0);
}

/** "É o custo? Ou o encaixe?" vira "É o custo, ou o encaixe?". */
function mergeQuestionChain(chain: string[]): string {
  return chain
    .map((sentence, index) => {
      if (index === chain.length - 1) return sentence;
      const withoutMark = sentence.replace(/\?["')\]”’]*$/, "");
      const next = chain[index + 1] ?? "";
      return QUESTION_CONTINUATION.test(next) ? `${withoutMark},` : `${withoutMark}.`;
    })
    .map((sentence, index) => (index > 0 && QUESTION_CONTINUATION.test(sentence) ? sentence.charAt(0).toLowerCase() + sentence.slice(1) : sentence))
    .join(" ");
}

export function shapeSpokenReply(original: string, maxSentences: number = SPOKEN_MAX_SENTENCES): string {
  const text = stripPraiseOpener(original.trimStart());
  const flat = text.replace(/\s*\n+\s*/g, " ").trim();
  const split = splitSentences(flat);
  const sentences = split.map(stripTic).filter((sentence) => sentence.length > 0);
  const questionCount = sentences.filter(isQuestion).length;
  const ticsRemoved = sentences.length !== split.length || sentences.some((sentence, index) => sentence !== split[index]);
  if (!ticsRemoved && sentences.length <= maxSentences && questionCount <= 1) return text;

  // Ultima pergunta e, se as de antes a continuam, a cadeia inteira.
  let lastQuestion: string | null = null;
  const questionIndexes = sentences.flatMap((sentence, index) => (isQuestion(sentence) ? [index] : []));
  if (questionIndexes.length > 0) {
    const lastIndex = questionIndexes[questionIndexes.length - 1] as number;
    const chain: string[] = [sentences[lastIndex] as string];
    let cursor = lastIndex;
    while (cursor > 0 && isQuestion(sentences[cursor - 1] as string) && QUESTION_CONTINUATION.test(sentences[cursor] as string)) {
      cursor -= 1;
      chain.unshift(sentences[cursor] as string);
    }
    lastQuestion = chain.length === 1 ? chain[0] as string : mergeQuestionChain(chain);
  }

  const statements = sentences.filter((sentence) => !isQuestion(sentence));
  const room = lastQuestion === null ? maxSentences : maxSentences - 1;
  const chosen = new Set<number>();
  statements.forEach((sentence, index) => {
    if (chosen.size < room && PROTECTED_SENTENCE.test(sentence)) chosen.add(index);
  });
  statements.forEach((_, index) => {
    if (chosen.size < room) chosen.add(index);
  });
  const kept = statements.filter((_, index) => chosen.has(index));
  return [...kept, ...(lastQuestion === null ? [] : [lastQuestion])].join(" ");
}
