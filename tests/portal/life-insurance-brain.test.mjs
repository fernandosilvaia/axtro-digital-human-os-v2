import assert from "node:assert/strict";
import { test } from "node:test";

// Mesmo padrão de metodo-silva-brain.test.mjs: o portal fica fora do grafo
// tsc --build, mas este módulo é puro e sem imports de runtime, então o type
// stripping nativo do Node o executa direto do fonte.
const life = await import("../../apps/portal/src/lib/brain/life-insurance.ts");

const MODES = ["qualification", "recruitment"];
const LANGUAGES = ["portuguese", "english"];

/**
 * Frases que criam exposição regulatória real se a agente as disser numa call
 * com cliente. Não são preferência de estilo: "licença federal" de agente de
 * seguros não existe nos EUA (só estadual), e sugerir vínculo com Medicare,
 * Social Security ou governo é proibido pela FTC Impersonation Rule (2024).
 * Os documentos internos do próprio Billion Club se contradizem aqui: o
 * Master Script proíbe, os scripts de campo usam. O core tem que carregar a
 * proibição explicitamente, nos dois idiomas e nos dois modos, porque é a
 * única parte que não pode depender de o RAG ter trazido o chunk certo.
 */
const FORBIDDEN_CLAIMS = {
  portuguese: ["underwriter", "licença federal", "Medicare"],
  english: ["underwriter", "federal license", "Medicare"],
};

test("o núcleo de life insurance carrega os limites regulatórios nos dois modos e nos dois idiomas", () => {
  for (const mode of MODES) {
    for (const language of LANGUAGES) {
      const core = life.buildLifeInsuranceCore(mode, language);
      assert.ok(core.length > 0, `${mode}/${language} deve produzir núcleo`);
      for (const claim of FORBIDDEN_CLAIMS[language]) {
        assert.ok(
          core.includes(claim),
          `${mode}/${language} precisa nomear "${claim}" para poder proibi-lo; uma proibição implícita não governa o modelo`,
        );
      }
      // Opt-out é regra inviolável em todo modo: TCPA e a política da própria
      // operação tratam pedido de parada como encerramento imediato.
      const optOut = language === "english" ? "not to be contacted" : "não ser mais contatada";
      assert.ok(core.includes(optOut), `${mode}/${language} precisa carregar a doutrina de opt-out`);
    }
  }
});

test("modo qualificação declara que a IA não fecha a apólice, porque quem fecha precisa de licença estadual", () => {
  const pt = life.buildLifeInsuranceCore("qualification", "portuguese");
  assert.ok(pt.includes("NÃO fecha a apólice"), "a fronteira precisa ser explícita, não subentendida");
  assert.ok(pt.includes("licenciado"), "o destino do caso é o agente humano licenciado");
  assert.ok(pt.includes("SILVA"), "a régua de qualificação da operação é o SILVA");

  const en = life.buildLifeInsuranceCore("qualification", "english");
  assert.ok(en.includes("do NOT close the policy"));
  assert.ok(en.includes("licensed"));
});

test("modo qualificação nunca direciona para IUL por conta própria", () => {
  // Precedente escrito da própria casa (handoff raizes-finance, D-V2 de
  // 2026-09-10): direcionamento de proteção para IUL foi REMOVIDO de um
  // produto por honestidade e compliance. A closer não pode reintroduzi-lo.
  const pt = life.buildLifeInsuranceCore("qualification", "portuguese");
  assert.ok(
    pt.includes("nunca direciona por conta própria para IUL"),
    "a proibição de empurrar IUL precisa estar no prompt, não só na cabeça de quem escreveu",
  );
  const en = life.buildLifeInsuranceCore("qualification", "english");
  assert.ok(en.includes("never steer on your own toward IUL"));
});

test("modo recrutamento é honesto sobre comissão e nunca promete renda", () => {
  const pt = life.buildLifeInsuranceCore("recruitment", "portuguese");
  assert.ok(pt.includes("comissão"), "o modelo de remuneração precisa ser declarado");
  assert.ok(pt.includes("Nunca prometa renda"), "promessa de renda é a falha clássica de recrutamento");
  assert.ok(pt.includes("autorização para trabalhar"), "autorização de trabalho é pré-requisito real, não formalidade");

  const en = life.buildLifeInsuranceCore("recruitment", "english");
  assert.ok(en.includes("commission based"));
  assert.ok(en.includes("Never promise income"));
  assert.ok(en.includes("work authorization"));
});

test("modo recrutamento não herda as regras de produto, mas herda as de honestidade", () => {
  const recruitment = life.buildLifeInsuranceCore("recruitment", "portuguese");
  const qualification = life.buildLifeInsuranceCore("qualification", "portuguese");
  // O bloco de compliance é o mesmo nos dois: recrutar não isenta de nada.
  assert.ok(recruitment.includes("LIMITES REGULATÓRIOS"));
  assert.ok(qualification.includes("LIMITES REGULATÓRIOS"));
  // Mas a régua SILVA de produto não pertence ao recrutamento.
  assert.ok(!recruitment.includes("Final Expense cobre"), "recrutamento não fala de produto ao candidato");
});

test("a identidade enquadra mercado e papel logo na primeira frase", () => {
  for (const language of LANGUAGES) {
    const qualification = life.buildLifeInsuranceIdentity({
      agentName: "Sofia", tenantName: "Billion Club", language, mode: "qualification",
    });
    const recruitment = life.buildLifeInsuranceIdentity({
      agentName: "Sofia", tenantName: "Billion Club", language, mode: "recruitment",
    });
    for (const identity of [qualification, recruitment]) {
      assert.ok(identity.includes("Sofia"), "a identidade carrega o nome da agente");
      assert.ok(identity.includes("Billion Club"), "e o nome do tenant");
      const ai = language === "english" ? "AI" : "IA";
      assert.ok(identity.includes(ai), "disclosure de IA é inegociável, Art. 4");
    }
    assert.notEqual(qualification, recruitment, "os dois modos não podem se apresentar do mesmo jeito");
  }
});

test("o núcleo cabe no orçamento de prompt de persona", () => {
  // Mesmo teto confortável que metodo-silva-brain.test.mjs já trava para o
  // prompt inteiro: o núcleo de domínio é somado à doutrina Silva e aos
  // blocos genéricos de vídeo, então sozinho precisa sobrar espaço.
  const PERSONA_PROMPT_COMFORT_CAP = 14_000;
  for (const mode of MODES) {
    for (const language of LANGUAGES) {
      const core = life.buildLifeInsuranceCore(mode, language);
      assert.ok(
        core.length < PERSONA_PROMPT_COMFORT_CAP / 2,
        `${mode}/${language} tem ${core.length} chars e precisa deixar espaço para o resto do prompt`,
      );
    }
  }
});

test("o núcleo nunca ensina a agente a cotar, aprovar ou emitir", () => {
  for (const mode of MODES) {
    const pt = life.buildLifeInsuranceCore(mode, "portuguese");
    assert.ok(pt.includes("não cota, não aprova e não emite") || pt.includes("Você não cota"),
      `${mode}: a fronteira de cotação precisa estar explícita`);
    assert.ok(pt.includes("SSN completo"), `${mode}: dado sensível não se pede em call de vídeo`);
  }
});
