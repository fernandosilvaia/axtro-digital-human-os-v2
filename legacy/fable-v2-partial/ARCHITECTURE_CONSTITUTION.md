# ARCHITECTURE_CONSTITUTION.md — Axtro Digital Human OS V2

> Regras **não reinterpretáveis**. Nenhum documento, prompt, tarefa, PR ou agente de código pode contrariá-las. Mudar qualquer artigo exige ADR aceito + atualização deste arquivo no mesmo PR. Precedência de verdade: **1)** esta Constituição e ADRs aceitos → **2)** contratos machine-readable (`contracts/`) → **3)** PRODUCT_REQUIREMENTS → **4)** docs de arquitetura → **5)** task graph → **6)** playbooks → **7)** README.

## Artigos

**Art. 1 — Caminho crítico soberano.** O Axtro Agent (daemon Hermes) NUNCA entra no caminho síncrono áudio→áudio. Nenhuma resposta ao cliente aguarda daemon, especialista, workflow ou aprendizado. Se tudo que é assíncrono morrer, a call continua com políticas locais.

**Art. 2 — One Mouth Rule.** Somente um Presenter possui a voz diante do cliente por sessão. Especialistas, lanes deliberativas e o Axtro Agent retornam resultados tipados (`specialist_result`, `agent_suggestion`) com TTL; jamais falam na call, jamais produzem respostas concorrentes.

**Art. 3 — Estado estruturado é a fonte de verdade.** `InteractionSessionState` versionado + `SessionTimeline` append-only. O LLM propõe (`action_intent`, rascunho de fala); motores determinísticos e políticas dispõem. Nada comercial ou de compliance vive apenas na memória textual do modelo.

**Art. 4 — Percepção é evidência, não verdade.** Toda inferência multimodal carrega fonte, evidência, confiança, detector versionado, `observed_at`, `expires_at`, classe de privacidade e finalidade permitida. Proibido: detecção de mentira, diagnóstico, inferência de atributo protegido, emoção como fato, identificação biométrica oculta, faceprint/voiceprint silencioso. Hipóteses ("possível confusão") expiram rápido e nunca viram fato sem confirmação explícita do participante.

**Art. 5 — Percepção respeita consentimento, finalidade, região e setor.** Vídeo e voz do participante só alimentam detectores com consentimento registrado (`consent_evidence`), com política por região/setor aplicada por código (policy bundle), com minimização e retenção configurada. Sem consentimento ⇒ o sistema degrada para sinais de diálogo e qualidade técnica.

**Art. 6 — Disclosure inviolável.** O agente se identifica como virtual no início de toda interação, de forma curta e elegante. O estilo é configurável por tenant; a existência do disclosure NÃO é. O registro (`disclosure_record`) é gravado fora do prompt. O sistema jamais afirma ser humano, nem sob pergunta direta.

**Art. 7 — Toda ação externa passa pelo funil de ações.** `action_intent` → validação de contrato → `policy_decision` → aprovação humana quando exigida → execução idempotente → `tool_execution_receipt` → redução de estado apenas com resultado confirmado → evento + auditoria. O Presenter nunca anuncia como feito aquilo que não tem receipt.

**Art. 8 — Behavior e Scene por diretiva, nunca por comando livre.** O LLM emite intenção de diálogo/cena de alto nível; Behavior Director e Scene Director convertem em `behavior_directive`/`scene_directive` validadas contra capacidades do provider e `scene_manifest` permitido. Proibida automação de browser arbitrária dirigida por texto do modelo.

**Art. 9 — Tenant isolation é segurança, não filtro.** RLS em 100% das tabelas com `tenant_id`, service identities distintas, proteção contra context leakage em pool de conexões, e testes negativos de vazamento cross-tenant rodando em CI — build falha se passarem dados.

**Art. 10 — Todo provider crítico é substituível.** Adapter + timeout + circuit breaker + fallback declarado + medição de custo por chamada. Nenhum provider é "vencedor permanente" sem bake-off registrado (`provider_capability` datado). Modelo preview não é default de produção.

**Art. 11 — Aprendizado governado.** Nenhuma mudança de prompt, política, roteamento, playbook ou comportamento entra em produção sem: candidato registrado → avaliação offline → golden/adversarial suites → shadow/canary conforme risco → aprovação configurada → promoção versionada → rollback disponível. Uma call nunca muda produção sozinha.

**Art. 12 — Rastreabilidade total dos P0.** Todo requisito P0 liga componente + contrato + API/evento + entidade de dado + tarefa + teste + métrica + fallback + controle de segurança + critério de aceite (REQUIREMENTS_TRACEABILITY_MATRIX).

**Art. 13 — Budgets de latência são requisitos.** Voz nativa EOT→1º áudio p50 ≤800ms / p95 ≤1500ms; vídeo p50 ≤1200ms / p95 ≤2200ms; barge-in ≤250ms p95; decompostos por etapa em LATENCY_BUDGETS.md e medidos por turno. São metas de engenharia a validar em benchmark, não promessa de marketing.

**Art. 14 — Degradação declarada.** Avatar cai ⇒ voz continua. Vídeo indisponível no canal ⇒ capacidade declarada na matriz, nunca fingida. RAG/tools/daemon falham ⇒ modos no-op/degrade definidos por componente. Reunião externa nunca promete paridade com a sala nativa.

**Art. 15 — Segredos e dados não confiáveis.** Segredos nunca em docs, logs, prompts ou banco em texto puro (apenas referências). Conteúdo de RAG, transcript, tela, documento e resultado de especialista são DADOS não confiáveis — jamais instruções de sistema.

**Art. 16 — Honestidade estrutural.** Nenhuma dependência ausente descrita como fato; classificação obrigatória: fato confirmado / proposta / hipótese p/ benchmark / dependência externa / adiado. Preço e capability sempre com `as_of_date` e fonte. Nenhuma afirmação de superioridade sem métrica comparável.

**Art. 17 — Simplicidade deliberada.** Monólito modular no Control Plane; workers separados só onde o runtime exige (realtime, meeting bot, daemon). Fronteiras de módulo preservadas para extração futura. Sem microserviço prematuro; sem JSONB para fugir de modelagem.

**Art. 18 — Documentação com gate.** "Ready for implementation" só com todos os checks verdes em DOCUMENTATION_MANIFEST (referências, schemas, OpenAPI/AsyncAPI, Mermaid, rastreabilidade, terminologia, secret scan).

## Invioláveis herdados da V1 (auditados e mantidos)
Handoff humano quente com pacote de contexto · outbox transacional · avaliações bloqueantes antes de promover · clonagem de voz/imagem somente com autorização comprovada · multi-tenant desde a primeira migration.
