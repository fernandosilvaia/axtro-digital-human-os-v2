# PRODUCT_VISION — Axtro Human Sales AI

## Tese
Toda empresa terá funcionários digitais comerciais. Quem vencer não será quem tem "o avatar mais bonito", e sim quem tiver o **sistema operacional de vendas**: estado comercial estruturado, metodologia explícita, ferramentas governadas, memória, avaliação contínua e um gerente autônomo (Axtro Agent) que prepara, monitora e melhora a operação 24/7.

O mercado 2026 confirma a tese (ver BENCHMARK_STUDY.md): as plataformas que só automatizam outbound frio em volume perderam confiança; as que convertem são as que conduzem **conversas quentes ao vivo** (inbound, demo, fechamento) com qualidade humana. É exatamente onde o Método Silva é forte — e onde a Axtro entra.

## O que é
Uma **fábrica de closers digitais** white-label e multi-tenant. Cada empresa configura identidade, avatar, voz, idiomas, personalidade, produtos, scripts, metodologia (Método Silva nativo ou SPIN/BANT/MEDDIC/custom), objeções, preços e limites de desconto, políticas, base de conhecimento, apresentações, ferramentas (CRM, agenda, pagamento, assinatura), regras de compliance, condições de handoff, horários, campanhas e canais. Dados 100% isolados por tenant.

## O que NÃO é
- Não é um avatar que fala. É orquestração + inteligência comercial + governança; avatar é uma camada substituível.
- Não engana o cliente: a identificação de IA acontece de forma curta, elegante e configurável no início ("Olá, eu sou a Raissa, consultora virtual da empresa...") e depois a conversa flui naturalmente.
- Não dá aconselhamento regulado (seguros, financeiro, saúde, jurídico...) sem as proteções do módulo de compliance.

## Portfólio de agentes (Sales OS)
SDR de IA · Closer de IA · Agente de demonstração · Onboarding · Follow-up · Recuperação de leads · Customer Success · Qualificação · Supervisor comercial de IA · Coach de vendas · Analista de calls · Agente de compliance · **Axtro Agent** como gerente autônomo e orquestrador. Cada papel mapeia para uma etapa da Esteira Silva (Playbook, cap. 5) e para um manual do Método Silva já existente no projeto.

## Personas de compra
1. **Head Comercial / Founder BR** (estágios Crescimento→Escala do Método Silva): quer previsibilidade, show rate ≥70%, resposta a lead inbound <5min, CRM 100% atualizado — os 15 KPIs do Head viram o dashboard do produto.
2. **Agências e consultorias comerciais**: white-label, templates por vertical, revenda.
3. **Enterprise (Fase 6)**: SSO/SCIM, data residency, BYOK.

## Proposta de valor mensurável
- Resposta a lead em <60s, 24/7, em todos os canais (widget, telefone, Meet/Zoom, sala própria).
- Qualificação SILVA consistente (score S·I·L·V·A registrado em 100% das conversas).
- Handoff quente com pacote de contexto — cliente nunca repete a história.
- Custo por conversa uma ordem de grandeza abaixo de um SDR humano (planilha UNIT_ECONOMICS).
- Melhoria contínua governada: nenhuma mudança de prompt/modelo entra em produção sem passar nos evals.

## North-star e métricas de produto
North-star: **receita influenciada por agente / mês por tenant**. Suporte: taxa de qualificação SILVA, taxa de agendamento, show rate, taxa de proposta, conversão, conversão pós-handoff, NPS de conversa, latência p50/p95 EOT→primeiro áudio, custo por minuto.

## Princípio fundamental (separação de camadas)
1 Conversação em tempo real · 2 Orquestração autônoma · 3 Inteligência comercial · 4 Renderização do avatar · 5 Integrações/tools · 6 Governança/segurança/compliance · 7 Canais · 8 Memória/aprendizado · 9 Analytics/avaliação. Nenhuma integração crítica sem interface/adapter/provider registry (troca futura garantida).
