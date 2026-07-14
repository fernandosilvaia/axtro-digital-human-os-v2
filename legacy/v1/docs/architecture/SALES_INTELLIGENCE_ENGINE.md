# SALES_INTELLIGENCE_ENGINE — Motor Comercial (valor proprietário nº1)

Pacote `packages/sales-engine` (TS canônico + porta Python). Motor **determinístico** separado do LLM: o LLM propõe, o motor valida, registra e decide progressão. Fonte da verdade = `SalesSessionState` (schema em `packages/domain/schemas/sales_session_state.schema.json`).

## 1. SalesSessionState (resumo do schema; JSON Schema é normativo)
Campos: ids (tenant/agent/session/lead/opportunity) · `methodology` · `funnel_stage` · `current_objective` · `collected{situation,intent,leadership,value,agenda,pains[],competitors[],decision_process}` · `missing[]` · `silva_score{S,I,L,V,A: 0|1|2}` · `interest_level 0–100` · `buying_intent` · `objections[]{type,text,status,handled_with}` + `primary_objection` · `urgency` · `authority` · `budget_range` · `need` · `timeline` · `sentiment{current,trend}` · `next_best_action` · `conversion_probability` · `limits{max_discount_pct,approval_above}` · `handoff{required,reasons[]}` · `materials_shown[]` · `tools_executed[]` · `compliance{ai_disclosed,recording_consent}` · `state_rev` (increment em toda mudança; histórico auditável em `session_state_revisions`).
Atualização: extractor LLM barato roda por turno com saída JSON estrita → motor aplica **reducer** com regras (ex.: score só sobe com evidência citável; objeção nova nunca apaga anterior; probabilidade recalculada por fórmula calibrável, não pelo LLM).

## 2. Metodologias plugáveis
`MethodologyPlugin{ stages[], objectives(stage), required_slots(stage), discovery_questions(slot, style), advance_rules, exit_criteria, handoff_conditions }`. Registradas: **metodo_silva (default)**, spin, bant, meddic, challenger, sandler, consultative, custom (DSL YAML por tenant). Troca por tenant/produto/campanha sem redeploy (config versionada).

