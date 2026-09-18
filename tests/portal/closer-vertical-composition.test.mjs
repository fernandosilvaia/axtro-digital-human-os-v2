import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

// Mesmo padrão de metodo-silva-brain.test.mjs: módulos puros, executados
// direto do fonte pelo type stripping do Node.
const brain = await import("../../apps/portal/src/lib/brain/metodo-silva.ts");
const life = await import("../../apps/portal/src/lib/brain/life-insurance.ts");

const LANGUAGES = ["portuguese", "english"];
const MODES = ["qualification", "recruitment"];
const PERSONA_PROMPT_COMFORT_CAP = 14_000;

function regulatedPrompt(language, mode) {
  return brain.buildCloserVideoSystemPrompt({
    agentName: "Sofia",
    tenantName: "Billion Club",
    language,
    identityOverride: life.buildLifeInsuranceIdentity({
      agentName: "Sofia", tenantName: "Billion Club", language, mode,
    }),
    domainCore: life.buildLifeInsuranceCore(mode, language),
  });
}

/**
 * O prompt genérico é o produto inteiro: toda persona em produção hoje usa
 * ele. Tornar o Método consciente de vertical é uma refatoração que NÃO pode
 * mudar um único caractere desse caminho, e "não mudou" é fácil de acreditar e
 * difícil de provar. O hash prova.
 *
 * Se um deles quebrar, a pergunta certa não é "atualizo o hash?", é "eu quis
 * mesmo mudar a doutrina de todas as personas em produção?".
 *
 * Primeira atualização em 2026-09-15: a doutrina (metodo-silva.ts,
 * maestria-humana.ts) tinha travessão em várias frases, incluindo texto que
 * vai literal pro prompt do provider, o que viola a regra da casa (nenhum
 * travessão em qualquer saída escrita da Axtro, pedido do Fernando
 * 2026-08-29, CLAUDE.md global). Cada travessão foi trocado por ponto,
 * vírgula, dois-pontos ou parênteses preservando o sentido exato.
 *
 * Segunda atualização no mesmo dia, depois de testar a Sofia com crédito
 * real do OpenRouter pela primeira vez (D-V2-180): mesmo com o prompt limpo
 * de travessão, o modelo (Claude Haiku 4.5) continuou gerando travessão na
 * própria fala, e uma resposta veio com **negrito** markdown, que vira
 * áudio literal na chamada de vídeo. Instrução no meio do prompt (RITMO DE
 * VÍDEO) não foi suficiente sozinha; um bloco final dedicado (REGRA DE
 * ESTILO / STYLE RULE, o último texto antes do modelo gerar) resolveu nos
 * testes reais. A instrução também parou de citar o caractere travessão
 * literalmente dentro de si mesma (mostrar o glifo como "exemplo do que não
 * fazer" parecia induzir o modelo a repeti-lo).
 *
 * Terceira atualização, minutos depois: a mesma fala real também escapou
 * itálico markdown (`*can*`) que a instrução anterior não cobria porque só
 * falava de negrito/lista/cabeçalho. Adicionado "itálico" explicitamente
 * nas duas superfícies (chat e vídeo, pt e en).
 *
 * Valores anteriores: pt b8314a82f6d17eae/ed1b1f22b2fb57a5/25e6f7ef2a2ca00e,
 * en d7b73e1d6135d930/feaca0580b1c35da/c7bb9dbac7c79599.
 */
const GENERIC_VIDEO_PROMPT_SHA256 = {
  portuguese: "bb14aa41574a2343",
  english: "08ba6e46ebfcbb5c",
};

test("a doutrina genérica de vídeo permanece byte a byte idêntica", () => {
  for (const language of LANGUAGES) {
    const prompt = brain.buildCloserVideoSystemPrompt({
      agentName: "S", tenantName: "T", language,
    });
    const digest = createHash("sha256").update(prompt, "utf8").digest("hex").slice(0, 16);
    assert.equal(
      digest,
      GENERIC_VIDEO_PROMPT_SHA256[language],
      `${language}: o prompt genérico mudou; nenhuma vertical pode alterar o caminho padrão`,
    );
  }
});

