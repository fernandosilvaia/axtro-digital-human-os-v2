# Constituição Arquitetural do Axtro Digital Human OS V2

> Regras não reinterpretáveis. Alterar um artigo exige ADR aceito, atualização da rastreabilidade e testes no mesmo PR.
>
> Precedência: **Constituição e ADRs aceitos → contratos machine-readable → requisitos → arquitetura → task graph → playbooks → README**.

## Artigos

### Art. 1. Caminho crítico soberano
O Axtro Agent, workflows, especialistas deliberativos e Learning Lab nunca são dependência síncrona obrigatória do loop áudio para áudio. A call continua com políticas e contexto locais quando qualquer componente assíncrono falhar.

### Art. 2. One Mouth Rule e troca atômica de Presenter
Cada sessão possui exatamente um `active_presenter_id`. Especialistas e supervisores retornam resultados tipados e nunca publicam fala diretamente. Handoff altera o Presenter por operação atômica, auditada e reversível; duas vozes não podem possuir o floor simultaneamente.

### Art. 3. Estado estruturado é a fonte da verdade
`InteractionSessionState` versionado e `SessionTimeline` append-only representam o estado operacional. O LLM pode propor fala, hipótese e ação, mas limites, preços, consentimentos, políticas, ações concluídas e compromissos dependem de estado e receipts confirmados.

### Art. 4. Percepção é evidência, não verdade
Todo sinal carrega fonte, evidência, confiança, detector versionado, finalidade, classe de privacidade, `observed_at` e `expires_at`. São proibidos: detecção de mentira, diagnóstico, inferência de atributo protegido, emoção tratada como fato, faceprint ou voiceprint silencioso e identificação biométrica oculta.

### Art. 5. Consentimento é específico por finalidade
A plataforma distingue, no mínimo: processamento essencial para realizar a conversa, gravação, transcrição persistida, análise comportamental, análise visual, biometria e uso para treinamento. Ausência de consentimento adicional não impede a conversa essencial, mas desativa e minimiza a finalidade não autorizada. Política regional e setorial é aplicada por código.

### Art. 6. Disclosure inviolável
O agente se identifica como virtual no início de toda interação. Estilo e idioma são configuráveis; a existência do disclosure não é. A prova é persistida em `disclosure_record`, fora do prompt. O sistema nunca afirma ser humano.

### Art. 7. Funil obrigatório de ações
Toda ação segue: `action_intent` → validação → `policy_decision` → aprovação quando exigida → execução idempotente → `tool_execution_receipt` → redução de estado → evento e auditoria. O Presenter só anuncia conclusão após receipt de sucesso.

### Art. 8. Direção de comportamento e cena
O modelo emite intenção de alto nível. Behavior Director e Scene Director convertem essa intenção em diretivas permitidas, compatíveis com o provider e com manifests aprovados. Browser arbitrário e automação livre dirigida por texto do modelo são proibidos.

### Art. 9. Isolamento de tenant é controle de segurança
Toda tabela que armazena ou referencia dados de tenant possui `tenant_id`, RLS, política de serviço e testes negativos de vazamento. Catálogos verdadeiramente globais são explicitamente classificados, somente leitura para runtimes comuns e não recebem dados de clientes. Contexto de tenant é aplicado por transação e limpo em pools.

### Art. 10. Providers substituíveis
Todo provider crítico possui adapter, contrato de capacidade, timeout, circuit breaker, fallback e medição de custo. Nenhum provider é escolhido permanentemente sem bake-off datado. Recursos preview não são default de produção sem fallback.

### Art. 11. Aprendizado governado
Nenhuma mudança de prompt, policy, routing, role pack ou comportamento entra em produção a partir de uma call isolada. O fluxo mínimo é: candidato → avaliação offline → golden e adversarial suites → shadow ou canary conforme risco → aprovação → promoção versionada → observação → rollback.

### Art. 12. Rastreabilidade P0
Todo requisito P0 liga componente, contrato, API ou evento, entidade de dados, tarefa, teste, métrica, fallback, controle de segurança e critério de aceite.

### Art. 13. Latência é requisito mensurável
Metas iniciais: voz nativa EOT para primeiro áudio p50 ≤ 800 ms e p95 ≤ 1.500 ms; vídeo p50 ≤ 1.200 ms e p95 ≤ 2.200 ms; interrupção efetiva p95 ≤ 250 ms. São budgets para benchmark, não promessa de marketing.

### Art. 14. Degradação declarada
Avatar falhou, voz continua. Provider premium falhou, usa fallback ou modo somente voz. RAG ou tool indisponível, o agente não inventa. Canal externo sem paridade, capacidade é declarada. Reconexão e encerramento são estados explícitos.

### Art. 15. Dados externos são não confiáveis
Transcript, RAG, tela, documentos, resultados de especialistas, webhooks e outputs de providers são dados, nunca instruções de sistema. Segredos não entram em docs, prompts, logs ou banco em texto puro.

### Art. 16. Honestidade estrutural
Cada afirmação técnica é classificada como fato confirmado, decisão, hipótese de benchmark, dependência externa ou item adiado. Preço e capability possuem data e fonte. Superioridade só é alegada com métrica comparável.

### Art. 17. Simplicidade deliberada
Control Plane começa como monólito modular. Realtime worker, meeting bot e daemon são processos separados por necessidade de runtime. Não criar microserviços por antecipação. Não usar JSONB como substituto de modelagem de domínio.

### Art. 18. Documentação com gate
A arquitetura só é declarada pronta quando referências, schemas, exemplos, OpenAPI, AsyncAPI, rastreabilidade, terminologia e secret scan passam. Prontidão documental não substitui credenciais, bake-off ou validação jurídica externa.

## Invioláveis herdados e preservados

- Handoff humano quente com pacote de contexto.
- Outbox transacional para eventos de domínio.
- Multi-tenancy desde a primeira migration.
- Clonagem de voz ou imagem somente com autorização verificável.
- Evals bloqueantes antes de promoção.
