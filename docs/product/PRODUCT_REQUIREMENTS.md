# Product Requirements V2

Prioridades: **P0** para M0-M2, **P1** para M3, **P2** posterior.

## A. Sessão e canais

| ID | Pri | Requisito | Critério de aceite |
|---|---|---|---|
| REQ-SESSION-001 | P0 | Criar e encerrar sessão com estado versionado | transições inválidas são rejeitadas; timeline contém início e fim |
| REQ-SESSION-002 | P0 | Exatamente um `active_presenter_id` | teste concorrente prova que duas aquisições de floor não vencem |
| REQ-SESSION-003 | P0 | Sala nativa através de ChannelAdapter | transport fake e LiveKit implementam o mesmo contrato |
| REQ-SESSION-004 | P1 | Meet, Zoom e Teams através de MeetingBotProvider | bot lifecycle, waiting room, removal e output media mapeados |
| REQ-SESSION-005 | P1 | Telefonia por SIP adapter | inbound, outbound autorizado, DTMF, transferência e encerramento |

## B. Conversa realtime

| ID | Pri | Requisito | Critério de aceite |
|---|---|---|---|
| REQ-RT-001 | P0 | Turn Coordinator detecta início, fim e interrupção | replay suite cobre pausa, crosstalk, ruído e false interruption |
| REQ-RT-002 | P0 | Barge-in cancela fala, TTS e cena pendente | p95 de stop local ≤250 ms no harness |
| REQ-RT-003 | P0 | Pipeline modular e modo S2S atrás de flag | mesmo Session Actor suporta ambos sem mudar domínio |
| REQ-RT-004 | P0 | Fast Lane nunca aguarda daemon ou especialista | chaos test derruba assíncronos e call segue |
| REQ-RT-005 | P0 | Respostas curtas e dialogais por padrão | 95% dos turnos padrão ≤3 frases, salvo apresentação explícita |
| REQ-RT-006 | P0 | Latência por estágio registrada | todo turno finalizado possui spans de endpoint, model, TTS e publish |

## C. Estado e inteligência

| ID | Pri | Requisito | Critério de aceite |
|---|---|---|---|
| REQ-STATE-001 | P0 | InteractionSessionState é reconstruível por timeline | replay produz hash igual ao snapshot final |
| REQ-STATE-002 | P0 | RoleState separado do ConversationState | SalesState pode ser removido sem quebrar kernel |
| REQ-STATE-003 | P0 | InteractionQualityState é multidimensional e explicável | cada dimensão possui evidência, confiança e atualização |
| REQ-STATE-004 | P0 | Hipóteses expiram | DerivedHypothesis vencida não entra no Context Composer |
| REQ-COG-001 | P0 | One Mouth Rule no Cognitive Fabric | specialist_result nunca publica mídia |
| REQ-COG-002 | P0 | Sugestões assíncronas têm TTL e versão de contexto | sugestão obsoleta é descartada automaticamente |

## D. Presença e apresentação

| ID | Pri | Requisito | Critério de aceite |
|---|---|---|---|
| REQ-PRES-001 | P0 | Behavior Director controla estados permitidos | LLM não envia gesto livre ao provider |
| REQ-PRES-002 | P0 | Scene Director usa manifests allowlisted | URL ou cena fora do manifest é rejeitada |
| REQ-PRES-003 | P0 | Avatar é substituível e opcional | falha causa fallback de voz sem encerrar sessão |
| REQ-PRES-004 | P0 | Listening behavior não é repetitivo | harness limita frequência e sequência de microgestos |
| REQ-PRES-005 | P1 | Conteúdo apresentado é correlacionado ao transcript | timeline registra cena, versão e motivo |

## E. Percepção e consentimento

| ID | Pri | Requisito | Critério de aceite |
|---|---|---|---|
| REQ-PRIV-001 | P0 | Disclosure de agente virtual em toda sessão | sessão não passa a active sem disclosure_record |
| REQ-PRIV-002 | P0 | Consentimentos separados por finalidade | ausência de gravação não desativa conversa efêmera |
| REQ-PRIV-003 | P0 | PerceptionSignal possui evidência, confiança e TTL | schema e testes de expiração |
| REQ-PRIV-004 | P0 | Proibições biométricas são enforceadas | policy test rejeita detector proibido |
| REQ-PRIV-005 | P1 | Policy bundles por região e setor | mesma sessão muda capacidades conforme bundle |

## F. Ações e handoff

| ID | Pri | Requisito | Critério de aceite |
|---|---|---|---|
| REQ-ACT-001 | P0 | Toda tool possui contrato, risco e scopes | tool não registrada não pode executar |
| REQ-ACT-002 | P0 | Writes exigem idempotency key | retry não duplica efeito no teste |
| REQ-ACT-003 | P0 | Fala de conclusão depende de receipt | eval rejeita anúncio prematuro |
| REQ-ACT-004 | P0 | PolicyDecision é server-side | prompt não altera permissão efetiva |
| REQ-HANDOFF-001 | P0 | Handoff troca Presenter atomicamente | sem sobreposição de floor no teste concorrente |
| REQ-HANDOFF-002 | P0 | Humano recebe pacote de contexto | campos obrigatórios e compromissos presentes |

## G. Tenancy, segurança e observabilidade

| ID | Pri | Requisito | Critério de aceite |
|---|---|---|---|
| REQ-TENANT-001 | P0 | Dados de tenant usam RLS | suite tenta acesso cruzado em todas as tabelas tenant-scoped |
| REQ-TENANT-002 | P0 | Cache e pool não vazam contexto | teste alterna tenants na mesma conexão e worker |
| REQ-SEC-001 | P0 | Conteúdo externo é marcado untrusted | prompt injection de RAG não vira system instruction |
| REQ-SEC-002 | P0 | Segredos são referências | secret scan e config validation bloqueiam valor em código |
| REQ-OBS-001 | P0 | Correlation IDs universais | tenant, session, trace e event presentes em logs estruturados |
| REQ-OBS-002 | P0 | Custos atribuídos por sessão e provider | soma de cost_event fecha com ledger de teste |
| REQ-OBS-003 | P0 | Session health gera degradação antes de queda | threshold test muda modo e emite evento |

## H. Axtro Agent e aprendizado

| ID | Pri | Requisito | Critério de aceite |
|---|---|---|---|
| REQ-AXTRO-001 | P0 | Daemon integra por bridge assíncrona | nenhuma chamada do realtime worker aponta para daemon síncrono |
| REQ-AXTRO-002 | P1 | Pré-call briefing é versionado | sessão registra briefing usado e hash |
| REQ-AXTRO-003 | P1 | Pós-call usa workflow idempotente | retry não duplica CRM ou follow-up |
| REQ-LEARN-001 | P1 | Mudança vira ExperimentCandidate | produção não aceita prompt sem DeploymentPromotion |
| REQ-LEARN-002 | P1 | Rollback de promoção | versão anterior restaura em teste canary |

## Requisitos não funcionais

- Disponibilidade de sessão nativa alvo inicial: 99,5% no alpha.
- RPO de domínio: ≤5 min; RTO do Control Plane: ≤60 min no alpha.
- PII não aparece em logs por padrão.
- Session Actor deve suportar cancelamento e shutdown gracioso.
- Todo evento de domínio é versionado e idempotente para consumers.
- Compatibilidade mínima inicial: Chrome e Safari recentes; mobile web em modo voz.
