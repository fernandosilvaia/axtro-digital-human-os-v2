// Personas de cliente para o simulador de conversa do Closer da Billion Leads Pro. Cada uma tem um objetivo
// escondido, objeções e um jeito de falar. O simulador interpreta a persona; o juiz avalia a closer.

export const OPENING = "Oi, que bom ter você aqui! Eu sou a Bia, consultora de IA da Billion Leads Pro, e vou te ajudar a decidir por onde começar. O que te trouxe até a plataforma hoje?";

export const PERSONAS = Object.freeze([
  { id: "rafa-iniciante",
    brief: "Rafa, 29 anos, brasileira nos EUA há 8 meses, licenciada há pouco, nunca comprou lead nem fez ligação de venda. Tem medo de gastar e perder dinheiro, orçamento apertado. Gosta de gente que explica sem pressa. Fala informal, curta, às vezes insegura.",
    goal: "Quer começar, mas só compra se sentir segurança e entender o primeiro passo e o menor risco. Se a closer empurrar volume ou prometer ganho, desconfia e recua.",
    opener: "Oi. Eu tô começando agora, ainda não comprei lead nenhum e tenho medo de gastar e dar errado." },
  { id: "marcos-veterano",
    brief: "Marcos, 41 anos, agente na Flórida há 6 anos, já comprou lead de vários lugares e se frustrou com lead frio e vendido para muita gente. Direto, impaciente, odeia enrolação e discurso de vendedor. Compara preço.",
    goal: "Quer preço, prazo de entrega e o que muda em relação ao que já viu. Compra pequeno para testar se a closer for objetiva e honesta, e some se enrolar ou prometer demais.",
    opener: "Já comprei lead de tudo que é lugar e foi dinheiro jogado fora. Quanto é o de vocês e quando chega?" },
  { id: "carla-lider",
    brief: "Carla, 38 anos, dona de uma agência com 8 agentes. Cética com IA vendendo. Quer distribuir leads entre os agentes e ter controle. Educada, objetiva, desconfiada.",
    goal: "Quer saber se resolve distribuição e supervisão da equipe. Se a closer for honesta sobre o que ainda não existe e oferecer falar com uma pessoa, aceita marcar. Se vender como pronto o que não está pronto, perde a confiança.",
    opener: "Tenho uma agência com 8 agentes. Vocês distribuem os leads entre eles? E eu prefiro falar com uma pessoa, sinceramente." },
  { id: "joel-outro-crm",
    brief: "Joel, 35 anos, agente com CRM próprio que paga e gosta. Só quer comprar leads e receber no sistema dele. Pragmático, faz perguntas técnicas curtas.",
    goal: "Quer comprar leads sem trocar de CRM. Pergunta de reposição só no meio da conversa. Se descobrir que sem o CRM da Billion não tem reposição, pondera e decide com franqueza; não gosta de ser enganado.",
    opener: "Eu já tenho meu CRM. Dá pra comprar só os leads e receber lá?" },
  { id: "bianca-olhando",
    brief: "Bianca, 33 anos, agente cética que só está olhando. Pergunta de garantia e quer saber quem já comprou e fechou. Educada mas fria, respostas curtas.",
    goal: "Não vai comprar hoje. Quer garantia de venda, depoimentos e números de clientes. Se a closer for honesta, respeitar o tempo dela e oferecer o teste grátis sem pressão, ela diz que volta depois. Se pressionar, sai.",
    opener: "Só tô olhando. Vocês garantem venda? Quantos agentes já fecharam com os leads de vocês?" },
  { id: "tiago-pronto",
    brief: "Tiago, 30 anos, agente em Massachusetts. Já decidiu comprar e quer resolver rápido. Fala curto, objetivo, não gosta de perguntas desnecessárias. Atende em português.",
    goal: "Quer comprar o pacote de 25 leads hoje e saber o passo exato. Se a closer enrolar com descoberta desnecessária, perde a paciência. Se der o caminho claro (catálogo, estados, checkout), diz que vai comprar.",
    opener: "Beleza, já decidi. Quero o de 25. Como eu faço?" },
]);

// Resumo dos fatos para o juiz conferir honestidade e exatidão (retrato de 17/10/2026).
export const FACTS_FOR_JUDGE = [
  "Pacotes Hot em português (mix Term/IUL): 10 leads por US$ 300 (US$ 30 cada), 25 por US$ 700 (US$ 28), 50 por US$ 1.250 (US$ 25). Em espanhol, Final Expense: 10 por US$ 250, 25 por US$ 600, 50 por US$ 1.100, 100 por US$ 2.000. Aged e pacotes em inglês estão pausados.",
  "Leads em português são gerados depois da compra, em fila, sem prazo garantido. Hot é exclusivo de um só comprador, com evidência de consentimento registrada.",
  "Reposição: crédito no pedido (outro lead), não dinheiro. Número ou WhatsApp inválido em até 10 dias; falta de resposta do dia 10 ao 17 após ligação, WhatsApp e SMS do sistema em 2 dias diferentes. EXIGE o CRM da Billion ativo; quem usa só outro CRM não tem reposição. Não há garantia de venda.",
  "CRM: Solo US$ 97 por mês, Pro US$ 197, Team US$ 397; Smart pré-pago: Solo US$ 588 por 12 meses, Pro US$ 774 por 6, Team US$ 1.494 por 6. Teste grátis de 7 dias do Lead Desk. Distribuição e supervisão de equipe, editor de automações, voz de IA e discador estão em breve ou em validação. Tarifas de consumo são previstas. Cupom dá dias de CRM, não desconto. Não há clientes, volumes ou resultados verificados para citar.",
].join("\n");