## 3. Método Silva nativo (extraído dos manuais v2.1/2026 do projeto — fatos confirmados)
### 3.1 Qualificação — Framework SILVA (Manual SDR §5)
S=Situação atual · I=Intenção real · L=Liderança e decisão · V=Valor a investir · A=Agenda e prazo. Cada letra: slot + banco de perguntas do manual (pergunta-mãe + variações) + score 0–2. Regra do Head: qualificação aprovada alvo ≥60%; lead fala ~60% do tempo; razão perguntas/afirmações 70/30 na descoberta.
### 3.2 Fechamento — Reunião Silva, 6 fases (Manual Closer §4)
1 **Abertura** 3–5min (confirmar tempo, propor agenda, "quero te ouvir bem", "se fizer sentido") → 2 **Descoberta Profunda** 15–25min → 3 **Apresentação Calibrada** 10–15min (espelha dores da descoberta, caso similar) → 4 **Ancoragem e Preço** 5–8min (valor antes do preço) → 5 **Fechamento** 5–10min (pedido claro + objeções) → 6 **Encerramento** 2–3min (próximo passo com data). Total 40–60min; >75min degrada.
### 3.3 Cold Call — 4 momentos (Manual Cold Call §5, 2–6min)
1 Abertura 15–30s (honestidade + permissão: "sei que você não esperava esse contato; posso te tomar 30 segundos?") → 2 Pitch 45–90s (fórmula: quem atendo + dor específica + permissão) → 3 Descoberta breve 60–120s (1 pergunta de situação + 1 de impacto; sem interrogatório) → 4 Encaminhamento 30–60s (**alternativa fechada**: "terça 10h ou quarta 15h?"). Objetivo: abrir porta, não fechar venda. 4 próximos passos possíveis: reunião · follow-up com data · material+follow-up · encerramento elegante (reciclagem 60–90d). Quadro das **9 objeções mortais** do manual vira a base do objection handler telefônico.
### 3.4 Handoff SDR→Closer (Manual SDR §10) — 8 campos obrigatórios
nome+empresa · cargo+área · score SILVA por letra · dor (2–3 linhas) · urgência (imediata/30d/90d/sem prazo) · decisão (sozinho/comitê/aprovação) · faixa de orçamento (explícita ou inferida) · observações (concorrente, objeção, contexto). Gerado automaticamente do estado; campos ausentes marcados `missing` — **nunca inventados**.
### 3.5 Esteira Silva (Playbook §5) e agentes
8 etapas conectadas — 1 Atração · 2 Conversão de Topo · 3 Qualificação (SDR) · 4 Apresentação e Fechamento (Closer) · 5 Onboarding · 6–8 pós-venda até LTV (conforme Playbook). Mapeamento de agentes: SDR-IA↔3, Closer-IA/Demo↔4, Onboarding-IA↔5, CS/Follow-up/Recuperação↔6–8, Supervisor/Coach/Analista↔KPIs do Head. 4 tipos de lead (quente/morno/frio aberto/frio fechado) definem cadência e tom; cadência outbound 14 dias; reciclagem 60–90 dias; script de reativação do Manual Multicanal §6.5 vira template.
### 3.6 KPIs (Manual Head §7 — viram o dashboard)
Volume: leads/sem, contatos efetivos/SDR/dia (80–120), agendamentos/SDR/sem (8–15). Qualidade: show rate ≥70%, qualificação SILVA ≥60%, resposta inbound <5min. Conversão: fechamento/SQL, ticket médio, ciclo. Resultado: receita vs meta, receita/vendedor, pipeline 3x, forecast accuracy. Operação: adoção do método (calls revisadas aprovadas), CRM ≤48h.

## 4. Detecção de objeções e respostas
Tipologia: preço · confiança · timing · autoridade · necessidade · concorrente · outro. Fluxo: classificador marca → motor busca resposta no **quadro de objeções do tenant** (semente: quadros dos manuais) → LLM adapta ao contexto (nunca inventa condição comercial) → status raised→handled/unresolved; `primary_objection` = maior recorrência+impacto. Objeção de preço nunca gera desconto direto: gera ancoragem de valor; desconto só via tool com limites.

## 5. Next Best Action e progressão
Motor calcula NBA por regras da metodologia (ex.: SILVA V vazio + fase 4 → "explorar orçamento com pergunta de faixa"); LLM recebe NBA como orientação, não como script literal. Avanço de fase exige critérios (ex.: entrar em Ancoragem só com dores confirmadas ≥2 e I≥1). `conversion_probability` = função logística calibrada offline sobre features do estado (versão da fórmula registrada; recalibração pelo pipeline de avaliação, jamais on-the-fly).

## 6. Limites comerciais e condições de handoff
Vivem no motor + Tool Runtime (server-side): max_discount_pct, approval_above, políticas por produto, condições de handoff (lista RF-5.1). Prompt não pode alterá-los (teste adversarial obrigatório).

## 7. Presentation & Demonstration Engine
`PresentationController` separado do agente: LLM emite ações de alto nível — `open_presentation(id)`, `next/prev_slide`, `highlight(element)`, `open_calculator(id, inputs)`, `show_proposal(draft_id)`, `show_comparison(ids)`, `back_to_avatar`, `call_human` — controller **valida** (material pertence ao tenant/produto? permitido nesta fase? canal suporta?) e executa; estado do palco (`stage_state`) sincronizado à sala; eventos presentation.opened/slide.changed. Conteúdo dinâmico (proposta/comparativo) gerado por templates versionados com dados do estado — nunca HTML livre do LLM. Suporta: slides, PDFs, vídeos, páginas permitidas (allowlist), calculadoras, simulações, propostas, comparativos, planos, tabelas, gráficos, demo de produto, screen-share, conteúdo dinâmico.
