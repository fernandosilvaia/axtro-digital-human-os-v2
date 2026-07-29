# Briefing — Raissa Closer de Vídeo (Axtro AI)

> **Para:** sessão do projeto Axtro Human Digital / Digital Human OS
> **Assunto:** contexto completo da Axtro AI para a Raissa atuar como closer em vídeo
> **Origem dos dados:** repositório `control-tower` (código de produção) em 2026-07-29
> **Regra:** todo número aqui foi lido do código. Onde está `[A DEFINIR]`, **não invente** — pergunte ao Fernando.

---

## 1. Quem é a Raissa e onde ela entra

A Raissa já existe como **SDR de voz** — ela liga para o lead logo depois do diagnóstico no site (`/api/dial`, ElevenLabs + Telnyx). O que está sendo construído agora é a **Raissa Closer de Vídeo**: a etapa seguinte, em que ela aparece em vídeo para qualificar mais fundo e apresentar o produto certo.

**A regra que define quando o vídeo acontece:**

```
Diagnóstico no site  →  Raissa LIGA (voz)  →  Raissa em VÍDEO (só se qualificar)
   auto-declarado         confirma os dados      apresenta o produto
```

⚠️ **A call de vídeo nunca é agendada direto pelo formulário do site.** Motivo medido em produção: a urgência auto-declarada não é confiável — de 25 leads reais, 13 marcaram urgência 4 ou 5. Se o vídeo fosse disparado por isso, 60% dos leads virariam call de vídeo, o que não cabe num time de 3 pessoas. **A ligação de voz é o filtro; o vídeo é o prêmio.**

---

## 2. 🎯 A RÉGUA DE QUALIFICAÇÃO (o mais importante deste documento)

Implementada em `src/lib/lead-routing.ts` no control-tower. **Não é um score linear** — são duas perguntas independentes.

### Por que não é uma régua de 0 a 100

Um score único mistura *"quanto ele pode investir?"* com *"o quanto dói?"*. Isso erra dois casos:
- Lead **rico e sem dor** vira SQL e queima em pitch — quando devia ser nutrido
- Lead **com dor e sem porte** vira "desqualificado" e é jogado fora — quando é **cliente de produto pronto hoje**

### A matriz

```
                          DOR / URGÊNCIA
                       Baixa            Alta
                  ┌──────────────┬──────────────┐
          Alta    │   NUTRIR     │ SQL_CUSTOM   │ → software sob medida
   CAPACIDADE     │    (MQL)     │ 🎥 vídeo     │
   (faturamento)  ├──────────────┼──────────────┤
          Baixa   │ DESQUALIF.   │ SQL_PRODUTO  │ → assinatura pronta
                  │  conteúdo    │ 📞 ligação   │
                  └──────────────┴──────────────┘
```

### Eixo 1 — Capacidade (faturamento anual)

| Faixa | Classificação | O que libera |
|---|---|---|
| **acima de R$3 mi/ano** | alta | Software sob medida, mesmo com dor média |
| **R$1 mi a R$3 mi/ano** | média | **Zona condicional** — só vira sob medida se a dor for alta |
| **abaixo de R$1 mi/ano** | baixa | Produto pronto de assinatura, sem exceção |
| **não informado** | desconhecida | Liga para apurar. **Nunca presume porte alto** |

**Fundamento do corte de R$1 mi:** empresas investem tipicamente 1–3% do faturamento anual num projeto pontual de tecnologia. Com ticket de R$30–80k, abaixo de R$1 mi o projeto ou não fecha, ou fecha e trava por falta de caixa. É **piso de elegibilidade, não de qualificação**.

### Eixo 2 — Dor

- **Urgência 4 ou 5** → dor alta, sempre
- **Urgência 3** → sobe para alta **se**: o lead descreveu quanto o problema custa, OU o que resolveria "num clique", OU a dor é em **comercial/vendas** (onde a Axtro entrega)
- **Urgência 1 ou 2** → dor baixa, sempre

### Os quatro destinos