test("a vertical regulada remove as fases que contradizem o próprio núcleo", () => {
  for (const language of LANGUAGES) {
    for (const mode of MODES) {
      const prompt = regulatedPrompt(language, mode);
      const where = `${language}/${mode}`;
      // Fase de preço e fase de fechamento mandam o oposto do que a vertical
      // manda ("você não cota", "você NÃO fecha a apólice"). Um prompt que diz
      // as duas coisas é pior que qualquer uma sozinha.
      for (const phase of ["FASE 4 ·", "FASE 5 ·", "PHASE 4 ·", "PHASE 5 ·"]) {
        assert.ok(!prompt.includes(phase), `${where}: ${phase} contradiz a vertical regulada`);
      }
      // Descoberta genérica sai porque a vertical traz a mesma descoberta já
      // instanciada no mercado dela.
      for (const phase of ["FASE 2 ·", "PHASE 2 ·"]) {
        assert.ok(!prompt.includes(phase), `${where}: ${phase} é substituída pela descoberta da vertical`);
      }
      // As fases que continuam válidas não podem ter sido levadas junto.
      const kept = language === "english" ? ["PHASE 1 ·", "PHASE 3 ·", "PHASE 6 ·"] : ["FASE 1 ·", "FASE 3 ·", "FASE 6 ·"];
      for (const phase of kept) {
        assert.ok(prompt.includes(phase), `${where}: ${phase} continua valendo e precisa estar no prompt`);
      }
    }
  }
});

test("o cabeçalho do Método anuncia agendamento, nunca venda, na vertical regulada", () => {
  // Sem isto o modelo procura uma "Fase 5" que não existe mais no prompt e
  // inventa o conteúdo dela.
  assert.ok(regulatedPrompt("portuguese", "qualification").includes("nunca até a venda"));
  assert.ok(regulatedPrompt("english", "qualification").includes("never to the sale"));
});

test("a vertical regulada não carrega alavanca de influência nem enquadramento de preço", () => {
  // Decisão de compliance, não de orçamento: escassez, prova social e
  // reciprocidade a serviço do avanço são exatamente o que a regulação olha
  // com lupa num mercado que inclui idoso em renda fixa. E o enquadramento de
  // valor termina apontando para a Fase 4, que não existe mais aqui.
  for (const language of LANGUAGES) {
    for (const mode of MODES) {
      const prompt = regulatedPrompt(language, mode);
      for (const title of ["ALAVANCAS DE INFLUÊNCIA", "ENQUADRAMENTO DE VALOR", "LEVERS OF INFLUENCE", "VALUE FRAMING"]) {
        assert.ok(!prompt.includes(title), `${language}/${mode}: "${title}" não pertence a uma vertical regulada`);
      }
      // O limite ético é o oposto: ele fica, sempre.
      const ethical = language === "english" ? "NON-NEGOTIABLE ETHICAL LIMIT" : "LIMITE ÉTICO INEGOCIÁVEL";
      assert.ok(prompt.includes(ethical), `${language}/${mode}: o limite ético nunca sai`);
    }
  }
});

test("o núcleo regulatório sobrevive inteiro à composição", () => {
  // O enxugamento do Método existe para abrir espaço a ESTE bloco. Se ele for
  // o que some, o corte foi pelo lado errado.
  for (const language of LANGUAGES) {
    for (const mode of MODES) {
      const prompt = regulatedPrompt(language, mode);
      const forbidden = language === "english"
        ? ["underwriter", "federal license", "Medicare"]
        : ["underwriter", "licença federal", "Medicare"];
      for (const claim of forbidden) {
        assert.ok(prompt.includes(claim), `${language}/${mode}: a proibição de "${claim}" precisa chegar na call`);
      }
    }
  }
});

test("a vertical regulada mantém as tools de agendamento, que são o desfecho dela", () => {
  // Uma closer que qualifica e não consegue agendar não entrega nada.
  for (const language of LANGUAGES) {
    for (const mode of MODES) {
      const prompt = regulatedPrompt(language, mode);
      for (const tool of ["register_lead", "propose_meeting_slots", "confirm_meeting_slot"]) {
        assert.ok(prompt.includes(tool), `${language}/${mode}: ${tool} precisa continuar no prompt`);
      }
    }
  }
});

test("o prompt composto cabe no teto de latência nos dois idiomas e nos dois modos", () => {
  for (const language of LANGUAGES) {
    for (const mode of MODES) {
      const length = regulatedPrompt(language, mode).length;
      assert.ok(
        length <= PERSONA_PROMPT_COMFORT_CAP,
        `${language}/${mode}: ${length} chars, acima do teto de ${PERSONA_PROMPT_COMFORT_CAP}`,
      );
    }
  }
});

test("identidade e núcleo de domínio são opcionais e não vazam para quem não pede", () => {
  const generic = brain.buildCloserVideoSystemPrompt({ agentName: "S", tenantName: "T", language: "portuguese" });
  assert.ok(!generic.includes("LIMITES REGULATÓRIOS"), "vertical nenhuma pode contaminar o prompt padrão");
  assert.ok(generic.includes("FASE 5 ·"), "o caminho padrão mantém a fase de fechamento");
});
