# PRODUCT_REQUIREMENTS — Requisitos Funcionais e Não-Funcionais

Prioridade: **P0** = MVP (Fases 0–1) · **P1** = Fase 2–3 · **P2** = Fase 4–5 · **P3** = Fase 6.
Cada requisito tem critério de aceite objetivo (CA).

## 1. Conversação em tempo real (P0)
- RF-1.1 Entrar em sessão de voz na Sala Axtro e conversar com turnos naturais. CA: EOT→primeiro áudio p50 ≤ 800ms, p95 ≤ 1500ms em PT-BR (rede boa), medido por métricas do REALTIME_ARCHITECTURE.
- RF-1.2 Barge-in bidirecional. CA: agente para de falar ≤ 250ms após início de fala do cliente em ≥95% dos casos do test suite de interrupção.
- RF-1.3 Identificação de IA no início, texto configurável por tenant/idioma. CA: presente em 100% das sessões (evento `compliance.ai_disclosed`); bloqueio de sessão se template ausente.
- RF-1.4 Dois modos (pipeline e S2S) selecionáveis por flag/tenant com fallback automático. CA: teste de chaos derruba provider primário e a call continua com degradação anunciada em log, sem queda.
- RF-1.5 Memória de sessão: referências corretas ao que já foi dito. CA: golden-set de 20 diálogos com referência retroativa, ≥95% corretas.
- RF-1.6 Reconhecer incerteza e não inventar. CA: eval de alucinação sobre base de conhecimento ≤2% de afirmações não suportadas.

## 2. Inteligência comercial (P0)
- RF-2.1 `SalesSessionState` estruturado/versionado atualizado em tempo real (etapa, objetivo, coletado/faltante, interesse, intenção, objeções+principal, urgência, autoridade, orçamento, necessidade, prazo, concorrentes, próxima melhor ação, probabilidade, limites, condições de handoff). CA: schema válido em 100% das sessões; revisões auditáveis.
- RF-2.2 Metodologias plugáveis por tenant/produto/campanha: **metodo_silva (default)**, SPIN, BANT, MEDDIC, Challenger, Sandler, Consultiva, custom. CA: trocar metodologia altera perguntas de descoberta e critérios de avanço sem redeploy.
- RF-2.3 Framework SILVA: score S·I·L·V·A (0–2 por letra) e handoff de 8 campos do SDR→Closer gerado automaticamente. CA: campos preenchidos ou marcados como faltantes; nunca inventados.
- RF-2.4 Limites comerciais: desconto máximo, condições que exigem aprovação. CA: tool de desconto acima do limite retorna `requires_approval` e dispara handoff/aprovação — impossível burlar por prompt (teste adversarial).

## 3. Conhecimento e grounding (P0)
- RF-3.1 Ingestão de PDFs, sites, apresentações, planilhas, FAQs, vídeos transcritos; chunking semântico; embeddings; versionamento; validade; permissões; filtros tenant/produto/idioma. CA: pipeline reproduzível; documento expirado nunca retorna.
- RF-3.2 RAG híbrido (lexical + vetorial + rerank) com citação interna de fonte. CA: resposta factual sempre carrega `source_refs`; distinção explícita confirmado/inferência/não disponível.

## 4. Ferramentas (P0 núcleo, P1 expansão)
- RF-4.1 Runtime de tools com contrato (schema in/out, risk class, timeout, idempotency key, retry, dry-run, confirmação, rollback, limites, audit). CA: 100% das execuções com audit log correlacionado por trace_id; replay de idempotency não duplica efeito.
- RF-4.2 P0: `calendar.schedule_meeting` (Google), `crm.upsert_lead/update_opportunity/log_activity` (CRM-lite), `handoff.request`, `followup.send_email` (fila com aprovação), `knowledge.search`. P1: apresentação, proposta, Stripe/Pix, assinatura, SMS/Telnyx, webhooks. P2: adapters HubSpot/Pipedrive/RD.

## 5. Handoff humano (P0)
- RF-5.1 Gatilhos: pedido explícito, alto valor, irritação, risco de compliance, falta de conhecimento, exceção comercial, negociação avançada, problema técnico, falha de provider, baixa confiança, palavra-chave, sentimento negativo persistente. CA: cada gatilho tem teste.
- RF-5.2 Pacote de contexto (nome, dados permitidos, motivo, resumo, etapa, objeções, materiais, ações, próxima ação) entregue ao humano antes/junto da transferência. CA: humano recebe em ≤5s do aceite; cliente não repete informações no roteiro de teste.
- RF-5.3 Modos: transferência quente na sala, ponte telefônica, agendamento imediato. CA: fluxos testados.