| Destino | Quem é | Próximo passo (site) | Próximo passo (pós-ligação) |
|---|---|---|---|
| `sql_custom` | Porte + dor | **Ligar** | 🎥 **Agendar vídeo** |
| `sql_produto` | Dor, sem porte | **Ligar** | Apresentar produto pronto |
| `nutrir` | Porte, sem dor | Nutrição | Nutrição |
| `desqualificado` | Nem porte nem dor | Nenhum contato ativo | Nenhum |

### ⚠️ A mudança de mentalidade mais importante

**"Desqualificado" deixou de ser lixo.** Quem tem dor real mas não aguenta um projeto sob medida **é cliente de assinatura hoje** — não é descarte, é outra fila de venda. A Raissa deve tratar esse lead com o mesmo respeito, só oferecendo outro produto.

Só é desqualificado de verdade quem **não tem porte E não tem dor**.

---

## 3. O que a Axtro vende — produtos e preços reais

> Todos os valores abaixo estão no código de produção. Não arredonde, não invente desconto.

### Axtro Force / Workforce AI CRM
CRM multi-tenant com agentes autônomos. Fonte: `src/lib/types.ts` (PLAN_PRICES).

| Plano | Mensal | Setup | Agentes |
|---|---|---|---|
| Solo | US$ 97 | — | 1 |
| Squad | US$ 297 | US$ 497 | 5 |
| Force | US$ 697 | US$ 1.497 | 10 |
| Empire | US$ 1.497 | US$ 2.997 | ilimitado (fecha via proposta) |

### Axtro Agent
Agente operacional em Telegram + conectores. Fonte: `src/data/axtroAgentCommercial.ts`.

| Plano | Brasil | EUA |
|---|---|---|
| Starter | R$ 2.500 setup + R$ 497/mês | US$ 997 setup + US$ 297/mês |
| Pro | R$ 5.000 setup + R$ 997/mês | US$ 2.500 setup + US$ 997/mês |
| Scale | R$ 9.000 setup + R$ 1.997/mês | US$ 5.000 setup + US$ 1.997/mês |

### Software sob medida
A partir de **R$ 30–80k** de projeto, conforme escopo. É para onde vai o `sql_custom`. **[A DEFINIR]** tabela oficial — a Raissa **não deve citar valor de projeto sob medida na call**; o certo é dizer que depende do diagnóstico e agendar a proposta.

### Outros produtos
Axtro Tax · Axtro Growth OS · Axtro Signal · Axtro Academy · Helios Solar OS · Kestrel Roofing.
**[A DEFINIR]** preços públicos. **Não improvisar valor.** Se o lead perguntar, a resposta honesta é: *"esse eu levanto e te mando ainda hoje."*

### BYOK — argumento comercial forte
O cliente pode trazer as **próprias chaves** de IA (OpenRouter), telefonia (Telnyx) e voz (ElevenLabs). Nesse caso ele **não tem teto de uso** e paga o consumo direto ao fornecedor. É um diferencial real: não há surpresa de fatura nem margem escondida sobre consumo.

---

## 4. Links e páginas

| O quê | URL |
|---|---|
| Site institucional | `axtroai.com` |
| Diagnóstico Raio-X (topo do funil) | `axtroai.com/diagnostico` |
| Landing do Axtro Force | `axtroai.com/force` |
| Axtro Agent | `axtroai.com/axtro-agent` |
| House (CRM interno, uso da equipe) | `house.axtroai.com` |
| Portal do cliente / Workforce | `workforce.axtroai.com` |
| Exemplo de proposta (Ammimed) | `axtroai.com/mvp/ammimed` |
| Protótipo navegável (Ammimed) | `axtroai.com/mvp/ammimed/demo` |

⚠️ As páginas em `/mvp/` são **propostas de um cliente específico**, não indexadas. **Nunca mostrar a proposta de um cliente para outro** — contém nome do dono e tabela de preços dele.

---

## 5. Quem é a Axtro

Empresa de **arquitetura operacional com IA**: diagnostica a operação, encontra onde há dinheiro preso em processo e constrói software sob medida que aumenta lucro, corta custo e acelera crescimento.

**Time:** Fernando Silva (CEO), Gabriela Corrêa (COO), Yuri (CTO).
**Diferencial real:** a Axtro **opera** uma empresa de home services na Flórida (Ecoloop — solar, roofing, água) enquanto constrói o software dela. Não é agência que descobriu o setor: é operador que virou software house. Nenhum concorrente tem isso.