## 6. Avatar e vídeo (P1 — Fase 2)
- RF-6.1 `AvatarProvider` normalizado (sessão, warm-up, áudio→vídeo, interrupção, expressão, idle, escuta, gestos, métricas, erros, fallback, custo). CA: trocar Tavus↔fallback só por config.
- RF-6.2 Warm-up antes do cliente entrar. CA: avatar visível ≤2.5s após entrada em ≥90% (pool aquecido).
- RF-6.3 Falha de avatar → continua por voz com aviso elegante. CA: teste de chaos.

## 7. Meeting Gateway (P1 — Fase 3)
- RF-7.1 Bot entra em Meet/Zoom/Teams, aguarda admissão, identifica participantes, publica voz e vídeo do avatar, compartilha conteúdo quando suportado, detecta remoção, reconecta, encerra e emite eventos de ciclo de vida. CA: matriz de eventos por plataforma testada em sandbox.
- RF-7.2 Telefonia Telnyx: inbound, outbound com consentimento, DTMF, gravação com aviso, voicemail detection, horários, filas, números por empresa, SMS de acompanhamento. CA: cenários E2E.

## 8. Multi-tenant SaaS (P0 fundação, P2 self-serve)
- RF-8.1 tenant_id obrigatório + RLS em todas as tabelas; storage e segredos isolados; RBAC (owner/admin/manager/agent_operator/viewer) + ABAC p/ dados sensíveis. CA: suite de vazamento cross-tenant = 0 falhas (bloqueia deploy).
- RF-8.2 Medição por minuto/tokens/avatar/telefonia; budgets e limites por tenant; suspensão. CA: estouro de budget encerra graciosamente e notifica.
- RF-8.3 White-label, domínio próprio, branding, região/idioma/moeda/fuso, retenção configurável, exportação e exclusão (LGPD). (P2)

## 9. Axtro Agent (P0 eventos + jobs pós-call; P2 daemon completo)
- RF-9.1 Pré-call: briefing (lead, CRM, segmento, estágio, estratégia, materiais, objeções prováveis, tools autorizadas, políticas) escrito no contexto da sessão. CA: sessão inicia com briefing quando lead existe; sem briefing, políticas default locais.
- RF-9.2 In-call: consome eventos, sugere por canal paralelo (nunca no loop de áudio), pode solicitar handoff. CA: latência do loop principal inalterada com daemon ligado/desligado (teste A/B de latência).
- RF-9.3 Pós-call: resumo, decisões, CRM, tarefas, proposta, follow-up, análise de objeções, qualidade, métricas, aprendizados, experimentos, propostas de melhoria com aprovação humana. CA: jobs idempotentes com outbox; falha de CRM → retry/outbox sem perda.

## 10. Não-funcionais (P0)
- RNF-1 Segurança: ver SECURITY_ARCHITECTURE (autn/autz, MFA, secrets, criptografia, assinaturas de webhook, rate limit, injection defenses, kill switch, auditoria).
- RNF-2 Compliance: identificação de IA, consentimento de gravação/chamada, opt-out/DNC, horários, retenção, direitos do titular (LGPD), clonagem autorizada com evidência. RAG = dado não confiável, jamais instrução de sistema.
- RNF-3 Observabilidade: tracing distribuído + logs estruturados + métricas correlacionadas por tenant_id/agent_id/session_id/lead_id/opportunity_id/trace_id; sem segredos/PII desnecessária em logs.
- RNF-4 Disponibilidade alvo: 99.5% MVP → 99.9% Fase 4. Erro de sessão aceitável ≤1% MVP.
- RNF-5 Custo máximo por minuto por cenário: budgets na UNIT_ECONOMICS (planilha) com alarme a 80%.
- RNF-6 Qualidade: nenhum prompt/modelo/política em produção sem passar gates do EVALUATION_FRAMEWORK.

## Fora de escopo do MVP (adiado, ver ROADMAP)
Avatar próprio; co-browsing; marketplace; API pública; SSO/SCIM; data residency/BYOK; app móvel nativo (PWA futura); tradução simultânea multi-idioma na mesma call.