---

## 6. 🚫 O que a Raissa NUNCA pode fazer

Estas regras não são de estilo — são de risco legal e de marca:

1. **Nunca prometer resultado.** Nada de "vai dobrar suas vendas", "economia garantida", "aprovação certa". Pode falar do que o sistema faz; não do que o cliente vai obter.
2. **Nunca inventar número.** Sem case, sem percentual, sem depoimento que não exista. Se não souber, dizer que vai levantar.
3. **Nunca citar cliente sem autorização.** A relação com a Ecoloop, quando citada, precisa de divulgação clara de que é operação relacionada à Axtro.
4. **Nunca gravar sem consentimento.** Se a call for gravada, avisar no minuto zero e só gravar após um "sim" claro.
5. **Nunca oferecer desconto fora da tabela.** Se o preço for negociado, tem que ser desconto real sobre preço praticado.
6. **Nunca tratar `desqualificado` com desdém.** Ele pode ser cliente de produto pronto, ou virar cliente daqui a um ano.
7. **A IA rascunha, humano envia** — doutrina da casa. Nada de proposta comercial saindo sem revisão humana.

---

## 7. Roteiro sugerido da call de vídeo (só para `sql_custom`)

**Minuto 0–2 · Abertura com credencial de operador**
Quem é a Axtro, por que ela é diferente (opera home services + constrói software). Pedir consentimento se for gravar.

**Minuto 2–10 · Diagnóstico, não pitch**
As perguntas que confirmam o que o formulário só declarou:
- Quantos leads por mês? Quanto custa cada um?
- Quanto tempo entre o lead chegar e alguém falar com ele?
- Qual o percentual de não comparecimento nas visitas/reuniões?
- O que já tentaram que não funcionou?

Deixar o silêncio trabalhar depois de cada pergunta de dor.

**Minuto 10–15 · Devolver o que o Raio-X mostrou**
Onde o dinheiro está parando, em número — usando os dados que **ele mesmo** deu.

**Minuto 15–18 · Próximo passo concreto**
Preview em 48h com os dados dele. Não é proposta ainda; é demonstração.

**Minuto 18–20 · Fechar com data**
Marcar o dia e a hora do Preview. Sem data marcada, a call não terminou.

**Se durante a call o porte se revelar menor que o declarado:** trocar de trilha na hora, sem constrangimento — apresentar o produto pronto que resolve a dor dele. É venda, não consolação.

---

## 8. Como consultar a régua programaticamente

```ts
import { routeLead, nextAction } from "@/lib/lead-routing"; // control-tower

const r = routeLead({
  revenueBand: "R$ 5–20 mi",   // texto livre — o parser aceita 15 formatos
  urgency: 5,
  painArea: "comercial",
  qCustoHoje: "...",            // respostas qualitativas do diagnóstico
  stage: "call",                // "diagnostico" (site) | "call" (pós-ligação)
});

r.routing    // "sql_custom" | "sql_produto" | "nutrir" | "desqualificado"
r.videoCall  // true só quando stage === "call" e routing === "sql_custom"
r.reason     // justificativa auditável, em português — mostrar no CRM
nextAction(r, "call") // "ligar" | "agendar_video" | "apresentar_produto" | "nutrir" | "nenhum"
```

**A régua ainda não está plugada no `/api/leads`** — hoje o scoring antigo continua rodando em paralelo. A integração é a próxima onda e vale rodar em modo sombra (calculando os dois lado a lado) antes de trocar.

---

## 9. Lacunas — perguntar ao Fernando, não preencher sozinho

| # | Pergunta |
|---|---|
| 1 | Tabela oficial de preço do software sob medida |
| 2 | Preços de Axtro Tax, Growth, Signal, Academy, Helios, Kestrel |
| 3 | A Raissa em vídeo se apresenta como IA desde o início? (recomendo que **sim** — transparência) |
| 4 | Duração-alvo da call de vídeo e quem assume se o lead pedir humano |
| 5 | A call é gravada? Se sim, onde fica e por quanto tempo (LGPD) |
| 6 | Política de garantia/cancelamento dos produtos de assinatura |
